import { randomUUID } from 'node:crypto';
import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  type ChildId,
  type Evidence,
  type LessonConfirmationEvent,
  type SkillId,
  type TeacherContribution,
} from '@copilot/domain';
import {
  evidenceInputSchema,
  teacherContributionInputSchema,
  validate,
  type EvidenceInput,
  type TeacherContributionInput,
} from '@copilot/schemas';
import type { Logger } from '@copilot/observability';
import type { LedgerStore } from './store.js';

export class EvidenceValidationError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(`invalid evidence: ${issues.join('; ')}`);
    this.name = 'EvidenceValidationError';
  }
}

export interface EvidenceServiceOptions {
  readonly store: LedgerStore;
  readonly logger?: Logger;
  /** Injectable clock + id factory for deterministic tests. */
  readonly now?: () => Date;
  readonly newId?: () => string;
}

/**
 * The only way evidence enters the system. Validates at the boundary, stamps
 * provenance/time, appends to the ledger. There is deliberately no `update` or
 * `delete` — a correction is a NEW evidence record that supersedes by recency.
 */
export class EvidenceService {
  readonly #store: LedgerStore;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: EvidenceServiceOptions) {
    this.#store = opts.store;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? (() => randomUUID());
  }

  async record(input: EvidenceInput): Promise<Evidence> {
    const parsed = validate(evidenceInputSchema, input);
    if (!parsed.ok) throw new EvidenceValidationError(parsed.issues);
    const v = parsed.value;

    const result: Evidence['result'] = {
      ...(v.result.correct !== undefined ? { correct: v.result.correct } : {}),
      ...(v.result.score !== undefined ? { score: v.result.score } : {}),
      ...(v.result.steps !== undefined ? { steps: v.result.steps } : {}),
    };

    const record: Evidence = {
      id: `ev_${this.#newId()}` as Evidence['id'],
      childId: asChildId(v.childId),
      source: v.source,
      occurredAt: v.occurredAt,
      recordedAt: this.#now().toISOString(),
      ...(v.skillId ? { skillId: asSkillId(v.skillId) } : {}),
      ...(v.problemTypeId ? { problemTypeId: asProblemTypeId(v.problemTypeId) } : {}),
      result,
      ...(v.reasoningQuality ? { reasoningQuality: v.reasoningQuality } : {}),
      ...(v.hintDependency !== undefined ? { hintDependency: v.hintDependency } : {}),
      ...(v.timeSpentSeconds !== undefined ? { timeSpentSeconds: v.timeSpentSeconds } : {}),
      confidenceTier: v.confidenceTier,
      provenance: v.provenance,
      ...(v.aiInferenceId ? { aiInferenceId: v.aiInferenceId } : {}),
    };

    await this.#store.appendEvidence(record);
    this.#logger?.info('evidence.recorded', {
      evidenceId: record.id,
      childId: record.childId,
      source: record.source,
      skillId: record.skillId,
      confidenceTier: record.confidenceTier,
      provenance: record.provenance,
    });
    return record;
  }

  async recordTeacherContribution(input: TeacherContributionInput): Promise<TeacherContribution> {
    const parsed = validate(teacherContributionInputSchema, input);
    if (!parsed.ok) throw new EvidenceValidationError(parsed.issues);
    const v = parsed.value;

    const record: TeacherContribution = {
      id: `tc_${this.#newId()}`,
      childId: asChildId(v.childId),
      contributedAs: v.contributedAs,
      actorUserId: v.actorUserId,
      occurredOn: v.occurredOn,
      recordedAt: this.#now().toISOString(),
      taughtSkillIds: (v.taughtSkillIds ?? []).map(asSkillId),
      problemTypeIds: (v.problemTypeIds ?? []).map(asSkillId),
      homeworkRefs: v.homeworkRefs ?? [],
      ...(v.examRef
        ? {
            examRef: {
              date: v.examRef.date,
              ...(v.examRef.scopeNote !== undefined ? { scopeNote: v.examRef.scopeNote } : {}),
            },
          }
        : {}),
    };

    await this.#store.appendTeacherContribution(record);
    this.#logger?.info('teacher_contribution.recorded', {
      contributionId: record.id,
      childId: record.childId,
      contributedAs: record.contributedAs,
      taughtSkillCount: record.taughtSkillIds.length,
    });
    return record;
  }

  /**
   * Record a parent/teacher lesson confirmation (doc 13 §5). Append-only — it
   * NEVER overwrites context history; it is one more signal for the resolver.
   */
  async recordLessonConfirmation(input: {
    childId: string;
    lessonId: string;
    topicNote?: string;
    source: 'TEACHER_UPDATE' | 'PARENT_UPDATE';
    confidence?: 'VERIFIED' | 'STRONG' | 'SUPPORTING';
    confirmedBy: string;
  }): Promise<LessonConfirmationEvent> {
    const record: LessonConfirmationEvent = {
      id: `lc_${this.#newId()}`,
      childId: asChildId(input.childId),
      lessonId: input.lessonId,
      ...(input.topicNote !== undefined ? { topicNote: input.topicNote } : {}),
      source: input.source,
      confidence: input.confidence ?? (input.source === 'TEACHER_UPDATE' ? 'STRONG' : 'SUPPORTING'),
      confirmedBy: input.confirmedBy,
      confirmedAt: this.#now().toISOString(),
    };
    await this.#store.appendLessonConfirmation(record);
    this.#logger?.info('lesson_confirmation.recorded', {
      confirmationId: record.id,
      childId: record.childId,
      lessonId: record.lessonId,
      source: record.source,
    });
    return record;
  }

  history(childId: string): Promise<readonly Evidence[]> {
    return this.#store.listEvidence(asChildId(childId));
  }

  historyForSkill(childId: string, skillId: string): Promise<readonly Evidence[]> {
    return this.#store.listEvidenceForSkill(asChildId(childId), asSkillId(skillId));
  }

  teacherContributions(childId: string): Promise<readonly TeacherContribution[]> {
    return this.#store.listTeacherContributions(asChildId(childId));
  }

  lessonConfirmations(childId: string): Promise<readonly LessonConfirmationEvent[]> {
    return this.#store.listLessonConfirmations(asChildId(childId));
  }
}

export type { ChildId, SkillId };
