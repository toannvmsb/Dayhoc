import type {
  FamilyId,
  FamilyMembershipRecord,
  ParentChildRelationshipRecord,
  ParentProfileRecord,
  StudentAccountLinkRecord,
  StudentLinkStatus,
  TeacherProfileRecord,
  UserId,
  UserRecord,
  UserRoleRecord,
  WorkspaceRole,
} from '@copilot/domain';

/** A thin view of a Child Profile — identity only needs id + family + grade. */
export interface ChildStub {
  readonly id: string;
  readonly familyId: FamilyId;
  readonly displayName: string;
  readonly schoolGrade: number;
  readonly dateOfBirth: string | null;
}

export interface RelationshipPatch {
  readonly relationshipType?: ParentChildRelationshipRecord['relationshipType'];
  readonly canManageChild?: boolean;
  readonly canManagePrivacy?: boolean;
  readonly canApproveTeacherRelationships?: boolean;
  readonly authoritySource?: ParentChildRelationshipRecord['authoritySource'];
  readonly isLegalGuardian?: boolean | null;
  readonly status?: ParentChildRelationshipRecord['status'];
  readonly revokedAt?: string | null;
}

export interface StudentLinkPatch {
  readonly status?: StudentLinkStatus;
  readonly linkedByUserId?: UserId | null;
  readonly revokedAt?: string | null;
}

/**
 * The identity persistence port. Implemented by `InMemoryIdentityStore` (tests /
 * local) and `PgIdentityStore` (`@copilot/identity/pg`).
 *
 * Design rule: the store is dumb CRUD. All invariants (Child ≠ User, capability
 * resolution, no-duplicate-child, workspace ∈ roles) live in the services.
 */
export interface IdentityStore {
  // --- users ---
  insertUser(user: UserRecord): Promise<void>;
  getUser(id: UserId): Promise<UserRecord | null>;
  findUserByAuthId(authUserId: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;

  // --- roles ---
  addRole(record: UserRoleRecord): Promise<void>;
  listRoles(userId: UserId): Promise<readonly WorkspaceRole[]>;

  // --- profiles ---
  upsertParentProfile(profile: ParentProfileRecord): Promise<void>;
  upsertTeacherProfile(profile: TeacherProfileRecord): Promise<void>;
  getParentProfile(userId: UserId): Promise<ParentProfileRecord | null>;
  getTeacherProfile(userId: UserId): Promise<TeacherProfileRecord | null>;

  // --- families ---
  insertFamily(id: FamilyId, ownerParentId: UserId, createdAt: string): Promise<void>;
  familyExists(id: FamilyId): Promise<boolean>;
  addFamilyMembership(membership: FamilyMembershipRecord): Promise<void>;
  listFamilyMemberships(familyId: FamilyId): Promise<readonly FamilyMembershipRecord[]>;

  // --- children (child_profiles) ---
  insertChild(child: ChildStub): Promise<void>;
  getChild(id: string): Promise<ChildStub | null>;
  countChildren(): Promise<number>;

  // --- parent_child_relationships ---
  insertRelationship(record: ParentChildRelationshipRecord): Promise<void>;
  updateRelationship(id: string, patch: RelationshipPatch): Promise<void>;
  getRelationship(id: string): Promise<ParentChildRelationshipRecord | null>;
  listRelationshipsForChild(childId: string): Promise<readonly ParentChildRelationshipRecord[]>;
  listRelationshipsForPair(
    parentUserId: UserId,
    childId: string,
  ): Promise<readonly ParentChildRelationshipRecord[]>;

  // --- student_account_links ---
  insertStudentLink(record: StudentAccountLinkRecord): Promise<void>;
  updateStudentLink(id: string, patch: StudentLinkPatch): Promise<void>;
  getStudentLink(id: string): Promise<StudentAccountLinkRecord | null>;
  getActiveStudentLinkForChild(childId: string): Promise<StudentAccountLinkRecord | null>;
  listStudentLinksForUser(userId: UserId): Promise<readonly StudentAccountLinkRecord[]>;
}

// ---------------------------------------------------------------------------

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory backend. Deterministic, no network — the golden-test default. */
export class InMemoryIdentityStore implements IdentityStore {
  readonly #users = new Map<string, UserRecord>();
  readonly #roles: UserRoleRecord[] = [];
  readonly #parentProfiles = new Map<string, ParentProfileRecord>();
  readonly #teacherProfiles = new Map<string, TeacherProfileRecord>();
  readonly #families = new Map<string, { ownerParentId: UserId; createdAt: string }>();
  readonly #memberships: FamilyMembershipRecord[] = [];
  readonly #children = new Map<string, ChildStub>();
  readonly #relationships = new Map<string, ParentChildRelationshipRecord>();
  readonly #studentLinks = new Map<string, StudentAccountLinkRecord>();

  insertUser(user: UserRecord): Promise<void> {
    if (this.#users.has(user.id)) {
      return Promise.reject(new Error(`user ${user.id} already exists`));
    }
    this.#users.set(user.id, clone(user));
    return Promise.resolve();
  }

  getUser(id: UserId): Promise<UserRecord | null> {
    return Promise.resolve(this.#users.get(id) ? clone(this.#users.get(id)!) : null);
  }

  findUserByAuthId(authUserId: string): Promise<UserRecord | null> {
    for (const u of this.#users.values()) {
      if (u.authUserId === authUserId) return Promise.resolve(clone(u));
    }
    return Promise.resolve(null);
  }

  findUserByEmail(email: string): Promise<UserRecord | null> {
    const target = email.toLowerCase();
    for (const u of this.#users.values()) {
      if (u.primaryEmail?.toLowerCase() === target) return Promise.resolve(clone(u));
    }
    return Promise.resolve(null);
  }

  addRole(record: UserRoleRecord): Promise<void> {
    if (this.#roles.some((r) => r.userId === record.userId && r.role === record.role)) {
      return Promise.resolve(); // (user_id, role) PK — idempotent
    }
    this.#roles.push(clone(record));
    return Promise.resolve();
  }

  listRoles(userId: UserId): Promise<readonly WorkspaceRole[]> {
    return Promise.resolve(this.#roles.filter((r) => r.userId === userId).map((r) => r.role));
  }

  upsertParentProfile(profile: ParentProfileRecord): Promise<void> {
    this.#parentProfiles.set(profile.userId, clone(profile));
    return Promise.resolve();
  }

  upsertTeacherProfile(profile: TeacherProfileRecord): Promise<void> {
    this.#teacherProfiles.set(profile.userId, clone(profile));
    return Promise.resolve();
  }

  getParentProfile(userId: UserId): Promise<ParentProfileRecord | null> {
    const p = this.#parentProfiles.get(userId);
    return Promise.resolve(p ? clone(p) : null);
  }

  getTeacherProfile(userId: UserId): Promise<TeacherProfileRecord | null> {
    const p = this.#teacherProfiles.get(userId);
    return Promise.resolve(p ? clone(p) : null);
  }

  insertFamily(id: FamilyId, ownerParentId: UserId, createdAt: string): Promise<void> {
    if (this.#families.has(id)) return Promise.reject(new Error(`family ${id} already exists`));
    this.#families.set(id, { ownerParentId, createdAt });
    return Promise.resolve();
  }

  familyExists(id: FamilyId): Promise<boolean> {
    return Promise.resolve(this.#families.has(id));
  }

  addFamilyMembership(membership: FamilyMembershipRecord): Promise<void> {
    const existing = this.#memberships.find(
      (m) => m.familyId === membership.familyId && m.userId === membership.userId,
    );
    if (existing) return Promise.resolve(); // (family_id, user_id) PK — idempotent
    this.#memberships.push(clone(membership));
    return Promise.resolve();
  }

  listFamilyMemberships(familyId: FamilyId): Promise<readonly FamilyMembershipRecord[]> {
    return Promise.resolve(this.#memberships.filter((m) => m.familyId === familyId).map(clone));
  }

  insertChild(child: ChildStub): Promise<void> {
    if (this.#children.has(child.id)) {
      return Promise.reject(new Error(`child ${child.id} already exists`));
    }
    this.#children.set(child.id, clone(child));
    return Promise.resolve();
  }

  getChild(id: string): Promise<ChildStub | null> {
    const c = this.#children.get(id);
    return Promise.resolve(c ? clone(c) : null);
  }

  countChildren(): Promise<number> {
    return Promise.resolve(this.#children.size);
  }

  insertRelationship(record: ParentChildRelationshipRecord): Promise<void> {
    if (record.status === 'ACTIVE') {
      for (const r of this.#relationships.values()) {
        if (
          r.parentUserId === record.parentUserId &&
          r.childId === record.childId &&
          r.status === 'ACTIVE'
        ) {
          return Promise.reject(
            new Error(
              `an ACTIVE parent_child_relationship already exists for (${record.parentUserId}, ${record.childId})`,
            ),
          );
        }
      }
    }
    this.#relationships.set(record.id, clone(record));
    return Promise.resolve();
  }

  updateRelationship(id: string, patch: RelationshipPatch): Promise<void> {
    const current = this.#relationships.get(id);
    if (!current) return Promise.reject(new Error(`relationship ${id} not found`));
    this.#relationships.set(id, { ...current, ...stripUndefined(patch) });
    return Promise.resolve();
  }

  getRelationship(id: string): Promise<ParentChildRelationshipRecord | null> {
    const r = this.#relationships.get(id);
    return Promise.resolve(r ? clone(r) : null);
  }

  listRelationshipsForChild(childId: string): Promise<readonly ParentChildRelationshipRecord[]> {
    return Promise.resolve(
      [...this.#relationships.values()].filter((r) => r.childId === childId).map(clone),
    );
  }

  listRelationshipsForPair(
    parentUserId: UserId,
    childId: string,
  ): Promise<readonly ParentChildRelationshipRecord[]> {
    return Promise.resolve(
      [...this.#relationships.values()]
        .filter((r) => r.parentUserId === parentUserId && r.childId === childId)
        .map(clone),
    );
  }

  insertStudentLink(record: StudentAccountLinkRecord): Promise<void> {
    if (record.status === 'ACTIVE') {
      for (const l of this.#studentLinks.values()) {
        if (l.childId === record.childId && l.status === 'ACTIVE') {
          return Promise.reject(new Error(`child ${record.childId} already has an ACTIVE student link`));
        }
      }
    }
    this.#studentLinks.set(record.id, clone(record));
    return Promise.resolve();
  }

  updateStudentLink(id: string, patch: StudentLinkPatch): Promise<void> {
    const current = this.#studentLinks.get(id);
    if (!current) return Promise.reject(new Error(`student link ${id} not found`));
    if (patch.status === 'ACTIVE') {
      for (const l of this.#studentLinks.values()) {
        if (l.id !== id && l.childId === current.childId && l.status === 'ACTIVE') {
          return Promise.reject(
            new Error(`child ${current.childId} already has an ACTIVE student link`),
          );
        }
      }
    }
    this.#studentLinks.set(id, { ...current, ...stripUndefined(patch) });
    return Promise.resolve();
  }

  getStudentLink(id: string): Promise<StudentAccountLinkRecord | null> {
    const l = this.#studentLinks.get(id);
    return Promise.resolve(l ? clone(l) : null);
  }

  getActiveStudentLinkForChild(childId: string): Promise<StudentAccountLinkRecord | null> {
    for (const l of this.#studentLinks.values()) {
      if (l.childId === childId && l.status === 'ACTIVE') return Promise.resolve(clone(l));
    }
    return Promise.resolve(null);
  }

  listStudentLinksForUser(userId: UserId): Promise<readonly StudentAccountLinkRecord[]> {
    return Promise.resolve(
      [...this.#studentLinks.values()].filter((l) => l.userId === userId).map(clone),
    );
  }
}

function stripUndefined<T extends object>(patch: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
