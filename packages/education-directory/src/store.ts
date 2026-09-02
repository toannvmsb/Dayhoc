import type {
  AcademicYearId,
  AcademicYearRecord,
  ActiveEnrollmentResolution,
  ClassEnrollmentType,
  ClassroomId,
  ClassroomRecord,
  EnrollmentTransitionRecord,
  EnrollmentTransitionStatus,
  SchoolEnrollmentStatus,
  SchoolId,
  SchoolRecord,
  StudentClassEnrollmentRecord,
  StudentSchoolEnrollmentRecord,
  SubjectCode,
  SubjectId,
  SubjectRecord,
  TeacherClassAssignmentRecord,
  TeacherSchoolMembershipRecord,
} from '@copilot/domain';

export interface SchoolSearchQuery {
  readonly nameFragment?: string;
  readonly province?: string;
  readonly district?: string;
}

export interface ClassEnrollmentPatch {
  readonly status?: StudentClassEnrollmentRecord['status'];
  readonly privacyMode?: StudentClassEnrollmentRecord['privacyMode'];
  readonly leftAt?: string | null;
  readonly verifiedBy?: string | null;
  readonly verifiedAt?: string | null;
}

export interface SchoolEnrollmentPatch {
  readonly status?: SchoolEnrollmentStatus;
  readonly endDate?: string | null;
}

export interface TransitionPatch {
  readonly status?: EnrollmentTransitionStatus;
  readonly toSchoolId?: SchoolId | null;
  readonly toClassroomId?: ClassroomId | null;
  readonly toGrade?: number | null;
  readonly suggestedClassName?: string | null;
  readonly confirmedByUserId?: string | null;
  readonly confirmedAt?: string | null;
}

/**
 * Persistence port for the education directory + enrollment history + progression
 * (migration groups I2, I3, I6). Dumb CRUD — invariants (school identity by
 * address, one ACTIVE PRIMARY class enrollment, no-overwrite history, boundary
 * rules) live in the services.
 */
export interface EducationStore {
  // --- I2: directory ---
  insertSchool(record: SchoolRecord): Promise<void>;
  getSchool(id: SchoolId): Promise<SchoolRecord | null>;
  findSchoolByIdentity(key: {
    officialName: string;
    province: string | null;
    district: string | null;
    ward: string | null;
    address: string | null;
  }): Promise<SchoolRecord | null>;
  searchSchools(query: SchoolSearchQuery): Promise<readonly SchoolRecord[]>;

  insertAcademicYear(record: AcademicYearRecord): Promise<void>;
  getAcademicYear(id: AcademicYearId): Promise<AcademicYearRecord | null>;
  findAcademicYearByLabel(label: string): Promise<AcademicYearRecord | null>;
  listAcademicYears(): Promise<readonly AcademicYearRecord[]>;

  getSubject(id: SubjectId): Promise<SubjectRecord | null>;
  findSubjectByCode(code: SubjectCode): Promise<SubjectRecord | null>;
  insertSubject(record: SubjectRecord): Promise<void>;
  listSubjects(): Promise<readonly SubjectRecord[]>;

  insertClassroom(record: ClassroomRecord): Promise<void>;
  getClassroom(id: ClassroomId): Promise<ClassroomRecord | null>;
  findClassroomByIdentity(key: {
    schoolId: SchoolId;
    academicYearId: AcademicYearId;
    grade: number;
    className: string;
  }): Promise<ClassroomRecord | null>;
  listClassrooms(schoolId: SchoolId, academicYearId: AcademicYearId): Promise<readonly ClassroomRecord[]>;

  // --- I2: teacher ↔ school / class ---
  insertTeacherSchoolMembership(record: TeacherSchoolMembershipRecord): Promise<void>;
  listTeacherSchoolMemberships(teacherUserId: string): Promise<readonly TeacherSchoolMembershipRecord[]>;
  insertTeacherClassAssignment(record: TeacherClassAssignmentRecord): Promise<void>;
  updateTeacherClassAssignment(
    id: string,
    patch: { status?: TeacherClassAssignmentRecord['status']; endedAt?: string | null },
  ): Promise<void>;
  getTeacherClassAssignment(id: string): Promise<TeacherClassAssignmentRecord | null>;
  listTeacherClassAssignmentsForTeacher(teacherUserId: string): Promise<readonly TeacherClassAssignmentRecord[]>;
  listTeacherClassAssignmentsForClassroom(classroomId: ClassroomId): Promise<readonly TeacherClassAssignmentRecord[]>;

  // --- I3: enrollment history ---
  insertSchoolEnrollment(record: StudentSchoolEnrollmentRecord): Promise<void>;
  updateSchoolEnrollment(id: string, patch: SchoolEnrollmentPatch): Promise<void>;
  getSchoolEnrollment(id: string): Promise<StudentSchoolEnrollmentRecord | null>;
  listSchoolEnrollments(childId: string): Promise<readonly StudentSchoolEnrollmentRecord[]>;

  insertClassEnrollment(record: StudentClassEnrollmentRecord): Promise<void>;
  updateClassEnrollment(id: string, patch: ClassEnrollmentPatch): Promise<void>;
  getClassEnrollment(id: string): Promise<StudentClassEnrollmentRecord | null>;
  listClassEnrollments(childId: string): Promise<readonly StudentClassEnrollmentRecord[]>;

  // --- I6: transitions ---
  insertTransition(record: EnrollmentTransitionRecord): Promise<void>;
  updateTransition(id: string, patch: TransitionPatch): Promise<void>;
  getTransition(id: string): Promise<EnrollmentTransitionRecord | null>;
  listTransitions(childId: string): Promise<readonly EnrollmentTransitionRecord[]>;
}

// ---------------------------------------------------------------------------

const clone = <T>(v: T): T => structuredClone(v);
const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

export class InMemoryEducationStore implements EducationStore {
  readonly #schools = new Map<string, SchoolRecord>();
  readonly #years = new Map<string, AcademicYearRecord>();
  readonly #subjects = new Map<string, SubjectRecord>();
  readonly #classrooms = new Map<string, ClassroomRecord>();
  readonly #teacherSchool: TeacherSchoolMembershipRecord[] = [];
  readonly #teacherClass = new Map<string, TeacherClassAssignmentRecord>();
  readonly #schoolEnroll = new Map<string, StudentSchoolEnrollmentRecord>();
  readonly #classEnroll = new Map<string, StudentClassEnrollmentRecord>();
  readonly #transitions = new Map<string, EnrollmentTransitionRecord>();

  // --- I2 ---
  insertSchool(record: SchoolRecord): Promise<void> {
    this.#schools.set(record.id, clone(record));
    return Promise.resolve();
  }
  getSchool(id: SchoolId): Promise<SchoolRecord | null> {
    const s = this.#schools.get(id);
    return Promise.resolve(s ? clone(s) : null);
  }
  findSchoolByIdentity(key: {
    officialName: string;
    province: string | null;
    district: string | null;
    ward: string | null;
    address: string | null;
  }): Promise<SchoolRecord | null> {
    for (const s of this.#schools.values()) {
      if (
        norm(s.officialName) === norm(key.officialName) &&
        norm(s.province) === norm(key.province) &&
        norm(s.district) === norm(key.district) &&
        norm(s.ward) === norm(key.ward) &&
        norm(s.address) === norm(key.address)
      ) {
        return Promise.resolve(clone(s));
      }
    }
    return Promise.resolve(null);
  }
  searchSchools(query: SchoolSearchQuery): Promise<readonly SchoolRecord[]> {
    const nf = norm(query.nameFragment);
    return Promise.resolve(
      [...this.#schools.values()]
        .filter((s) => {
          if (nf && !norm(s.officialName).includes(nf) && !norm(s.shortName).includes(nf)) return false;
          if (query.province && norm(s.province) !== norm(query.province)) return false;
          if (query.district && norm(s.district) !== norm(query.district)) return false;
          return true;
        })
        .map(clone),
    );
  }

  insertAcademicYear(record: AcademicYearRecord): Promise<void> {
    this.#years.set(record.id, clone(record));
    return Promise.resolve();
  }
  getAcademicYear(id: AcademicYearId): Promise<AcademicYearRecord | null> {
    const y = this.#years.get(id);
    return Promise.resolve(y ? clone(y) : null);
  }
  findAcademicYearByLabel(label: string): Promise<AcademicYearRecord | null> {
    for (const y of this.#years.values()) if (y.label === label) return Promise.resolve(clone(y));
    return Promise.resolve(null);
  }
  listAcademicYears(): Promise<readonly AcademicYearRecord[]> {
    return Promise.resolve([...this.#years.values()].sort((a, b) => a.label.localeCompare(b.label)).map(clone));
  }

  getSubject(id: SubjectId): Promise<SubjectRecord | null> {
    const s = this.#subjects.get(id);
    return Promise.resolve(s ? clone(s) : null);
  }
  findSubjectByCode(code: SubjectCode): Promise<SubjectRecord | null> {
    for (const s of this.#subjects.values()) if (s.code === code) return Promise.resolve(clone(s));
    return Promise.resolve(null);
  }
  insertSubject(record: SubjectRecord): Promise<void> {
    this.#subjects.set(record.id, clone(record));
    return Promise.resolve();
  }
  listSubjects(): Promise<readonly SubjectRecord[]> {
    return Promise.resolve([...this.#subjects.values()].map(clone));
  }

  insertClassroom(record: ClassroomRecord): Promise<void> {
    this.#classrooms.set(record.id, clone(record));
    return Promise.resolve();
  }
  getClassroom(id: ClassroomId): Promise<ClassroomRecord | null> {
    const c = this.#classrooms.get(id);
    return Promise.resolve(c ? clone(c) : null);
  }
  findClassroomByIdentity(key: {
    schoolId: SchoolId;
    academicYearId: AcademicYearId;
    grade: number;
    className: string;
  }): Promise<ClassroomRecord | null> {
    for (const c of this.#classrooms.values()) {
      if (
        c.schoolId === key.schoolId &&
        c.academicYearId === key.academicYearId &&
        c.grade === key.grade &&
        norm(c.className) === norm(key.className)
      ) {
        return Promise.resolve(clone(c));
      }
    }
    return Promise.resolve(null);
  }
  listClassrooms(schoolId: SchoolId, academicYearId: AcademicYearId): Promise<readonly ClassroomRecord[]> {
    return Promise.resolve(
      [...this.#classrooms.values()]
        .filter((c) => c.schoolId === schoolId && c.academicYearId === academicYearId)
        .map(clone),
    );
  }

  insertTeacherSchoolMembership(record: TeacherSchoolMembershipRecord): Promise<void> {
    this.#teacherSchool.push(clone(record));
    return Promise.resolve();
  }
  listTeacherSchoolMemberships(teacherUserId: string): Promise<readonly TeacherSchoolMembershipRecord[]> {
    return Promise.resolve(this.#teacherSchool.filter((m) => m.teacherUserId === teacherUserId).map(clone));
  }
  insertTeacherClassAssignment(record: TeacherClassAssignmentRecord): Promise<void> {
    this.#teacherClass.set(record.id, clone(record));
    return Promise.resolve();
  }
  updateTeacherClassAssignment(
    id: string,
    patch: { status?: TeacherClassAssignmentRecord['status']; endedAt?: string | null },
  ): Promise<void> {
    const cur = this.#teacherClass.get(id);
    if (!cur) return Promise.reject(new Error(`teacher_class_assignment ${id} not found`));
    this.#teacherClass.set(id, { ...cur, ...stripUndefined(patch) });
    return Promise.resolve();
  }
  getTeacherClassAssignment(id: string): Promise<TeacherClassAssignmentRecord | null> {
    const a = this.#teacherClass.get(id);
    return Promise.resolve(a ? clone(a) : null);
  }
  listTeacherClassAssignmentsForTeacher(teacherUserId: string): Promise<readonly TeacherClassAssignmentRecord[]> {
    return Promise.resolve([...this.#teacherClass.values()].filter((a) => a.teacherUserId === teacherUserId).map(clone));
  }
  listTeacherClassAssignmentsForClassroom(classroomId: ClassroomId): Promise<readonly TeacherClassAssignmentRecord[]> {
    return Promise.resolve([...this.#teacherClass.values()].filter((a) => a.classroomId === classroomId).map(clone));
  }

  // --- I3 ---
  insertSchoolEnrollment(record: StudentSchoolEnrollmentRecord): Promise<void> {
    if (record.status === 'ACTIVE') {
      for (const e of this.#schoolEnroll.values()) {
        if (e.childId === record.childId && e.status === 'ACTIVE') {
          return Promise.reject(
            new Error(`child ${record.childId} already has an ACTIVE school enrollment`),
          );
        }
      }
    }
    this.#schoolEnroll.set(record.id, clone(record));
    return Promise.resolve();
  }
  updateSchoolEnrollment(id: string, patch: SchoolEnrollmentPatch): Promise<void> {
    const cur = this.#schoolEnroll.get(id);
    if (!cur) return Promise.reject(new Error(`school_enrollment ${id} not found`));
    this.#schoolEnroll.set(id, { ...cur, ...stripUndefined(patch) });
    return Promise.resolve();
  }
  getSchoolEnrollment(id: string): Promise<StudentSchoolEnrollmentRecord | null> {
    const e = this.#schoolEnroll.get(id);
    return Promise.resolve(e ? clone(e) : null);
  }
  listSchoolEnrollments(childId: string): Promise<readonly StudentSchoolEnrollmentRecord[]> {
    return Promise.resolve(
      [...this.#schoolEnroll.values()]
        .filter((e) => e.childId === childId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(clone),
    );
  }

  insertClassEnrollment(record: StudentClassEnrollmentRecord): Promise<void> {
    if (record.status === 'ACTIVE' && record.enrollmentType === 'PRIMARY') {
      for (const e of this.#classEnroll.values()) {
        if (
          e.childId === record.childId &&
          e.academicYearId === record.academicYearId &&
          e.status === 'ACTIVE' &&
          e.enrollmentType === 'PRIMARY'
        ) {
          return Promise.reject(
            new Error(
              `child ${record.childId} already has an ACTIVE PRIMARY class enrollment for academic year ${record.academicYearId}`,
            ),
          );
        }
      }
    }
    this.#classEnroll.set(record.id, clone(record));
    return Promise.resolve();
  }
  updateClassEnrollment(id: string, patch: ClassEnrollmentPatch): Promise<void> {
    const cur = this.#classEnroll.get(id);
    if (!cur) return Promise.reject(new Error(`class_enrollment ${id} not found`));
    if (patch.status === 'ACTIVE' && cur.enrollmentType === 'PRIMARY') {
      for (const e of this.#classEnroll.values()) {
        if (
          e.id !== id &&
          e.childId === cur.childId &&
          e.academicYearId === cur.academicYearId &&
          e.status === 'ACTIVE' &&
          e.enrollmentType === 'PRIMARY'
        ) {
          return Promise.reject(new Error(`child ${cur.childId} already has an ACTIVE PRIMARY class enrollment`));
        }
      }
    }
    this.#classEnroll.set(id, { ...cur, ...stripUndefined(patch) });
    return Promise.resolve();
  }
  getClassEnrollment(id: string): Promise<StudentClassEnrollmentRecord | null> {
    const e = this.#classEnroll.get(id);
    return Promise.resolve(e ? clone(e) : null);
  }
  listClassEnrollments(childId: string): Promise<readonly StudentClassEnrollmentRecord[]> {
    return Promise.resolve(
      [...this.#classEnroll.values()]
        .filter((e) => e.childId === childId)
        .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
        .map(clone),
    );
  }

  // --- I6 ---
  insertTransition(record: EnrollmentTransitionRecord): Promise<void> {
    for (const t of this.#transitions.values()) {
      if (
        t.childId === record.childId &&
        t.toAcademicYearId === record.toAcademicYearId &&
        (t.status === 'PROPOSED' || t.status === 'CONFIRMED')
      ) {
        return Promise.reject(
          new Error(`child ${record.childId} already has a live transition for the target year`),
        );
      }
    }
    this.#transitions.set(record.id, clone(record));
    return Promise.resolve();
  }
  updateTransition(id: string, patch: TransitionPatch): Promise<void> {
    const cur = this.#transitions.get(id);
    if (!cur) return Promise.reject(new Error(`transition ${id} not found`));
    this.#transitions.set(id, { ...cur, ...stripUndefined(patch) });
    return Promise.resolve();
  }
  getTransition(id: string): Promise<EnrollmentTransitionRecord | null> {
    const t = this.#transitions.get(id);
    return Promise.resolve(t ? clone(t) : null);
  }
  listTransitions(childId: string): Promise<readonly EnrollmentTransitionRecord[]> {
    return Promise.resolve(
      [...this.#transitions.values()]
        .filter((t) => t.childId === childId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(clone),
    );
  }
}

export function stripUndefined<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Re-exported for consumers that only need the resolution shape. */
export type { ActiveEnrollmentResolution, ClassEnrollmentType };
