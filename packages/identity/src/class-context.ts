import type { EducationStore } from '@copilot/education-directory';

/**
 * The narrow slice of education-directory state the permission engine needs to
 * evaluate a `CLASS_ASSIGNMENT`-sourced grant (doc 21 §3.1, the six conditions).
 * A port so `@copilot/identity` stays testable without a real directory store.
 */
export interface ClassContextReader {
  /**
   * Is there an ACTIVE `teacher_class_assignments` row for this teacher, whose
   * subject matches `subjectId`, and whose classroom the child is ACTIVE-PRIMARY
   * enrolled in? Returns the classroom id when so, else `null`.
   */
  activeTeacherClassForChild(input: {
    teacherUserId: string;
    childId: string;
    subjectId: string | null;
  }): Promise<{ classroomId: string; classEnrollmentId: string } | null>;

  /** The privacy mode of the child's ACTIVE PRIMARY class enrollment (or null). */
  primaryClassPrivacyMode(childId: string): Promise<'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED' | null>;
}

/** Built-in adapter over the education-directory `EducationStore`. */
export function educationClassContextReader(store: EducationStore): ClassContextReader {
  return {
    async activeTeacherClassForChild({ teacherUserId, childId, subjectId }) {
      const assignments = (await store.listTeacherClassAssignmentsForTeacher(teacherUserId)).filter(
        (a) => a.status === 'ACTIVE' && (subjectId === null || a.subjectId === subjectId),
      );
      if (assignments.length === 0) return null;
      const classIds = new Set(assignments.map((a) => a.classroomId));
      const primary = (await store.listClassEnrollments(childId)).find(
        (e) =>
          e.status === 'ACTIVE' &&
          e.enrollmentType === 'PRIMARY' &&
          classIds.has(e.classroomId),
      );
      if (!primary) return null;
      return { classroomId: primary.classroomId, classEnrollmentId: primary.id };
    },
    async primaryClassPrivacyMode(childId) {
      const primary = (await store.listClassEnrollments(childId)).find(
        (e) => e.status === 'ACTIVE' && e.enrollmentType === 'PRIMARY',
      );
      return primary?.privacyMode ?? null;
    },
  };
}

/** An in-memory reader for tests that don't wire a full directory store. */
export class InMemoryClassContextReader implements ClassContextReader {
  #assignments: Array<{ teacherUserId: string; classroomId: string; subjectId: string | null }> = [];
  #enrollments: Array<{
    childId: string;
    classroomId: string;
    classEnrollmentId: string;
    privacyMode: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED';
  }> = [];

  setActiveAssignment(teacherUserId: string, classroomId: string, subjectId: string | null): void {
    this.#assignments.push({ teacherUserId, classroomId, subjectId });
  }
  setPrimaryEnrollment(
    childId: string,
    classroomId: string,
    classEnrollmentId: string,
    privacyMode: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED',
  ): void {
    this.#enrollments = this.#enrollments.filter((e) => e.childId !== childId);
    this.#enrollments.push({ childId, classroomId, classEnrollmentId, privacyMode });
  }

  activeTeacherClassForChild(input: {
    teacherUserId: string;
    childId: string;
    subjectId: string | null;
  }): Promise<{ classroomId: string; classEnrollmentId: string } | null> {
    const assigned = this.#assignments.filter(
      (a) =>
        a.teacherUserId === input.teacherUserId &&
        (input.subjectId === null || a.subjectId === input.subjectId),
    );
    const enr = this.#enrollments.find(
      (e) => e.childId === input.childId && assigned.some((a) => a.classroomId === e.classroomId),
    );
    return Promise.resolve(
      enr ? { classroomId: enr.classroomId, classEnrollmentId: enr.classEnrollmentId } : null,
    );
  }
  primaryClassPrivacyMode(
    childId: string,
  ): Promise<'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED' | null> {
    return Promise.resolve(this.#enrollments.find((e) => e.childId === childId)?.privacyMode ?? null);
  }
}
