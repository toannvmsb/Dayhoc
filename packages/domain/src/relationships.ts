/**
 * Learning-relationship + scoped-permission vocabulary (migration group I4 —
 * doc 21).
 *
 * Invariants encoded here:
 *  - Relationships may be initiated by BOTH Parent and Teacher (R-1).
 *  - A teacher-initiated Child request grants ZERO child-data access until an
 *    authorised guardian ACCEPTs (R-2).
 *  - Teacher–School / Teacher–Class / Teacher–Parent / Teacher–Child are
 *    independent (R-3). Relationship ≠ data sharing (R-4).
 *  - Sensitive permissions default OFF (R-5). There is no
 *    `teacher_can_view_child` boolean anywhere.
 *  - CLASS_CONTEXT_WRITE ≠ CHILD_SPECIFIC_WRITE (R-10). A classroom assignment
 *    never grants a sensitive Twin read (§3.1).
 */
import type { SubjectId } from './education.js';

export const RELATIONSHIP_KINDS = ['TEACHER_CHILD', 'TEACHER_PARENT'] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

export const RELATIONSHIP_TARGET_TYPES = ['PARENT', 'CHILD', 'TEACHER'] as const;
export type RelationshipTargetType = (typeof RELATIONSHIP_TARGET_TYPES)[number];

export const RELATIONSHIP_TYPES = [
  'CLASS_TEACHER',
  'SUBJECT_TEACHER',
  'PRIVATE_TUTOR',
  'COACH',
  'MENTOR',
  'OTHER',
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_REQUEST_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
] as const;
export type RelationshipRequestStatus = (typeof RELATIONSHIP_REQUEST_STATUSES)[number];

export const TEACHER_LINK_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
] as const;
export type TeacherLinkStatus = (typeof TEACHER_LINK_STATUSES)[number];

/** How a resulting grant is scoped (doc 21 §3). */
export const ACCESS_SOURCES = [
  'PARENT_DIRECT',
  'CLASS_ASSIGNMENT',
  'SCHOOL_AUTHORIZATION',
] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export const DISCOVERY_METHODS = [
  'INVITE_CODE',
  'PARENT_LINK',
  'CLASS_JOIN',
  'EMAIL_LOOKUP',
  'QR',
] as const;
export type DiscoveryMethod = (typeof DISCOVERY_METHODS)[number];

export const TEACHER_PARENT_PURPOSES = [
  'COMMUNICATION',
  'LEARNING_UPDATE',
  'ASSIGNMENT_COORDINATION',
  'EXAM_COMMUNICATION',
  'PARENT_GUIDANCE',
] as const;
export type TeacherParentPurpose = (typeof TEACHER_PARENT_PURPOSES)[number];

// --- permission codes -------------------------------------------------

export const PERMISSION_CODES = [
  'VIEW_CLASS_CONTEXT',
  'SUBMIT_CURRENT_LESSON',
  'SUBMIT_CURRICULUM_PROGRESS',
  'SUBMIT_HOMEWORK',
  'SUBMIT_TEST_RESULT',
  'SUBMIT_EXAM_NOTICE',
  'SUBMIT_EXAM_SCOPE',
  'SUBMIT_SKILL_ASSESSMENT',
  'SUBMIT_LEARNING_OBSERVATION',
  'CREATE_ASSIGNMENT',
  'VIEW_ASSIGNMENT_COMPLETION',
  'VIEW_SELECTED_MASTERY',
  'VIEW_SELECTED_GAPS',
  'VIEW_LEARNING_TWIN_SUMMARY',
  'MESSAGE_PARENT',
] as const;
export type PermissionCode = (typeof PERMISSION_CODES)[number];

/** Default OFF, guardian-only, NEVER class-derivable (R-5, §3.1). */
export const SENSITIVE_PERMISSION_CODES: readonly PermissionCode[] = [
  'VIEW_SELECTED_GAPS',
  'VIEW_LEARNING_TWIN_SUMMARY',
];

/**
 * Class-context write codes — may be derived from an ACTIVE Teacher–Class–Subject
 * assignment + LINKED_SHARED when ALL SIX §3.1 conditions hold (Amendment 3).
 */
export const CLASS_CONTEXT_WRITE_CODES: readonly PermissionCode[] = [
  'SUBMIT_CURRENT_LESSON',
  'SUBMIT_CURRICULUM_PROGRESS',
  'SUBMIT_HOMEWORK',
  'SUBMIT_EXAM_NOTICE',
  'SUBMIT_EXAM_SCOPE',
];

/**
 * Child-specific write codes — ALWAYS require an explicit per-Child PARENT_DIRECT
 * grant; a `CLASS_ASSIGNMENT`-sourced grant for one of these is denied (R-10).
 */
export const CHILD_SPECIFIC_WRITE_CODES: readonly PermissionCode[] = [
  'SUBMIT_SKILL_ASSESSMENT',
  'SUBMIT_LEARNING_OBSERVATION',
  'SUBMIT_TEST_RESULT',
];

/** Codes a `CLASS_ASSIGNMENT` access source may ever carry (doc 21 §3). */
export const CLASS_ASSIGNMENT_ALLOWED_CODES: readonly PermissionCode[] = [
  ...CLASS_CONTEXT_WRITE_CODES,
  'VIEW_CLASS_CONTEXT',
  'VIEW_ASSIGNMENT_COMPLETION',
];

/** The conservative permission set a migrated legacy `teacher_invites` gets (ID-Q3). */
export const LEGACY_MINIMAL_CODES: readonly PermissionCode[] = [
  'VIEW_CLASS_CONTEXT',
  'SUBMIT_CURRENT_LESSON',
];

// --- audit ----------------------------------------------------------

export const AUDIT_EVENT_TYPES = [
  'RELATIONSHIP_REQUEST_CREATED',
  'RELATIONSHIP_REQUEST_ACCEPTED',
  'RELATIONSHIP_REQUEST_REJECTED',
  'RELATIONSHIP_REQUEST_CANCELLED',
  'RELATIONSHIP_REQUEST_EXPIRED',
  'RELATIONSHIP_REVOKED',
  'RELATIONSHIP_MIGRATED',
  'PERMISSION_GRANTED',
  'PERMISSION_REVOKED',
  'PRIVACY_MODE_CHANGED',
  'PRIVACY_PREFERENCE_CHANGED',
  'ENROLLMENT_TRANSITION_CONFIRMED',
  'CHILD_DATA_ACCESS_DENIED',
  'STUDENT_ACCOUNT_LINKED',
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

// --- records ------------------------------------------------------

export interface RelationshipRequestRecord {
  readonly id: string;
  readonly requesterUserId: string;
  readonly requesterRole: 'PARENT' | 'TEACHER';
  readonly targetType: RelationshipTargetType;
  readonly targetUserId: string | null;
  readonly targetChildId: string | null;
  readonly relationshipKind: RelationshipKind;
  readonly relationshipType: RelationshipType;
  readonly subjectId: SubjectId | null;
  readonly accessSource: AccessSource;
  readonly proposedPermissions: readonly PermissionCode[];
  readonly message: string | null;
  readonly discoveryMethod: DiscoveryMethod;
  readonly status: RelationshipRequestStatus;
  readonly expiresAt: string;
  readonly respondedByUserId: string | null;
  readonly respondedAt: string | null;
  readonly approvedPermissions: readonly PermissionCode[] | null;
  readonly createdAt: string;
}

export interface TeacherChildLinkRecord {
  readonly id: string;
  readonly teacherUserId: string;
  readonly childId: string;
  readonly subjectId: SubjectId | null;
  readonly relationshipType: RelationshipType;
  readonly accessSource: AccessSource;
  readonly accessSourceId: string | null;
  readonly initiatedByRole: 'PARENT' | 'TEACHER';
  readonly initiatedByUserId: string;
  readonly originRequestId: string | null;
  readonly status: TeacherLinkStatus;
  readonly acceptedByParentUserId: string | null;
  readonly needsGuardianReview: boolean;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly acceptedAt: string | null;
  readonly rejectedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface TeacherParentLinkRecord {
  readonly id: string;
  readonly teacherUserId: string;
  readonly parentUserId: string;
  readonly childId: string | null;
  readonly subjectId: SubjectId | null;
  readonly purpose: TeacherParentPurpose;
  readonly initiatedByRole: 'PARENT' | 'TEACHER';
  readonly initiatedByUserId: string;
  readonly originRequestId: string | null;
  readonly status: TeacherLinkStatus;
  readonly acceptedByUserId: string | null;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface PermissionGrantRecord {
  readonly id: string;
  readonly subjectLinkType: RelationshipKind;
  readonly subjectLinkId: string;
  readonly permissionCode: PermissionCode;
  readonly subjectId: SubjectId | null;
  readonly accessSource: AccessSource;
  readonly grantedByUserId: string;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly grantedAt: string;
  readonly revokedAt: string | null;
}

export interface PrivacyPreferencesRecord {
  readonly childId: string;
  readonly defaultClassPrivacyMode: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED';
  readonly allowTeacherDiscoveryByEmail: boolean;
  readonly allowTeacherDiscoveryByClassJoin: boolean;
  readonly shareBehaviourObservationsWithChild: boolean;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

export interface AuditEventRecord {
  readonly id: string;
  readonly actorUserId: string | null;
  readonly actorWorkspace: string | null;
  readonly eventType: AuditEventType;
  readonly subjectType: string | null;
  readonly subjectId: string | null;
  readonly childId: string | null;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

/** The result of `can(...)` — an ALLOW/DENY plus the reason a DENY happened. */
export interface PermissionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}
