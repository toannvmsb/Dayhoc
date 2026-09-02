import { randomUUID } from 'node:crypto';
import {
  asFamilyId,
  type FamilyId,
  type FamilyMembershipRecord,
  type GuardianAuthoritySource,
  type ParentChildRelationshipRecord,
  type ParentChildRelationshipType,
  type UserId,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import { authorisedGuardian, guardianAuthority } from './guardian-authority.js';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from './errors.js';
import type { ChildStub, IdentityStore } from './store.js';

export interface FamilyServiceOptions {
  readonly store: IdentityStore;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface CreateChildInput {
  readonly familyId: FamilyId;
  readonly creatorUserId: UserId;
  readonly displayName: string;
  readonly schoolGrade: number;
  readonly dateOfBirth?: string;
  readonly relationshipType?: ParentChildRelationshipType;
}

export interface GuardianCapabilityFlags {
  readonly canManageChild: boolean;
  readonly canManagePrivacy: boolean;
  readonly canApproveTeacherRelationships: boolean;
}

export interface AddGuardianInput {
  readonly childId: string;
  readonly inviterUserId: UserId;
  readonly newGuardianUserId: UserId;
  readonly relationshipType?: ParentChildRelationshipType;
  readonly capabilities: GuardianCapabilityFlags;
}

/**
 * Household / billing context + the capability-based guardianship graph
 * (docs 19 §3, 25 §2). A `family` is a household/billing unit — NOT the
 * guardianship model (ID-Q4). Guardian authority lives entirely in
 * `parent_child_relationships` and is an explicit capability set (ID-Q6).
 */
export class FamilyService {
  readonly #store: IdentityStore;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: FamilyServiceOptions) {
    this.#store = opts.store;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  async createFamily(ownerUserId: UserId): Promise<FamilyId> {
    const roles = await this.#store.listRoles(ownerUserId);
    if (!roles.includes('PARENT')) {
      throw new ValidationError('a family owner must hold the PARENT role');
    }
    const now = this.#now().toISOString();
    const familyId = asFamilyId(this.#newId());
    await this.#store.insertFamily(familyId, ownerUserId, now);
    await this.#store.addFamilyMembership({
      familyId,
      userId: ownerUserId,
      memberRole: 'OWNER',
      joinedAt: now,
    });
    return familyId;
  }

  /**
   * Create a Child Profile + wire the creator as its first guardian.
   *
   * - NO `users` row is created for the child (I-1).
   * - The creator's relationship is `SELF_DECLARED` with **all three
   *   capabilities** (doc 19 §3.4 — the child's first guardian).
   * - `child_id` is minted here and never changes afterwards (I-3).
   */
  async createChild(input: CreateChildInput): Promise<string> {
    if (!Number.isInteger(input.schoolGrade) || input.schoolGrade < 1 || input.schoolGrade > 9) {
      throw new ValidationError('schoolGrade must be an integer 1..9');
    }
    if (!(await this.#store.familyExists(input.familyId))) {
      throw new NotFoundError(`family ${input.familyId}`);
    }
    const creatorRoles = await this.#store.listRoles(input.creatorUserId);
    if (!creatorRoles.includes('PARENT')) {
      throw new AuthorizationError('only a PARENT may create a child');
    }

    const now = this.#now().toISOString();
    const childId = this.#newId();
    const child: ChildStub = {
      id: childId,
      familyId: input.familyId,
      displayName: input.displayName,
      schoolGrade: input.schoolGrade,
      dateOfBirth: input.dateOfBirth ?? null,
    };
    await this.#store.insertChild(child);

    // ensure the creator is a family member
    await this.#store.addFamilyMembership({
      familyId: input.familyId,
      userId: input.creatorUserId,
      memberRole: 'GUARDIAN',
      joinedAt: now,
    });

    await this.#insertRelationship(
      childId,
      input.creatorUserId,
      input.relationshipType ?? 'GUARDIAN',
      { canManageChild: true, canManagePrivacy: true, canApproveTeacherRelationships: true },
      'SELF_DECLARED',
    );
    this.#logger?.info('identity.child.created', { childId, familyId: input.familyId });
    return childId;
  }

  /**
   * Add another guardian to a child (M:N — ID-Q4). The inviter must hold
   * `can_manage_child`; a granted capability the inviter does NOT hold is
   * silently clamped off (you cannot grant more authority than you have).
   */
  async addGuardian(input: AddGuardianInput): Promise<ParentChildRelationshipRecord> {
    if (!(await this.#store.getChild(input.childId))) {
      throw new NotFoundError(`child ${input.childId}`);
    }
    const inviterAuthority = await guardianAuthority(
      this.#store,
      input.inviterUserId,
      input.childId,
    );
    if (!inviterAuthority.canManageChild) {
      throw new AuthorizationError('inviter lacks can_manage_child for this child');
    }
    const newGuardianRoles = await this.#store.listRoles(input.newGuardianUserId);
    if (!newGuardianRoles.includes('PARENT')) {
      throw new ValidationError('the new guardian must hold the PARENT role');
    }
    const existing = (
      await this.#store.listRelationshipsForPair(input.newGuardianUserId, input.childId)
    ).filter((r) => r.status === 'ACTIVE');
    if (existing.length > 0) {
      throw new ConflictError('that user is already an ACTIVE guardian of this child');
    }

    const clamped: GuardianCapabilityFlags = {
      canManageChild: input.capabilities.canManageChild,
      canManagePrivacy: input.capabilities.canManagePrivacy && inviterAuthority.canManagePrivacy,
      canApproveTeacherRelationships:
        input.capabilities.canApproveTeacherRelationships &&
        inviterAuthority.canApproveTeacherRelationships,
    };
    return this.#insertRelationship(
      input.childId,
      input.newGuardianUserId,
      input.relationshipType ?? 'GUARDIAN',
      clamped,
      'INVITED_BY_EXISTING_GUARDIAN',
    );
  }

  /** Change a guardian's capabilities. Actor needs `can_manage_privacy` over the child. */
  async setGuardianCapabilities(
    relationshipId: string,
    actorUserId: UserId,
    capabilities: GuardianCapabilityFlags,
  ): Promise<void> {
    const rel = await this.#findRelationship(relationshipId);
    if (!(await authorisedGuardian(this.#store, actorUserId, rel.childId, 'can_manage_privacy'))) {
      throw new AuthorizationError('actor lacks can_manage_privacy for this child');
    }
    await this.#store.updateRelationship(relationshipId, {
      canManageChild: capabilities.canManageChild,
      canManagePrivacy: capabilities.canManagePrivacy,
      canApproveTeacherRelationships: capabilities.canApproveTeacherRelationships,
    });
  }

  /** Revoke a guardian relationship. Actor needs `can_manage_privacy` over the child. */
  async revokeGuardian(relationshipId: string, actorUserId: UserId): Promise<void> {
    const rel = await this.#findRelationship(relationshipId);
    if (rel.parentUserId === actorUserId) {
      throw new ValidationError('a guardian cannot revoke their own relationship');
    }
    if (!(await authorisedGuardian(this.#store, actorUserId, rel.childId, 'can_manage_privacy'))) {
      throw new AuthorizationError('actor lacks can_manage_privacy for this child');
    }
    await this.#store.updateRelationship(relationshipId, {
      status: 'REVOKED',
      revokedAt: this.#now().toISOString(),
    });
  }

  async listGuardians(childId: string): Promise<readonly ParentChildRelationshipRecord[]> {
    return this.#store.listRelationshipsForChild(childId);
  }

  async listFamilyMembers(familyId: FamilyId): Promise<readonly FamilyMembershipRecord[]> {
    return this.#store.listFamilyMemberships(familyId);
  }

  async #findRelationship(id: string): Promise<ParentChildRelationshipRecord> {
    const rel = await this.#store.getRelationship(id);
    if (!rel) throw new NotFoundError(`relationship ${id}`);
    return rel;
  }

  async #insertRelationship(
    childId: string,
    parentUserId: UserId,
    relationshipType: ParentChildRelationshipType,
    capabilities: GuardianCapabilityFlags,
    authoritySource: GuardianAuthoritySource,
  ): Promise<ParentChildRelationshipRecord> {
    const record: ParentChildRelationshipRecord = {
      id: this.#newId(),
      parentUserId,
      childId,
      relationshipType,
      canManageChild: capabilities.canManageChild,
      canManagePrivacy: capabilities.canManagePrivacy,
      canApproveTeacherRelationships: capabilities.canApproveTeacherRelationships,
      authoritySource,
      isLegalGuardian: null,
      status: 'ACTIVE',
      validFrom: null,
      validUntil: null,
      createdAt: this.#now().toISOString(),
      revokedAt: null,
    };
    await this.#store.insertRelationship(record);
    return record;
  }
}
