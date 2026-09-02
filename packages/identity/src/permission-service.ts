import { randomUUID } from 'node:crypto';
import {
  CHILD_SPECIFIC_WRITE_CODES,
  CLASS_ASSIGNMENT_ALLOWED_CODES,
  SENSITIVE_PERMISSION_CODES,
  type AccessSource,
  type PermissionCode,
  type PermissionDecision,
  type PermissionGrantRecord,
  type TeacherChildLinkRecord,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import type { ClassContextReader } from './class-context.js';
import { AuthorizationError, NotFoundError, ValidationError } from './errors.js';
import type { RelationshipStore } from './relationship-store.js';

export interface PermissionServiceOptions {
  readonly store: RelationshipStore;
  readonly classContext: ClassContextReader;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const DENY = (reason: string): PermissionDecision => ({ allowed: false, reason });
const ALLOW = (reason: string): PermissionDecision => ({ allowed: true, reason });

/**
 * The single effective-permission function (doc 21 §2, §3.1, §6).
 *
 * `can(teacher, child, code, subject, asOf)`:
 *  1. find ACTIVE teacher_child_links for (teacher, child) [subject matches or null]
 *  2. collect ACTIVE permission_grants for those links matching (code, subject)
 *  3. none → DENY
 *  4. code ∈ CHILD_SPECIFIC_WRITE and every matching grant is CLASS_ASSIGNMENT → DENY
 *  5. only source is CLASS_ASSIGNMENT:
 *       - the code must be in CLASS_ASSIGNMENT_ALLOWED_CODES
 *       - an ACTIVE Teacher–Class–Subject assignment + child ACTIVE PRIMARY in it
 *       - that class privacy_mode = LINKED_SHARED
 *       - sensitive Twin codes are NEVER class-derivable
 *  6. gate by privacy_preferences (behaviour observation share)
 *  7. else → ALLOW
 *
 * There is no `teacher_can_view_child` boolean.
 */
export class PermissionService {
  readonly #store: RelationshipStore;
  readonly #cc: ClassContextReader;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: PermissionServiceOptions) {
    this.#store = opts.store;
    this.#cc = opts.classContext;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  async can(
    teacherUserId: string,
    childId: string,
    code: PermissionCode,
    subjectId: string | null,
    asOf: Date = this.#now(),
  ): Promise<PermissionDecision> {
    const links = (await this.#store.listTeacherChildLinks({ teacherUserId, childId })).filter(
      (l) => l.status === 'ACCEPTED' && this.#linkValid(l, asOf) && this.#subjectMatch(l.subjectId, subjectId),
    );
    if (links.length === 0) return DENY('no ACTIVE teacher_child_link');

    const grants: PermissionGrantRecord[] = [];
    for (const l of links) {
      for (const g of await this.#store.listGrantsForLink(l.id)) {
        if (
          g.status === 'ACTIVE' &&
          g.permissionCode === code &&
          this.#subjectMatch(g.subjectId, subjectId)
        ) {
          grants.push(g);
        }
      }
    }
    if (grants.length === 0) return DENY(`no ACTIVE grant for ${code}`);

    const sources = new Set<AccessSource>(grants.map((g) => g.accessSource));
    const hasParentDirect = sources.has('PARENT_DIRECT') || sources.has('SCHOOL_AUTHORIZATION');

    // (4) child-specific write can never come from a classroom assignment
    if (CHILD_SPECIFIC_WRITE_CODES.includes(code) && !hasParentDirect) {
      return DENY('CHILD_SPECIFIC_WRITE requires an explicit PARENT_DIRECT grant');
    }

    // (5) purely class-derived grants — the six-condition gate
    if (!hasParentDirect) {
      if (SENSITIVE_PERMISSION_CODES.includes(code)) {
        return DENY('a classroom assignment never grants a sensitive Twin read');
      }
      if (!CLASS_ASSIGNMENT_ALLOWED_CODES.includes(code)) {
        return DENY(`${code} is not a class-derivable code`);
      }
      const active = await this.#cc.activeTeacherClassForChild({ teacherUserId, childId, subjectId });
      if (!active) return DENY('no ACTIVE Teacher–Class–Subject assignment matching the child PRIMARY class');
      const privacy = await this.#cc.primaryClassPrivacyMode(childId);
      if (privacy !== 'LINKED_SHARED') return DENY(`class privacy_mode is ${privacy ?? 'unset'}, not LINKED_SHARED`);
    }

    // (6) privacy_preferences gate
    if (code === 'SUBMIT_LEARNING_OBSERVATION' || code === 'VIEW_LEARNING_TWIN_SUMMARY') {
      const prefs = await this.#store.getPrivacyPreferences(childId);
      if (prefs && code === 'VIEW_LEARNING_TWIN_SUMMARY' && !prefs.allowTeacherDiscoveryByClassJoin && !hasParentDirect) {
        return DENY('privacy_preferences suppress this class-derived read');
      }
    }

    return ALLOW(hasParentDirect ? 'PARENT_DIRECT grant' : 'class-derived grant (all six conditions hold)');
  }

  /** All codes the teacher effectively holds for `(child, subject)` right now. */
  async effectiveCodes(
    teacherUserId: string,
    childId: string,
    subjectId: string | null,
    asOf: Date = this.#now(),
  ): Promise<readonly PermissionCode[]> {
    const out: PermissionCode[] = [];
    const links = (await this.#store.listTeacherChildLinks({ teacherUserId, childId })).filter(
      (l) => l.status === 'ACCEPTED' && this.#linkValid(l, asOf),
    );
    const codes = new Set<PermissionCode>();
    for (const l of links) {
      for (const g of await this.#store.listGrantsForLink(l.id)) {
        if (g.status === 'ACTIVE') codes.add(g.permissionCode);
      }
    }
    for (const c of codes) {
      if ((await this.can(teacherUserId, childId, c, subjectId, asOf)).allowed) out.push(c);
    }
    return out;
  }

  /**
   * Grant a permission on an ACCEPTED `teacher_child_links`. `grantedByUserId`
   * must be the authorised guardian — the caller (RelationshipService /
   * AuthorizationService) checks the `can_manage_privacy` capability first;
   * this method only validates the code + link state.
   */
  async grant(input: {
    linkId: string;
    linkType: 'TEACHER_CHILD' | 'TEACHER_PARENT';
    code: PermissionCode;
    subjectId: string | null;
    accessSource: AccessSource;
    grantedByUserId: string;
  }): Promise<PermissionGrantRecord> {
    if (input.accessSource === 'CLASS_ASSIGNMENT' && !CLASS_ASSIGNMENT_ALLOWED_CODES.includes(input.code)) {
      throw new ValidationError(`${input.code} may not be granted via CLASS_ASSIGNMENT`);
    }
    if (input.linkType === 'TEACHER_CHILD') {
      const link = await this.#store.getTeacherChildLink(input.linkId);
      if (!link) throw new NotFoundError(`teacher_child_link ${input.linkId}`);
      if (link.status !== 'ACCEPTED') throw new ValidationError('link is not ACCEPTED');
    }
    const record: PermissionGrantRecord = {
      id: this.#newId(),
      subjectLinkType: input.linkType,
      subjectLinkId: input.linkId,
      permissionCode: input.code,
      subjectId: (input.subjectId as PermissionGrantRecord['subjectId']) ?? null,
      accessSource: input.accessSource,
      grantedByUserId: input.grantedByUserId,
      status: 'ACTIVE',
      grantedAt: this.#now().toISOString(),
      revokedAt: null,
    };
    await this.#store.insertGrant(record);
    this.#logger?.info('permission.granted', { linkId: input.linkId, code: input.code });
    return record;
  }

  async revokeGrantsForLink(linkId: string, accessSource?: AccessSource): Promise<number> {
    let n = 0;
    for (const g of await this.#store.listGrantsForLink(linkId)) {
      if (g.status === 'ACTIVE' && (accessSource === undefined || g.accessSource === accessSource)) {
        await this.#store.updateGrant(g.id, { status: 'REVOKED', revokedAt: this.#now().toISOString() });
        n += 1;
      }
    }
    return n;
  }

  async revokeGrant(linkId: string, code: PermissionCode): Promise<void> {
    const g = (await this.#store.listGrantsForLink(linkId)).find(
      (x) => x.status === 'ACTIVE' && x.permissionCode === code,
    );
    if (!g) throw new NotFoundError(`active grant ${code} on link ${linkId}`);
    await this.#store.updateGrant(g.id, { status: 'REVOKED', revokedAt: this.#now().toISOString() });
  }

  #subjectMatch(a: string | null | undefined, b: string | null): boolean {
    if (a === null || a === undefined) return true; // null grant subject = all subjects
    if (b === null) return true;
    return a === b;
  }
  #linkValid(l: TeacherChildLinkRecord, asOf: Date): boolean {
    const t = asOf.toISOString();
    if (l.validFrom && l.validFrom > t) return false;
    if (l.validUntil && l.validUntil < t) return false;
    return true;
  }

  /** Guard used by the AuthorizationError path. */
  async assertCan(
    teacherUserId: string,
    childId: string,
    code: PermissionCode,
    subjectId: string | null,
    asOf?: Date,
  ): Promise<void> {
    const d = await this.can(teacherUserId, childId, code, subjectId, asOf);
    if (!d.allowed) throw new AuthorizationError(`can(${code}) denied: ${d.reason}`);
  }
}
