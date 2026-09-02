import type { EducationStore } from '@copilot/education-directory';
import type { RelationshipStore } from './relationship-store.js';
import type { IdentityStore } from './store.js';

export interface DiscoveryServiceOptions {
  readonly identityStore: IdentityStore;
  readonly relationshipStore: RelationshipStore;
  readonly educationStore: EducationStore;
}

export interface ClassJoinCandidate {
  readonly childId: string;
  readonly displayName: string;
  readonly classroomId: string;
}

/**
 * Privacy-safe teacher discovery (doc 21 §10). There is NO endpoint that
 * searches children by name / school / class across the user base, and no child
 * enumeration.
 *
 *  - `emailLookup` returns only a yes/no "an account exists" — never any child.
 *  - `classJoinCandidates` lists children in the teacher's ACTIVE classes who
 *    have opted in (`allow_teacher_discovery_by_class_join`, default true) and
 *    whose PRIMARY class is not `PRIVATE_LEARNING` — display name + class only.
 */
export class DiscoveryService {
  readonly #identity: IdentityStore;
  readonly #rel: RelationshipStore;
  readonly #edu: EducationStore;

  constructor(opts: DiscoveryServiceOptions) {
    this.#identity = opts.identityStore;
    this.#rel = opts.relationshipStore;
    this.#edu = opts.educationStore;
  }

  async emailLookup(email: string): Promise<{ accountExists: boolean }> {
    const user = await this.#identity.findUserByEmail(email);
    return { accountExists: user !== null };
  }

  async classJoinCandidates(teacherUserId: string): Promise<readonly ClassJoinCandidate[]> {
    const assignments = (await this.#edu.listTeacherClassAssignmentsForTeacher(teacherUserId)).filter(
      (a) => a.status === 'ACTIVE',
    );
    const out: ClassJoinCandidate[] = [];
    const seen = new Set<string>();
    for (const a of assignments) {
      const enrollments = await this.#edu.listClassEnrollmentsForClassroom(a.classroomId);
      for (const e of enrollments) {
        if (e.status !== 'ACTIVE' || e.enrollmentType !== 'PRIMARY') continue;
        if (e.privacyMode === 'PRIVATE_LEARNING') continue;
        if (seen.has(e.childId)) continue;
        const prefs = await this.#rel.getPrivacyPreferences(e.childId);
        if (prefs && !prefs.allowTeacherDiscoveryByClassJoin) continue;
        const child = await this.#identity.getChild(e.childId);
        if (!child) continue;
        seen.add(e.childId);
        out.push({ childId: e.childId, displayName: child.displayName, classroomId: a.classroomId });
      }
    }
    return out;
  }
}
