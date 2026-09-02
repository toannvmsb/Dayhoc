import { randomUUID } from 'node:crypto';
import {
  CHILD_SPECIFIC_WRITE_CODES,
  CONTRIBUTION_TYPE_TO_PERMISSION,
  type ContributionRelationshipSource,
  type ContributionVisibility,
  type TeacherContribution,
  type TeacherContributionType,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import { AuthorizationError, ValidationError } from './errors.js';
import type { PermissionService } from './permission-service.js';
import type { RelationshipStore } from './relationship-store.js';

/**
 * Where a validated teacher contribution goes next. The adapter (wired at
 * composition, e.g. in `services/api`) appends it to the append-only evidence
 * ledger, from which it flows `→ Evidence → LearningContextResolver / GapEngine
 * / LearningTwin`. This service NEVER writes the Twin directly (R-7).
 */
export interface TeacherContributionSink {
  append(contribution: TeacherContribution): Promise<void>;
}

export class InMemoryTeacherContributionSink implements TeacherContributionSink {
  readonly items: TeacherContribution[] = [];
  append(contribution: TeacherContribution): Promise<void> {
    this.items.push(contribution);
    return Promise.resolve();
  }
}

export interface TeacherContributionServiceOptions {
  readonly permissions: PermissionService;
  readonly sink: TeacherContributionSink;
  readonly relationshipStore: RelationshipStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface SubmitContributionInput {
  readonly teacherUserId: string;
  readonly childId: string;
  readonly subjectId: string;
  readonly contributionType: TeacherContributionType;
  readonly observedAt: string; // ISO date
  readonly taughtSkillIds?: readonly string[];
  readonly problemTypeIds?: readonly string[];
  readonly homeworkRefs?: readonly string[];
  readonly examRef?: { readonly date: string; readonly scopeNote?: string };
  readonly confidence?: 'A' | 'B' | 'C' | 'D';
  readonly visibility?: ContributionVisibility;
  readonly attachmentId?: string;
}

/**
 * A teacher submits a learning contribution (doc 25 §6). Subject-scoped and
 * permission-checked:
 *  - the `contributionType` maps to a permission code; `can(code, subject)` must
 *    ALLOW — a cross-subject write is denied (a `SUBJECT_TEACHER` for Vietnamese
 *    cannot write Math data);
 *  - a child-specific type (`SKILL_ASSESSMENT`, `LEARNING_OBSERVATION`,
 *    `BEHAVIOUR_OBSERVATION`, `TEST_RESULT`) needs an explicit PARENT_DIRECT
 *    grant — `can()` already enforces this;
 *  - the row records `relationship_source_type` / `_id` provenance and is
 *    append-only. It is a weighted signal for the Resolver, never an overwrite.
 */
export class TeacherContributionService {
  readonly #perms: PermissionService;
  readonly #sink: TeacherContributionSink;
  readonly #rel: RelationshipStore;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: TeacherContributionServiceOptions) {
    this.#perms = opts.permissions;
    this.#sink = opts.sink;
    this.#rel = opts.relationshipStore;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  async submitContribution(input: SubmitContributionInput): Promise<TeacherContribution> {
    if (!input.subjectId) throw new ValidationError('a contribution must be subject-scoped');
    const code = CONTRIBUTION_TYPE_TO_PERMISSION[input.contributionType];
    const decision = await this.#perms.can(
      input.teacherUserId,
      input.childId,
      code,
      input.subjectId,
      this.#now(),
    );
    if (!decision.allowed) {
      throw new AuthorizationError(
        `teacher may not submit a ${input.contributionType} contribution: ${decision.reason}`,
      );
    }

    // provenance — which link + grant authorised this
    const links = (await this.#rel.listTeacherChildLinks({
      teacherUserId: input.teacherUserId,
      childId: input.childId,
    })).filter((l) => l.status === 'ACCEPTED');
    const isChildSpecific = CHILD_SPECIFIC_WRITE_CODES.includes(code);
    let sourceLink = links[0];
    let grantSource: 'PARENT_DIRECT' | 'CLASS_ASSIGNMENT' | 'SCHOOL_AUTHORIZATION' | undefined;
    for (const l of links) {
      const g = (await this.#rel.listGrantsForLink(l.id)).find(
        (x) => x.status === 'ACTIVE' && x.permissionCode === code,
      );
      if (g && (!grantSource || g.accessSource === 'PARENT_DIRECT')) {
        sourceLink = l;
        grantSource = g.accessSource;
      }
    }
    // a child-specific write is only ever authorised via PARENT_DIRECT
    const relationshipSourceType: ContributionRelationshipSource | undefined =
      grantSource === 'CLASS_ASSIGNMENT' && !isChildSpecific
        ? 'CLASS_ASSIGNMENT'
        : sourceLink
          ? 'TEACHER_CHILD_LINK'
          : undefined;

    const contribution: TeacherContribution = {
      id: this.#newId(),
      childId: input.childId as TeacherContribution['childId'],
      contributedAs: 'teacher',
      actorUserId: input.teacherUserId,
      occurredOn: input.observedAt.slice(0, 10),
      recordedAt: this.#now().toISOString(),
      taughtSkillIds: (input.taughtSkillIds ?? []) as TeacherContribution['taughtSkillIds'],
      problemTypeIds: (input.problemTypeIds ?? []) as TeacherContribution['problemTypeIds'],
      homeworkRefs: input.homeworkRefs ?? [],
      ...(input.examRef ? { examRef: input.examRef } : {}),
      subjectId: input.subjectId,
      contributionType: input.contributionType,
      ...(relationshipSourceType ? { relationshipSourceType } : {}),
      ...(sourceLink ? { relationshipSourceId: sourceLink.id } : {}),
      confidence: input.confidence ?? 'B',
      visibility:
        input.visibility ??
        (input.contributionType === 'BEHAVIOUR_OBSERVATION' ? 'PARENT_ONLY' : 'PARENT_AND_CHILD'),
      ...(input.attachmentId ? { attachmentId: input.attachmentId } : {}),
    };
    await this.#sink.append(contribution);
    this.#logger?.info('teacher.contribution.submitted', {
      childId: input.childId,
      type: input.contributionType,
      subjectId: input.subjectId,
    });
    return contribution;
  }
}
