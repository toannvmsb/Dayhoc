/**
 * Education directory + enrollment vocabulary (migration groups I2–I3, I6 —
 * docs 20, 23, 24).
 *
 * Invariants encoded here:
 *  - A School is NOT identified by name — `(official_name, province, district,
 *    ward, address)` is the soft identity key (E-1).
 *  - Academic Year is first-class; a classroom belongs to exactly one
 *    academic year (E-2).
 *  - Enrollment history is never overwritten — a change is a NEW row + a
 *    terminal status on the old one (E-3, P-1).
 *  - Exactly one ACTIVE PRIMARY class enrollment per Child per academic period;
 *    supplementary enrollments are unconstrained (E-7).
 *
 * No I/O — see `@copilot/education-directory` for services and stores.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SchoolId = Brand<string, 'SchoolId'>;
export type AcademicYearId = Brand<string, 'AcademicYearId'>;
export type SubjectId = Brand<string, 'SubjectId'>;
export type ClassroomId = Brand<string, 'ClassroomId'>;

export const asSchoolId = (raw: string): SchoolId => raw as SchoolId;
export const asAcademicYearId = (raw: string): AcademicYearId => raw as AcademicYearId;
export const asSubjectId = (raw: string): SubjectId => raw as SubjectId;
export const asClassroomId = (raw: string): ClassroomId => raw as ClassroomId;

export const SCHOOL_TYPES = [
  'PRIMARY',
  'LOWER_SECONDARY',
  'UPPER_SECONDARY',
  'K12',
  'OTHER',
] as const;
export type SchoolType = (typeof SCHOOL_TYPES)[number];

/** Applies to schools + classrooms + teacher memberships/assignments. */
export const DIRECTORY_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'COMMUNITY_VERIFIED',
  'SYSTEM_VERIFIED',
] as const;
export type DirectoryVerificationStatus = (typeof DIRECTORY_VERIFICATION_STATUSES)[number];

export const ACADEMIC_YEAR_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED'] as const;
export type AcademicYearStatus = (typeof ACADEMIC_YEAR_STATUSES)[number];

export const SUBJECT_STATUSES = ['ACTIVE', 'PLANNED'] as const;
export type SubjectStatus = (typeof SUBJECT_STATUSES)[number];

/** MVP: MATH ACTIVE, the rest PLANNED (doc 20 §2.3). */
export const SUBJECT_CODES = ['MATH', 'VIETNAMESE', 'ENGLISH', 'SCIENCE'] as const;
export type SubjectCode = (typeof SUBJECT_CODES)[number];

export const CLASSROOM_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ClassroomStatus = (typeof CLASSROOM_STATUSES)[number];

// --- enrollment -----------------------------------------------------------

export const SCHOOL_ENROLLMENT_STATUSES = [
  'PROPOSED',
  'ACTIVE',
  'COMPLETED',
  'TRANSFERRED',
  'WITHDRAWN',
  'REPEATED',
] as const;
export type SchoolEnrollmentStatus = (typeof SCHOOL_ENROLLMENT_STATUSES)[number];

export const CLASS_ENROLLMENT_STATUSES = ['PROPOSED', 'ACTIVE', 'LEFT'] as const;
export type ClassEnrollmentStatus = (typeof CLASS_ENROLLMENT_STATUSES)[number];

/**
 * Only `PRIMARY` participates in school-grade context, the Curriculum Clock
 * default classroom, academic progression, grade advancement and the class-name
 * suggestion (E-7, Amendment 2). Supplementary types may coexist without limit.
 */
export const CLASS_ENROLLMENT_TYPES = [
  'PRIMARY',
  'SUPPLEMENTARY',
  'HSG_TEAM',
  'TUTOR_GROUP',
  'CLUB',
  'OTHER',
] as const;
export type ClassEnrollmentType = (typeof CLASS_ENROLLMENT_TYPES)[number];

export const PRIVACY_MODES = ['PRIVATE_LEARNING', 'LINKED_PRIVATE', 'LINKED_SHARED'] as const;
export type PrivacyMode = (typeof PRIVACY_MODES)[number];

export const ENROLLMENT_SOURCES = [
  'PARENT',
  'TEACHER',
  'SCHOOL',
  'SYSTEM_PROPOSED',
  'SYSTEM_SUGGESTED',
] as const;
export type EnrollmentSource = (typeof ENROLLMENT_SOURCES)[number];

export const ENROLLMENT_VERIFICATION_STATUSES = ['SELF_DECLARED', 'SCHOOL_VERIFIED'] as const;
export type EnrollmentVerificationStatus = (typeof ENROLLMENT_VERIFICATION_STATUSES)[number];

// --- progression (I6) ---------------------------------------------------

export const ENROLLMENT_TRANSITION_TYPES = [
  'PROMOTION',
  'CLASS_CHANGE',
  'SCHOOL_TRANSFER',
  'REPEAT_GRADE',
  'MANUAL_CORRECTION',
  'GRADUATION',
] as const;
export type EnrollmentTransitionType = (typeof ENROLLMENT_TRANSITION_TYPES)[number];

export const ENROLLMENT_TRANSITION_STATUSES = ['PROPOSED', 'CONFIRMED', 'CANCELLED'] as const;
export type EnrollmentTransitionStatus = (typeof ENROLLMENT_TRANSITION_STATUSES)[number];

export const TRANSITION_PROPOSERS = ['SYSTEM', 'PARENT', 'TEACHER', 'SCHOOL'] as const;
export type TransitionProposer = (typeof TRANSITION_PROPOSERS)[number];

// --- teacher ↔ school / class ------------------------------------------

export const TEACHER_SCHOOL_ROLES = ['STAFF', 'HOMEROOM', 'SUBJECT', 'ADMIN'] as const;
export type TeacherSchoolRole = (typeof TEACHER_SCHOOL_ROLES)[number];

export const TEACHER_CLASS_ROLES = ['CLASS_TEACHER', 'SUBJECT_TEACHER', 'ASSISTANT'] as const;
export type TeacherClassRole = (typeof TEACHER_CLASS_ROLES)[number];

export const MEMBERSHIP_STATUSES = ['ACTIVE', 'ENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

// --- records -----------------------------------------------------------

export interface SchoolRecord {
  readonly id: SchoolId;
  readonly officialName: string;
  readonly shortName: string | null;
  readonly schoolType: SchoolType;
  readonly officialSchoolCode: string | null;
  readonly province: string | null;
  readonly district: string | null;
  readonly ward: string | null;
  readonly address: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly verificationStatus: DirectoryVerificationStatus;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AcademicYearRecord {
  readonly id: AcademicYearId;
  readonly label: string; // "2026-2027"
  readonly startDate: string; // ISO date
  readonly endDate: string; // ISO date
  readonly region: string | null;
  readonly status: AcademicYearStatus;
}

export interface SubjectRecord {
  readonly id: SubjectId;
  readonly code: SubjectCode;
  readonly name: string;
  readonly status: SubjectStatus;
}

export interface ClassroomRecord {
  readonly id: ClassroomId;
  readonly schoolId: SchoolId;
  readonly academicYearId: AcademicYearId;
  readonly grade: number;
  readonly className: string; // "7C0" — display label, NOT identity
  readonly displayName: string | null;
  readonly verificationStatus: DirectoryVerificationStatus;
  readonly status: ClassroomStatus;
  readonly createdBy: string | null;
  readonly createdAt: string;
  readonly archivedAt: string | null;
}

export interface StudentSchoolEnrollmentRecord {
  readonly id: string;
  readonly childId: string;
  readonly schoolId: SchoolId | null; // nullable for legacy-migrated rows only
  readonly academicYearId: AcademicYearId;
  readonly grade: number;
  readonly curriculumId: string;
  readonly calendarId: string | null;
  readonly status: SchoolEnrollmentStatus;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly source: EnrollmentSource;
  readonly verificationStatus: EnrollmentVerificationStatus;
  readonly createdAt: string;
}

export interface StudentClassEnrollmentRecord {
  readonly id: string;
  readonly childId: string;
  readonly classroomId: ClassroomId;
  readonly academicYearId: AcademicYearId;
  readonly schoolEnrollmentId: string | null;
  readonly enrollmentType: ClassEnrollmentType;
  readonly privacyMode: PrivacyMode;
  readonly status: ClassEnrollmentStatus;
  readonly joinedAt: string;
  readonly leftAt: string | null;
  readonly source: EnrollmentSource;
  readonly verifiedBy: string | null;
  readonly verifiedAt: string | null;
}

export interface EnrollmentTransitionRecord {
  readonly id: string;
  readonly childId: string;
  readonly transitionType: EnrollmentTransitionType;
  readonly fromSchoolId: SchoolId | null;
  readonly fromClassroomId: ClassroomId | null;
  readonly fromAcademicYearId: AcademicYearId | null;
  readonly fromGrade: number | null;
  readonly toSchoolId: SchoolId | null;
  readonly toClassroomId: ClassroomId | null;
  readonly toAcademicYearId: AcademicYearId;
  readonly toGrade: number | null;
  readonly suggestedClassName: string | null;
  readonly status: EnrollmentTransitionStatus;
  readonly requiresSchoolConfirmation: boolean;
  readonly proposedBy: TransitionProposer;
  readonly proposedByUserId: string | null;
  readonly confirmedByUserId: string | null;
  readonly createdAt: string;
  readonly confirmedAt: string | null;
}

export interface TeacherSchoolMembershipRecord {
  readonly id: string;
  readonly teacherUserId: string;
  readonly schoolId: SchoolId;
  readonly role: TeacherSchoolRole;
  readonly status: MembershipStatus;
  readonly verificationStatus: 'SELF_DECLARED' | 'SCHOOL_VERIFIED';
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly createdAt: string;
}

export interface TeacherClassAssignmentRecord {
  readonly id: string;
  readonly teacherUserId: string;
  readonly classroomId: ClassroomId;
  readonly academicYearId: AcademicYearId;
  readonly subjectId: SubjectId;
  readonly role: TeacherClassRole;
  readonly status: MembershipStatus;
  readonly verificationStatus: 'SELF_DECLARED' | 'SCHOOL_VERIFIED' | 'PARENT_CONFIRMED';
  readonly createdAt: string;
  readonly endedAt: string | null;
}

/** Resolved ACTIVE enrollment for the Curriculum Clock (doc 20 §5). */
export interface ActiveEnrollmentResolution {
  readonly schoolEnrollmentId: string;
  readonly curriculumId: string;
  readonly grade: number;
  readonly academicYearLabel: string;
  readonly academicYearId: AcademicYearId;
  readonly calendarId: string | null;
  readonly primaryClassroomId: ClassroomId | null;
}

/**
 * Deterministic class-name suggestion (ID-Q7 — no `class_cohorts`).
 * `7C0` at grade 8 → `8C0`; `7A2` → `8A2`; `6/1` → `7/1`. No leading grade
 * number → no suggestion.
 */
export function suggestNextClassName(className: string, toGrade: number): string | null {
  const m = /^(\d{1,2})(.*)$/.exec(className.trim());
  if (!m) return null;
  return `${toGrade}${m[2] ?? ''}`;
}
