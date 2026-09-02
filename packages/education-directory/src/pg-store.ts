import type { Pool, PoolClient } from 'pg';
type Queryable = Pool | PoolClient;
import {
  asAcademicYearId,
  asClassroomId,
  asSchoolId,
  asSubjectId,
  type AcademicYearId,
  type AcademicYearRecord,
  type ClassroomId,
  type ClassroomRecord,
  type EnrollmentTransitionRecord,
  type SchoolId,
  type SchoolRecord,
  type StudentClassEnrollmentRecord,
  type StudentSchoolEnrollmentRecord,
  type SubjectCode,
  type SubjectId,
  type SubjectRecord,
  type TeacherClassAssignmentRecord,
  type TeacherSchoolMembershipRecord,
} from '@copilot/domain';
import type {
  ClassEnrollmentPatch,
  EducationStore,
  SchoolEnrollmentPatch,
  SchoolSearchQuery,
  TransitionPatch,
} from './store.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoN = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const dateN = (v: unknown): string | null =>
  v === null || v === undefined ? null : iso(v).slice(0, 10);
const numN = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function rowToSchool(r: any): SchoolRecord {
  return {
    id: asSchoolId(r.id),
    officialName: r.official_name,
    shortName: r.short_name ?? null,
    schoolType: r.school_type,
    officialSchoolCode: r.official_school_code ?? null,
    province: r.province ?? null,
    district: r.district ?? null,
    ward: r.ward ?? null,
    address: r.address ?? null,
    latitude: numN(r.latitude),
    longitude: numN(r.longitude),
    verificationStatus: r.verification_status,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
function rowToYear(r: any): AcademicYearRecord {
  return {
    id: asAcademicYearId(r.id),
    label: r.label,
    startDate: dateN(r.start_date)!,
    endDate: dateN(r.end_date)!,
    region: r.region ?? null,
    status: r.status,
  };
}
function rowToSubject(r: any): SubjectRecord {
  return { id: asSubjectId(r.id), code: r.code, name: r.name, status: r.status };
}
function rowToClassroom(r: any): ClassroomRecord {
  return {
    id: asClassroomId(r.id),
    schoolId: asSchoolId(r.school_id),
    academicYearId: asAcademicYearId(r.academic_year_id),
    grade: r.grade,
    className: r.class_name,
    displayName: r.display_name ?? null,
    verificationStatus: r.verification_status,
    status: r.status,
    createdBy: r.created_by ?? null,
    createdAt: iso(r.created_at),
    archivedAt: isoN(r.archived_at),
  };
}
function rowToSchoolEnrollment(r: any): StudentSchoolEnrollmentRecord {
  return {
    id: r.id,
    childId: r.child_id,
    schoolId: r.school_id ? asSchoolId(r.school_id) : null,
    academicYearId: asAcademicYearId(r.academic_year_id),
    grade: r.grade,
    curriculumId: r.curriculum_id,
    calendarId: r.calendar_id ?? null,
    status: r.status,
    startDate: dateN(r.start_date),
    endDate: dateN(r.end_date),
    source: r.source,
    verificationStatus: r.verification_status,
    createdAt: iso(r.created_at),
  };
}
function rowToClassEnrollment(r: any): StudentClassEnrollmentRecord {
  return {
    id: r.id,
    childId: r.child_id,
    classroomId: asClassroomId(r.classroom_id),
    academicYearId: asAcademicYearId(r.academic_year_id),
    schoolEnrollmentId: r.school_enrollment_id ?? null,
    enrollmentType: r.enrollment_type,
    privacyMode: r.privacy_mode,
    status: r.status,
    joinedAt: iso(r.joined_at),
    leftAt: isoN(r.left_at),
    source: r.source,
    verifiedBy: r.verified_by ?? null,
    verifiedAt: isoN(r.verified_at),
  };
}
function rowToTransition(r: any): EnrollmentTransitionRecord {
  return {
    id: r.id,
    childId: r.child_id,
    transitionType: r.transition_type,
    fromSchoolId: r.from_school_id ? asSchoolId(r.from_school_id) : null,
    fromClassroomId: r.from_classroom_id ? asClassroomId(r.from_classroom_id) : null,
    fromAcademicYearId: r.from_academic_year_id ? asAcademicYearId(r.from_academic_year_id) : null,
    fromGrade: numN(r.from_grade),
    toSchoolId: r.to_school_id ? asSchoolId(r.to_school_id) : null,
    toClassroomId: r.to_classroom_id ? asClassroomId(r.to_classroom_id) : null,
    toAcademicYearId: asAcademicYearId(r.to_academic_year_id),
    toGrade: numN(r.to_grade),
    suggestedClassName: r.suggested_class_name ?? null,
    status: r.status,
    requiresSchoolConfirmation: r.requires_school_confirmation,
    proposedBy: r.proposed_by,
    proposedByUserId: r.proposed_by_user_id ?? null,
    confirmedByUserId: r.confirmed_by_user_id ?? null,
    createdAt: iso(r.created_at),
    confirmedAt: isoN(r.confirmed_at),
  };
}
function rowToTsm(r: any): TeacherSchoolMembershipRecord {
  return {
    id: r.id,
    teacherUserId: r.teacher_user_id,
    schoolId: asSchoolId(r.school_id),
    role: r.role,
    status: r.status,
    verificationStatus: r.verification_status,
    validFrom: dateN(r.valid_from),
    validUntil: dateN(r.valid_until),
    createdAt: iso(r.created_at),
  };
}
function rowToTca(r: any): TeacherClassAssignmentRecord {
  return {
    id: r.id,
    teacherUserId: r.teacher_user_id,
    classroomId: asClassroomId(r.classroom_id),
    academicYearId: asAcademicYearId(r.academic_year_id),
    subjectId: asSubjectId(r.subject_id),
    role: r.role,
    status: r.status,
    verificationStatus: r.verification_status,
    createdAt: iso(r.created_at),
    endedAt: isoN(r.ended_at),
  };
}

function setClause(patch: object, cols: Record<string, string>): { sql: string; vals: unknown[] } {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined || !cols[k]) continue;
    vals.push(v);
    sets.push(`${cols[k]} = $${vals.length}`);
  }
  return { sql: sets.join(', '), vals };
}

/** PostgreSQL backend for the education directory + enrollment + progression. */
export class PgEducationStore implements EducationStore {
  constructor(private readonly pool: Queryable) {}

  // --- I2 ---
  async insertSchool(r: SchoolRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO schools (id, official_name, short_name, school_type, official_school_code,
         province, district, ward, address, latitude, longitude, verification_status, created_by,
         created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        r.id, r.officialName, r.shortName, r.schoolType, r.officialSchoolCode,
        r.province, r.district, r.ward, r.address, r.latitude, r.longitude,
        r.verificationStatus, r.createdBy, r.createdAt, r.updatedAt,
      ],
    );
  }
  async getSchool(id: SchoolId): Promise<SchoolRecord | null> {
    const r = await this.pool.query(`SELECT * FROM schools WHERE id = $1`, [id]);
    return r.rows[0] ? rowToSchool(r.rows[0]) : null;
  }
  async findSchoolByIdentity(key: {
    officialName: string; province: string | null; district: string | null; ward: string | null; address: string | null;
  }): Promise<SchoolRecord | null> {
    const r = await this.pool.query(
      `SELECT * FROM schools WHERE lower(official_name) = lower($1)
         AND lower(coalesce(province,'')) = lower(coalesce($2,''))
         AND lower(coalesce(district,'')) = lower(coalesce($3,''))
         AND lower(coalesce(ward,'')) = lower(coalesce($4,''))
         AND lower(coalesce(address,'')) = lower(coalesce($5,''))`,
      [key.officialName, key.province, key.district, key.ward, key.address],
    );
    return r.rows[0] ? rowToSchool(r.rows[0]) : null;
  }
  async searchSchools(q: SchoolSearchQuery): Promise<readonly SchoolRecord[]> {
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (q.nameFragment) {
      vals.push(`%${q.nameFragment.toLowerCase()}%`);
      conds.push(`(lower(official_name) LIKE $${vals.length} OR lower(coalesce(short_name,'')) LIKE $${vals.length})`);
    }
    if (q.province) {
      vals.push(q.province);
      conds.push(`lower(coalesce(province,'')) = lower($${vals.length})`);
    }
    if (q.district) {
      vals.push(q.district);
      conds.push(`lower(coalesce(district,'')) = lower($${vals.length})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await this.pool.query(`SELECT * FROM schools ${where} ORDER BY official_name LIMIT 50`, vals);
    return r.rows.map(rowToSchool);
  }

  async insertAcademicYear(r: AcademicYearRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO academic_years (id, label, start_date, end_date, region, status)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (label) DO NOTHING`,
      [r.id, r.label, r.startDate, r.endDate, r.region, r.status],
    );
  }
  async getAcademicYear(id: AcademicYearId): Promise<AcademicYearRecord | null> {
    const r = await this.pool.query(`SELECT * FROM academic_years WHERE id = $1`, [id]);
    return r.rows[0] ? rowToYear(r.rows[0]) : null;
  }
  async findAcademicYearByLabel(label: string): Promise<AcademicYearRecord | null> {
    const r = await this.pool.query(`SELECT * FROM academic_years WHERE label = $1`, [label]);
    return r.rows[0] ? rowToYear(r.rows[0]) : null;
  }
  async listAcademicYears(): Promise<readonly AcademicYearRecord[]> {
    const r = await this.pool.query(`SELECT * FROM academic_years ORDER BY label`);
    return r.rows.map(rowToYear);
  }

  async getSubject(id: SubjectId): Promise<SubjectRecord | null> {
    const r = await this.pool.query(`SELECT * FROM subjects WHERE id = $1`, [id]);
    return r.rows[0] ? rowToSubject(r.rows[0]) : null;
  }
  async findSubjectByCode(code: SubjectCode): Promise<SubjectRecord | null> {
    const r = await this.pool.query(`SELECT * FROM subjects WHERE code = $1`, [code]);
    return r.rows[0] ? rowToSubject(r.rows[0]) : null;
  }
  async insertSubject(r: SubjectRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO subjects (id, code, name, status) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`,
      [r.id, r.code, r.name, r.status],
    );
  }
  async listSubjects(): Promise<readonly SubjectRecord[]> {
    const r = await this.pool.query(`SELECT * FROM subjects ORDER BY code`);
    return r.rows.map(rowToSubject);
  }

  async insertClassroom(r: ClassroomRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO classrooms (id, school_id, academic_year_id, grade, class_name, display_name,
         verification_status, status, created_by, created_at, archived_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        r.id, r.schoolId, r.academicYearId, r.grade, r.className, r.displayName,
        r.verificationStatus, r.status, r.createdBy, r.createdAt, r.archivedAt,
      ],
    );
  }
  async getClassroom(id: ClassroomId): Promise<ClassroomRecord | null> {
    const r = await this.pool.query(`SELECT * FROM classrooms WHERE id = $1`, [id]);
    return r.rows[0] ? rowToClassroom(r.rows[0]) : null;
  }
  async findClassroomByIdentity(key: {
    schoolId: SchoolId; academicYearId: AcademicYearId; grade: number; className: string;
  }): Promise<ClassroomRecord | null> {
    const r = await this.pool.query(
      `SELECT * FROM classrooms WHERE school_id = $1 AND academic_year_id = $2 AND grade = $3
         AND lower(class_name) = lower($4)`,
      [key.schoolId, key.academicYearId, key.grade, key.className],
    );
    return r.rows[0] ? rowToClassroom(r.rows[0]) : null;
  }
  async listClassrooms(schoolId: SchoolId, academicYearId: AcademicYearId): Promise<readonly ClassroomRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM classrooms WHERE school_id = $1 AND academic_year_id = $2 ORDER BY grade, class_name`,
      [schoolId, academicYearId],
    );
    return r.rows.map(rowToClassroom);
  }

  async insertTeacherSchoolMembership(r: TeacherSchoolMembershipRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO teacher_school_memberships (id, teacher_user_id, school_id, role, status,
         verification_status, valid_from, valid_until, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [r.id, r.teacherUserId, r.schoolId, r.role, r.status, r.verificationStatus, r.validFrom, r.validUntil, r.createdAt],
    );
  }
  async listTeacherSchoolMemberships(teacherUserId: string): Promise<readonly TeacherSchoolMembershipRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM teacher_school_memberships WHERE teacher_user_id = $1 ORDER BY created_at`,
      [teacherUserId],
    );
    return r.rows.map(rowToTsm);
  }
  async insertTeacherClassAssignment(r: TeacherClassAssignmentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO teacher_class_assignments (id, teacher_user_id, classroom_id, academic_year_id,
         subject_id, role, status, verification_status, created_at, ended_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        r.id, r.teacherUserId, r.classroomId, r.academicYearId, r.subjectId, r.role,
        r.status, r.verificationStatus, r.createdAt, r.endedAt,
      ],
    );
  }
  async updateTeacherClassAssignment(
    id: string,
    patch: { status?: TeacherClassAssignmentRecord['status']; endedAt?: string | null },
  ): Promise<void> {
    const { sql, vals } = setClause(patch, { status: 'status', endedAt: 'ended_at' });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE teacher_class_assignments SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getTeacherClassAssignment(id: string): Promise<TeacherClassAssignmentRecord | null> {
    const r = await this.pool.query(`SELECT * FROM teacher_class_assignments WHERE id = $1`, [id]);
    return r.rows[0] ? rowToTca(r.rows[0]) : null;
  }
  async listTeacherClassAssignmentsForTeacher(teacherUserId: string): Promise<readonly TeacherClassAssignmentRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM teacher_class_assignments WHERE teacher_user_id = $1 ORDER BY created_at`,
      [teacherUserId],
    );
    return r.rows.map(rowToTca);
  }
  async listTeacherClassAssignmentsForClassroom(classroomId: ClassroomId): Promise<readonly TeacherClassAssignmentRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM teacher_class_assignments WHERE classroom_id = $1 ORDER BY created_at`,
      [classroomId],
    );
    return r.rows.map(rowToTca);
  }

  // --- I3 ---
  async insertSchoolEnrollment(r: StudentSchoolEnrollmentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO student_school_enrollments (id, child_id, school_id, academic_year_id, grade,
         curriculum_id, calendar_id, status, start_date, end_date, source, verification_status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        r.id, r.childId, r.schoolId, r.academicYearId, r.grade, r.curriculumId, r.calendarId,
        r.status, r.startDate, r.endDate, r.source, r.verificationStatus, r.createdAt,
      ],
    );
  }
  async updateSchoolEnrollment(id: string, patch: SchoolEnrollmentPatch): Promise<void> {
    const { sql, vals } = setClause(patch, { status: 'status', endDate: 'end_date' });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE student_school_enrollments SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getSchoolEnrollment(id: string): Promise<StudentSchoolEnrollmentRecord | null> {
    const r = await this.pool.query(`SELECT * FROM student_school_enrollments WHERE id = $1`, [id]);
    return r.rows[0] ? rowToSchoolEnrollment(r.rows[0]) : null;
  }
  async listSchoolEnrollments(childId: string): Promise<readonly StudentSchoolEnrollmentRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM student_school_enrollments WHERE child_id = $1 ORDER BY created_at`,
      [childId],
    );
    return r.rows.map(rowToSchoolEnrollment);
  }

  async insertClassEnrollment(r: StudentClassEnrollmentRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO student_class_enrollments (id, child_id, classroom_id, academic_year_id,
         school_enrollment_id, enrollment_type, privacy_mode, status, joined_at, left_at, source,
         verified_by, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        r.id, r.childId, r.classroomId, r.academicYearId, r.schoolEnrollmentId, r.enrollmentType,
        r.privacyMode, r.status, r.joinedAt, r.leftAt, r.source, r.verifiedBy, r.verifiedAt,
      ],
    );
  }
  async updateClassEnrollment(id: string, patch: ClassEnrollmentPatch): Promise<void> {
    const { sql, vals } = setClause(patch, {
      status: 'status', privacyMode: 'privacy_mode', leftAt: 'left_at',
      verifiedBy: 'verified_by', verifiedAt: 'verified_at',
    });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE student_class_enrollments SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getClassEnrollment(id: string): Promise<StudentClassEnrollmentRecord | null> {
    const r = await this.pool.query(`SELECT * FROM student_class_enrollments WHERE id = $1`, [id]);
    return r.rows[0] ? rowToClassEnrollment(r.rows[0]) : null;
  }
  async listClassEnrollments(childId: string): Promise<readonly StudentClassEnrollmentRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM student_class_enrollments WHERE child_id = $1 ORDER BY joined_at`,
      [childId],
    );
    return r.rows.map(rowToClassEnrollment);
  }
  async listClassEnrollmentsForClassroom(classroomId: ClassroomId): Promise<readonly StudentClassEnrollmentRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM student_class_enrollments WHERE classroom_id = $1 ORDER BY joined_at`,
      [classroomId],
    );
    return r.rows.map(rowToClassEnrollment);
  }

  // --- I6 ---
  async insertTransition(r: EnrollmentTransitionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO enrollment_transitions (id, child_id, transition_type, from_school_id,
         from_classroom_id, from_academic_year_id, from_grade, to_school_id, to_classroom_id,
         to_academic_year_id, to_grade, suggested_class_name, status, requires_school_confirmation,
         proposed_by, proposed_by_user_id, confirmed_by_user_id, created_at, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        r.id, r.childId, r.transitionType, r.fromSchoolId, r.fromClassroomId, r.fromAcademicYearId,
        r.fromGrade, r.toSchoolId, r.toClassroomId, r.toAcademicYearId, r.toGrade, r.suggestedClassName,
        r.status, r.requiresSchoolConfirmation, r.proposedBy, r.proposedByUserId, r.confirmedByUserId,
        r.createdAt, r.confirmedAt,
      ],
    );
  }
  async updateTransition(id: string, patch: TransitionPatch): Promise<void> {
    const { sql, vals } = setClause(patch, {
      status: 'status', toSchoolId: 'to_school_id', toClassroomId: 'to_classroom_id',
      toGrade: 'to_grade', suggestedClassName: 'suggested_class_name',
      confirmedByUserId: 'confirmed_by_user_id', confirmedAt: 'confirmed_at',
    });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE enrollment_transitions SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getTransition(id: string): Promise<EnrollmentTransitionRecord | null> {
    const r = await this.pool.query(`SELECT * FROM enrollment_transitions WHERE id = $1`, [id]);
    return r.rows[0] ? rowToTransition(r.rows[0]) : null;
  }
  async listTransitions(childId: string): Promise<readonly EnrollmentTransitionRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM enrollment_transitions WHERE child_id = $1 ORDER BY created_at`,
      [childId],
    );
    return r.rows.map(rowToTransition);
  }
}
