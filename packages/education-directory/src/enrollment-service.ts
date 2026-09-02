import { randomUUID } from 'node:crypto';
import {
  asAcademicYearId,
  asClassroomId,
  asSchoolId,
  type ActiveEnrollmentResolution,
  type ClassEnrollmentType,
  type PrivacyMode,
  type StudentClassEnrollmentRecord,
  type StudentSchoolEnrollmentRecord,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import type { EducationStore } from './store.js';

export interface EnrollmentServiceOptions {
  readonly store: EducationStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface CreateSchoolEnrollmentInput {
  readonly childId: string;
  readonly schoolId: string;
  readonly academicYearId: string;
  readonly grade: number;
  readonly curriculumId?: string;
  readonly calendarId?: string;
  readonly status?: StudentSchoolEnrollmentRecord['status'];
  readonly startDate?: string;
  readonly source?: StudentSchoolEnrollmentRecord['source'];
  readonly verificationStatus?: StudentSchoolEnrollmentRecord['verificationStatus'];
}

export interface CreateClassEnrollmentInput {
  readonly childId: string;
  readonly classroomId: string;
  readonly academicYearId: string;
  readonly schoolEnrollmentId?: string;
  readonly enrollmentType?: ClassEnrollmentType;
  readonly privacyMode?: PrivacyMode;
  readonly status?: StudentClassEnrollmentRecord['status'];
  readonly source?: StudentClassEnrollmentRecord['source'];
}

/**
 * Historical enrollment (docs 20, 24). Every state change is a NEW row + a
 * terminal status on the old row — history is never overwritten (E-3).
 *
 *  - `resolveActiveEnrollment` — the Curriculum Clock's source of truth.
 *  - `resolveDefaultClassroom` — the ACTIVE PRIMARY classroom (supplementary /
 *    HSG / tutor groups are never the clock context — E-7).
 */
export class EnrollmentService {
  readonly #store: EducationStore;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: EnrollmentServiceOptions) {
    this.#store = opts.store;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  /**
   * Create a school enrollment. If `status='ACTIVE'`, any existing ACTIVE school
   * enrollment for the child is first moved to `COMPLETED` (never overwritten).
   */
  async createSchoolEnrollment(
    input: CreateSchoolEnrollmentInput,
  ): Promise<StudentSchoolEnrollmentRecord> {
    if (!Number.isInteger(input.grade) || input.grade < 1 || input.grade > 12) {
      throw new ValidationError('grade must be an integer 1..12');
    }
    const status = input.status ?? 'ACTIVE';
    if (status === 'ACTIVE') {
      const current = (await this.#store.listSchoolEnrollments(input.childId)).filter(
        (e) => e.status === 'ACTIVE',
      );
      for (const e of current) {
        await this.#store.updateSchoolEnrollment(e.id, {
          status: 'COMPLETED',
          endDate: this.#nowDate(),
        });
      }
    }
    const record: StudentSchoolEnrollmentRecord = {
      id: this.#newId(),
      childId: input.childId,
      schoolId: asSchoolId(input.schoolId),
      academicYearId: asAcademicYearId(input.academicYearId),
      grade: input.grade,
      curriculumId: input.curriculumId ?? 'KET_NOI_TRI_THUC',
      calendarId: input.calendarId ?? null,
      status,
      startDate: input.startDate ?? this.#nowDate(),
      endDate: null,
      source: input.source ?? 'PARENT',
      verificationStatus: input.verificationStatus ?? 'SELF_DECLARED',
      createdAt: this.#now().toISOString(),
    };
    await this.#store.insertSchoolEnrollment(record);
    this.#logger?.info('enrollment.school.created', {
      childId: input.childId,
      grade: input.grade,
      status,
    });
    return record;
  }

  /**
   * Create a class enrollment. A PRIMARY enrollment first moves any existing
   * ACTIVE PRIMARY for the same academic year to `LEFT`. Supplementary /
   * HSG_TEAM / TUTOR_GROUP / CLUB / OTHER enrollments coexist with no limit.
   */
  async createClassEnrollment(
    input: CreateClassEnrollmentInput,
  ): Promise<StudentClassEnrollmentRecord> {
    const enrollmentType = input.enrollmentType ?? 'PRIMARY';
    const status = input.status ?? 'ACTIVE';
    const academicYearId = asAcademicYearId(input.academicYearId);

    if (enrollmentType === 'PRIMARY' && status === 'ACTIVE') {
      const conflicting = (await this.#store.listClassEnrollments(input.childId)).filter(
        (e) =>
          e.status === 'ACTIVE' &&
          e.enrollmentType === 'PRIMARY' &&
          e.academicYearId === academicYearId,
      );
      if (conflicting.length > 0) {
        throw new ConflictError(
          `child ${input.childId} already has an ACTIVE PRIMARY class enrollment for this academic year`,
          'PRIMARY_ENROLLMENT_EXISTS',
        );
      }
    }

    const record: StudentClassEnrollmentRecord = {
      id: this.#newId(),
      childId: input.childId,
      classroomId: asClassroomId(input.classroomId),
      academicYearId,
      schoolEnrollmentId: input.schoolEnrollmentId ?? null,
      enrollmentType,
      privacyMode: input.privacyMode ?? 'PRIVATE_LEARNING',
      status,
      joinedAt: this.#now().toISOString(),
      leftAt: null,
      source: input.source ?? 'PARENT',
      verifiedBy: null,
      verifiedAt: null,
    };
    await this.#store.insertClassEnrollment(record);
    this.#logger?.info('enrollment.class.created', {
      childId: input.childId,
      enrollmentType,
      status,
    });
    return record;
  }

  async setClassPrivacyMode(
    classEnrollmentId: string,
    privacyMode: PrivacyMode,
  ): Promise<StudentClassEnrollmentRecord> {
    const e = await this.#store.getClassEnrollment(classEnrollmentId);
    if (!e) throw new NotFoundError(`class enrollment ${classEnrollmentId}`);
    await this.#store.updateClassEnrollment(classEnrollmentId, { privacyMode });
    return { ...e, privacyMode };
  }

  async leaveClass(classEnrollmentId: string): Promise<void> {
    const e = await this.#store.getClassEnrollment(classEnrollmentId);
    if (!e) throw new NotFoundError(`class enrollment ${classEnrollmentId}`);
    await this.#store.updateClassEnrollment(classEnrollmentId, {
      status: 'LEFT',
      leftAt: this.#now().toISOString(),
    });
  }

  async listSchoolEnrollments(childId: string): Promise<readonly StudentSchoolEnrollmentRecord[]> {
    return this.#store.listSchoolEnrollments(childId);
  }
  async listClassEnrollments(childId: string): Promise<readonly StudentClassEnrollmentRecord[]> {
    return this.#store.listClassEnrollments(childId);
  }

  /**
   * The Curriculum Clock's source of truth (doc 20 §5). Returns the ACTIVE
   * school enrollment (a PROPOSED one is deliberately NOT used — a brand-new /
   * unconfirmed child falls back to the evidence-only path, C5.2 HC09). `null`
   * when the child has no ACTIVE school enrollment.
   */
  async resolveActiveEnrollment(
    childId: string,
    asOf: Date,
  ): Promise<ActiveEnrollmentResolution | null> {
    const asOfDate = asOf.toISOString().slice(0, 10);
    const active = (await this.#store.listSchoolEnrollments(childId))
      .filter(
        (e) =>
          e.status === 'ACTIVE' && (e.startDate === null || e.startDate <= asOfDate),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!active) return null;

    const year = await this.#store.getAcademicYear(active.academicYearId);
    const primaryClassroomId = await this.#resolvePrimaryClassroomId(childId, active.academicYearId);

    return {
      schoolEnrollmentId: active.id,
      curriculumId: active.curriculumId,
      grade: active.grade,
      academicYearLabel: year?.label ?? '',
      academicYearId: active.academicYearId,
      calendarId: active.calendarId,
      primaryClassroomId,
    };
  }

  /**
   * The ACTIVE PRIMARY classroom for the child's active academic year, or `null`.
   * Supplementary enrollments are ignored here (E-7).
   */
  async resolveDefaultClassroom(childId: string, asOf: Date): Promise<string | null> {
    const active = await this.resolveActiveEnrollment(childId, asOf);
    if (!active) return null;
    return active.primaryClassroomId;
  }

  async #resolvePrimaryClassroomId(
    childId: string,
    academicYearId: string,
  ): Promise<ActiveEnrollmentResolution['primaryClassroomId']> {
    const primary = (await this.#store.listClassEnrollments(childId)).find(
      (e) =>
        e.status === 'ACTIVE' &&
        e.enrollmentType === 'PRIMARY' &&
        e.academicYearId === academicYearId,
    );
    return primary?.classroomId ?? null;
  }

  #nowDate(): string {
    return this.#now().toISOString().slice(0, 10);
  }
}
