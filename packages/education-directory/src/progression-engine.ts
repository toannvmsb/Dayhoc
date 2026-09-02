import { randomUUID } from 'node:crypto';
import {
  asAcademicYearId,
  suggestNextClassName,
  type ActiveEnrollmentResolution,
  type ClassroomId,
  type EnrollmentTransitionRecord,
  type EnrollmentTransitionType,
  type SchoolId,
  type TransitionProposer,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from './errors.js';
import type { EnrollmentService } from './enrollment-service.js';
import type { EducationStore } from './store.js';

export interface ProgressionEngineOptions {
  readonly store: EducationStore;
  readonly enrollments: EnrollmentService;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface ConfirmTransitionOverrides {
  readonly toSchoolId?: string;
  readonly toClassroomId?: string;
  readonly suggestedClassName?: string;
  readonly toGrade?: number;
}

/** Grade boundaries that require explicit school confirmation (P-3). */
const SCHOOL_CONFIRM_BOUNDARIES: ReadonlyArray<readonly [number, number]> = [
  [5, 6],
  [9, 10],
];

/**
 * Academic Progression Engine (doc 24). Deterministic policy — proposals are
 * SURFACED, never applied. Only the ACTIVE PRIMARY enrollment progresses (P-6).
 * The class-name suggestion is a pure string heuristic (P-7, ID-Q7) — it never
 * creates a confirmed classroom identity by itself.
 */
export class ProgressionEngine {
  readonly #store: EducationStore;
  readonly #enrollments: EnrollmentService;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: ProgressionEngineOptions) {
    this.#store = opts.store;
    this.#enrollments = opts.enrollments;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  /**
   * Build a PROPOSED transition for the child into `toAcademicYearId`. Idempotent
   * per `(child, target year)` — a second call returns the existing row.
   * `currentClassName` is the child's ACTIVE PRIMARY classroom name (optional —
   * used only for the suggestion).
   */
  async determineProposal(input: {
    childId: string;
    toAcademicYearId: string;
    currentClassName?: string | null;
    asOf?: Date;
  }): Promise<EnrollmentTransitionRecord> {
    const asOf = input.asOf ?? this.#now();
    const active = await this.#enrollments.resolveActiveEnrollment(input.childId, asOf);
    if (!active) {
      throw new ValidationError('child has no ACTIVE school enrollment to progress from');
    }
    const toAcademicYearId = asAcademicYearId(input.toAcademicYearId);
    if (!(await this.#store.getAcademicYear(toAcademicYearId))) {
      throw new NotFoundError(`academic year ${input.toAcademicYearId}`);
    }

    const existing = (await this.#store.listTransitions(input.childId)).find(
      (t) =>
        t.toAcademicYearId === toAcademicYearId &&
        (t.status === 'PROPOSED' || t.status === 'CONFIRMED'),
    );
    if (existing) return existing;

    const fromGrade = active.grade;
    let toGrade: number | null = fromGrade + 1;
    let type: EnrollmentTransitionType = 'PROMOTION';
    let toSchoolId: SchoolId | null = active.primaryClassroomId
      ? await this.#schoolOfClassroom(active.primaryClassroomId)
      : await this.#schoolOfEnrollment(active.schoolEnrollmentId);
    let requiresSchoolConfirmation = false;

    if (SCHOOL_CONFIRM_BOUNDARIES.some(([f, t]) => f === fromGrade && t === toGrade)) {
      requiresSchoolConfirmation = true;
      toSchoolId = null; // guardian must pick / create the new school
    }
    if (fromGrade === 12) {
      type = 'GRADUATION';
      toGrade = null;
      toSchoolId = null;
    }

    const suggestedClassName =
      toGrade !== null && input.currentClassName
        ? suggestNextClassName(input.currentClassName, toGrade)
        : null;

    const record: EnrollmentTransitionRecord = {
      id: this.#newId(),
      childId: input.childId,
      transitionType: type,
      fromSchoolId: await this.#schoolOfEnrollment(active.schoolEnrollmentId),
      fromClassroomId: (active.primaryClassroomId as ClassroomId | null) ?? null,
      fromAcademicYearId: active.academicYearId,
      fromGrade,
      toSchoolId,
      toClassroomId: null, // never auto — guardian confirms/creates
      toAcademicYearId,
      toGrade,
      suggestedClassName,
      status: 'PROPOSED',
      requiresSchoolConfirmation,
      proposedBy: 'SYSTEM',
      proposedByUserId: null,
      confirmedByUserId: null,
      createdAt: this.#now().toISOString(),
      confirmedAt: null,
    };
    await this.#store.insertTransition(record);
    this.#logger?.info('progression.proposed', {
      childId: input.childId,
      type,
      fromGrade,
      toGrade,
    });
    return record;
  }

  /**
   * Guardian- (or school-, later) initiated transition. `REPEAT_GRADE` and
   * `MANUAL_CORRECTION` are NEVER auto-proposed — they only come through here.
   */
  async proposeManualTransition(input: {
    childId: string;
    transitionType: EnrollmentTransitionType;
    toAcademicYearId: string;
    toGrade?: number;
    toSchoolId?: string;
    proposedBy: TransitionProposer;
    proposedByUserId: string;
    reason?: string;
    asOf?: Date;
  }): Promise<EnrollmentTransitionRecord> {
    const asOf = input.asOf ?? this.#now();
    const active = await this.#enrollments.resolveActiveEnrollment(input.childId, asOf);
    if (!active) throw new ValidationError('child has no ACTIVE school enrollment');
    const toAcademicYearId = asAcademicYearId(input.toAcademicYearId);
    if (!(await this.#store.getAcademicYear(toAcademicYearId))) {
      throw new NotFoundError(`academic year ${input.toAcademicYearId}`);
    }
    const live = (await this.#store.listTransitions(input.childId)).find(
      (t) =>
        t.toAcademicYearId === toAcademicYearId &&
        (t.status === 'PROPOSED' || t.status === 'CONFIRMED'),
    );
    if (live) {
      throw new ConflictError(
        `child ${input.childId} already has a live transition for the target academic year`,
      );
    }

    const toGrade =
      input.transitionType === 'REPEAT_GRADE'
        ? active.grade
        : (input.toGrade ?? active.grade);

    const record: EnrollmentTransitionRecord = {
      id: this.#newId(),
      childId: input.childId,
      transitionType: input.transitionType,
      fromSchoolId: await this.#schoolOfEnrollment(active.schoolEnrollmentId),
      fromClassroomId: (active.primaryClassroomId as ClassroomId | null) ?? null,
      fromAcademicYearId: active.academicYearId,
      fromGrade: active.grade,
      toSchoolId: input.toSchoolId ? (input.toSchoolId as SchoolId) : null,
      toClassroomId: null,
      toAcademicYearId,
      toGrade,
      suggestedClassName: null,
      status: 'PROPOSED',
      requiresSchoolConfirmation:
        input.transitionType === 'SCHOOL_TRANSFER' ||
        SCHOOL_CONFIRM_BOUNDARIES.some(([f, t]) => f === active.grade && t === toGrade),
      proposedBy: input.proposedBy,
      proposedByUserId: input.proposedByUserId,
      confirmedByUserId: null,
      createdAt: this.#now().toISOString(),
      confirmedAt: null,
    };
    await this.#store.insertTransition(record);
    return record;
  }

  /**
   * Confirm a PROPOSED transition. `authorised` is the caller's decision that the
   * actor may confirm this child's transition (guardian `can_manage_child` — the
   * check lives in the identity/authorization layer, injected here). Atomically:
   * close the old ACTIVE PRIMARY enrollments → create the new ACTIVE enrollments
   * → mark the transition CONFIRMED. History is preserved; the Learning Twin and
   * `child_id` are untouched.
   */
  async confirmTransition(
    transitionId: string,
    actorUserId: string,
    authorised: boolean,
    overrides: ConfirmTransitionOverrides = {},
  ): Promise<EnrollmentTransitionRecord> {
    if (!authorised) throw new AuthorizationError('actor is not authorised to confirm this transition');
    const t = await this.#store.getTransition(transitionId);
    if (!t) throw new NotFoundError(`transition ${transitionId}`);
    if (t.status !== 'PROPOSED') {
      throw new ConflictError(`transition ${transitionId} is ${t.status}, not PROPOSED`);
    }

    const toSchoolId = overrides.toSchoolId ?? (t.toSchoolId as string | null);
    const toGrade = overrides.toGrade ?? t.toGrade;
    if (t.requiresSchoolConfirmation && !toSchoolId) {
      throw new ValidationError('this transition requires a confirmed school before it can be applied');
    }

    const asOf = this.#now();
    const oldSchoolStatus = OLD_SCHOOL_STATUS[t.transitionType];

    // close old ACTIVE school enrollment(s)
    for (const e of (await this.#enrollments.listSchoolEnrollments(t.childId)).filter(
      (x) => x.status === 'ACTIVE',
    )) {
      await this.#store.updateSchoolEnrollment(e.id, {
        status: oldSchoolStatus,
        endDate: asOf.toISOString().slice(0, 10),
      });
    }
    // close old ACTIVE PRIMARY class enrollment(s)
    for (const e of (await this.#enrollments.listClassEnrollments(t.childId)).filter(
      (x) => x.status === 'ACTIVE' && x.enrollmentType === 'PRIMARY',
    )) {
      await this.#store.updateClassEnrollment(e.id, { status: 'LEFT', leftAt: asOf.toISOString() });
    }

    if (t.transitionType !== 'GRADUATION' && toSchoolId && toGrade !== null) {
      const newSchoolEnrollment = await this.#enrollments.createSchoolEnrollment({
        childId: t.childId,
        schoolId: toSchoolId,
        academicYearId: t.toAcademicYearId,
        grade: toGrade,
        source: 'PARENT',
        status: 'ACTIVE',
      });
      const toClassroomId = overrides.toClassroomId ?? (t.toClassroomId as string | null);
      if (toClassroomId) {
        await this.#enrollments.createClassEnrollment({
          childId: t.childId,
          classroomId: toClassroomId,
          academicYearId: t.toAcademicYearId,
          schoolEnrollmentId: newSchoolEnrollment.id,
          enrollmentType: 'PRIMARY',
          status: 'ACTIVE',
          source: 'PARENT',
        });
      }
    }

    await this.#store.updateTransition(transitionId, {
      status: 'CONFIRMED',
      confirmedByUserId: actorUserId,
      confirmedAt: asOf.toISOString(),
      ...(overrides.toSchoolId ? { toSchoolId: overrides.toSchoolId as SchoolId } : {}),
      ...(overrides.toClassroomId ? { toClassroomId: overrides.toClassroomId as ClassroomId } : {}),
      ...(overrides.toGrade !== undefined ? { toGrade: overrides.toGrade } : {}),
    });
    const updated = await this.#store.getTransition(transitionId);
    return updated!;
  }

  async cancelTransition(transitionId: string): Promise<void> {
    const t = await this.#store.getTransition(transitionId);
    if (!t) throw new NotFoundError(`transition ${transitionId}`);
    if (t.status !== 'PROPOSED') {
      throw new ConflictError(`only a PROPOSED transition can be cancelled`);
    }
    await this.#store.updateTransition(transitionId, { status: 'CANCELLED' });
  }

  async listTransitions(childId: string): Promise<readonly EnrollmentTransitionRecord[]> {
    return this.#store.listTransitions(childId);
  }

  async #schoolOfClassroom(classroomId: string): Promise<SchoolId | null> {
    const c = await this.#store.getClassroom(classroomId as ClassroomId);
    return c?.schoolId ?? null;
  }
  async #schoolOfEnrollment(schoolEnrollmentId: string): Promise<SchoolId | null> {
    const e = await this.#store.getSchoolEnrollment(schoolEnrollmentId);
    return e?.schoolId ?? null;
  }
}

const OLD_SCHOOL_STATUS: Record<EnrollmentTransitionType, 'COMPLETED' | 'TRANSFERRED' | 'REPEATED' | 'WITHDRAWN'> = {
  PROMOTION: 'COMPLETED',
  CLASS_CHANGE: 'COMPLETED',
  SCHOOL_TRANSFER: 'TRANSFERRED',
  REPEAT_GRADE: 'REPEATED',
  MANUAL_CORRECTION: 'WITHDRAWN',
  GRADUATION: 'COMPLETED',
};

export type { ActiveEnrollmentResolution };
