/**
 * Identity / Family vocabulary (migration group I1 — docs 19, 22, 23).
 *
 * NON-NEGOTIABLE invariants encoded here as types:
 *  - Child ≠ User  (a Child Profile exists with no login; `ChildId` never changes)
 *  - User ≠ Role   (`WorkspaceRole` is M:N — one identity may be PARENT + TEACHER + …)
 *  - Guardian authority is a **capability set with provenance**, never
 *    `is_legal_guardian` alone (ID-Q6).
 *
 * No I/O here — see `@copilot/identity` for the services and stores.
 */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Domain identity id — stable forever, independent of the auth provider. */
export type UserId = Brand<string, 'UserId'>;
/** Household / billing / group context id (NOT the guardianship model). */
export type FamilyId = Brand<string, 'FamilyId'>;

export const asUserId = (raw: string): UserId => raw as UserId;
export const asFamilyId = (raw: string): FamilyId => raw as FamilyId;

/** A role is *held*, not assigned to a row. Workspace = the role the client acts as. */
export const WORKSPACE_ROLES = ['PARENT', 'STUDENT', 'TEACHER', 'ADMIN'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DELETED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const FAMILY_MEMBER_ROLES = ['OWNER', 'GUARDIAN', 'VIEWER'] as const;
export type FamilyMemberRole = (typeof FAMILY_MEMBER_ROLES)[number];

export const PARENT_CHILD_RELATIONSHIP_TYPES = ['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER'] as const;
export type ParentChildRelationshipType = (typeof PARENT_CHILD_RELATIONSHIP_TYPES)[number];

export const RELATIONSHIP_STATUSES = ['ACTIVE', 'REVOKED'] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

/**
 * How a guardian relationship's authority was established. NEVER inferred from
 * `is_legal_guardian` (which is a nullable, verification-aware hint only).
 */
export const GUARDIAN_AUTHORITY_SOURCES = [
  'SELF_DECLARED',
  'INVITED_BY_EXISTING_GUARDIAN',
  'VERIFIED',
  'MIGRATED_FAMILY_OWNER',
] as const;
export type GuardianAuthoritySource = (typeof GUARDIAN_AUTHORITY_SOURCES)[number];

/** The explicit capabilities a guardian relationship may carry (ID-Q6). */
export const GUARDIAN_CAPABILITIES = [
  'can_manage_child',
  'can_manage_privacy',
  'can_approve_teacher_relationships',
] as const;
export type GuardianCapability = (typeof GUARDIAN_CAPABILITIES)[number];

export const STUDENT_LINK_METHODS = ['PARENT_INVITE', 'CLAIM_CODE', 'GUARDIAN_MANUAL'] as const;
export type StudentLinkMethod = (typeof STUDENT_LINK_METHODS)[number];

export const STUDENT_LINK_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export type StudentLinkStatus = (typeof STUDENT_LINK_STATUSES)[number];

// --- records -------------------------------------------------------------

export interface UserRecord {
  readonly id: UserId;
  readonly authUserId: string | null;
  readonly primaryEmail: string | null;
  readonly primaryPhone: string | null;
  readonly displayName: string | null;
  readonly locale: string;
  readonly status: UserStatus;
  readonly createdAt: string;
}

export interface UserRoleRecord {
  readonly userId: UserId;
  readonly role: WorkspaceRole;
  readonly grantedAt: string;
  readonly grantedBy: UserId | null;
}

export interface ParentProfileRecord {
  readonly userId: UserId;
  readonly displayName: string;
  readonly contactVisibility: 'PRIVATE' | 'FAMILY' | 'CONNECTED';
  readonly createdAt: string;
}

export interface TeacherProfileRecord {
  readonly userId: UserId;
  readonly displayName: string;
  readonly headline: string | null;
  readonly subjectsTaught: readonly string[];
  readonly verificationStatus: 'UNVERIFIED' | 'COMMUNITY_VERIFIED' | 'SYSTEM_VERIFIED';
  readonly createdAt: string;
}

export interface FamilyMembershipRecord {
  readonly familyId: FamilyId;
  readonly userId: UserId;
  readonly memberRole: FamilyMemberRole;
  readonly joinedAt: string;
}

export interface ParentChildRelationshipRecord {
  readonly id: string;
  readonly parentUserId: UserId;
  readonly childId: string;
  readonly relationshipType: ParentChildRelationshipType;
  readonly canManageChild: boolean;
  readonly canManagePrivacy: boolean;
  readonly canApproveTeacherRelationships: boolean;
  readonly authoritySource: GuardianAuthoritySource;
  /** Nullable, verification-aware — NEVER the sole authorization predicate. */
  readonly isLegalGuardian: boolean | null;
  readonly status: RelationshipStatus;
  readonly validFrom: string | null;
  readonly validUntil: string | null;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface StudentAccountLinkRecord {
  readonly id: string;
  readonly userId: UserId;
  readonly childId: string;
  readonly linkedByUserId: UserId | null;
  readonly linkMethod: StudentLinkMethod;
  readonly status: StudentLinkStatus;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

/** Resolved guardian authority for a `(user, child)` pair — the OR of ACTIVE rows. */
export interface GuardianAuthority {
  readonly canManageChild: boolean;
  readonly canManagePrivacy: boolean;
  readonly canApproveTeacherRelationships: boolean;
  /** true iff at least one ACTIVE relationship row exists for the pair. */
  readonly isGuardian: boolean;
}

export const NO_GUARDIAN_AUTHORITY: GuardianAuthority = {
  canManageChild: false,
  canManagePrivacy: false,
  canApproveTeacherRelationships: false,
  isGuardian: false,
};

export const GUARDIAN_CAPABILITY_TO_FIELD: Record<GuardianCapability, keyof GuardianAuthority> = {
  can_manage_child: 'canManageChild',
  can_manage_privacy: 'canManagePrivacy',
  can_approve_teacher_relationships: 'canApproveTeacherRelationships',
};
