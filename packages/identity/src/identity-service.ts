import { randomUUID } from 'node:crypto';
import {
  asUserId,
  type ParentProfileRecord,
  type StudentAccountLinkRecord,
  type StudentLinkMethod,
  type TeacherProfileRecord,
  type UserId,
  type UserRecord,
  type WorkspaceRole,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import type { AuthAdapter } from './auth-adapter.js';
import { authorisedGuardian } from './guardian-authority.js';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  WorkspaceNotHeldError,
} from './errors.js';
import type { IdentityStore } from './store.js';

export interface IdentityServiceOptions {
  readonly store: IdentityStore;
  readonly auth: AuthAdapter;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
}

export interface RegisterInput {
  readonly email?: string;
  readonly phone?: string;
  readonly password: string;
  /** The role the account is registered for. STUDENT self-register creates NO child. */
  readonly intendedRole: WorkspaceRole;
  readonly displayName?: string;
}

export interface ResolvedIdentity {
  readonly user: UserRecord;
  readonly roles: readonly WorkspaceRole[];
  readonly parentProfile: ParentProfileRecord | null;
  readonly teacherProfile: TeacherProfileRecord | null;
}

export interface WorkspaceContext {
  readonly userId: UserId;
  readonly workspace: WorkspaceRole;
}

export interface LinkStudentInput {
  readonly studentUserId: UserId;
  readonly childId: string;
  readonly linkMethod: StudentLinkMethod;
  /** The guardian who initiated (PARENT_INVITE / GUARDIAN_MANUAL). */
  readonly linkedByUserId?: UserId;
}

/**
 * Identity + role + student-account-link operations (docs 19, 22, 25 §1).
 *
 * Invariants enforced here:
 *  - Child ≠ User (I-1): a Child Profile is never created by any account flow;
 *    `linkStudentAccount` binds a Student identity to an **existing** `child_id`.
 *  - User ≠ Role (I-2): roles are M:N; `resolveWorkspace` rejects a workspace the
 *    user does not hold (A-4).
 *  - Approving a student link needs the `can_manage_child` capability (ID-Q6).
 */
export class IdentityService {
  readonly #store: IdentityStore;
  readonly #auth: AuthAdapter;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;

  constructor(opts: IdentityServiceOptions) {
    this.#store = opts.store;
    this.#auth = opts.auth;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
  }

  async register(input: RegisterInput): Promise<ResolvedIdentity> {
    if (!input.email && !input.phone) {
      throw new ValidationError('register requires an email or a phone');
    }
    const authUserId = await this.#auth.createUser({
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      password: input.password,
    });
    const now = this.#now().toISOString();
    const userId = asUserId(this.#newId());
    const user: UserRecord = {
      id: userId,
      authUserId,
      primaryEmail: input.email ?? null,
      primaryPhone: input.phone ?? null,
      displayName: input.displayName ?? null,
      locale: 'vi',
      status: 'ACTIVE',
      createdAt: now,
    };
    await this.#store.insertUser(user);
    await this.#grantRole(userId, input.intendedRole, null, input.displayName ?? null);
    this.#logger?.info('identity.registered', { userId, role: input.intendedRole });
    return this.getIdentity(userId);
  }

  /** Add a role to an existing identity (e.g. a parent who is also a teacher — I-2). */
  async addRole(userId: UserId, role: WorkspaceRole, grantedBy?: UserId): Promise<ResolvedIdentity> {
    const user = await this.#store.getUser(userId);
    if (!user) throw new NotFoundError(`user ${userId}`);
    await this.#grantRole(userId, role, grantedBy ?? null, user.displayName);
    return this.getIdentity(userId);
  }

  async #grantRole(
    userId: UserId,
    role: WorkspaceRole,
    grantedBy: UserId | null,
    displayName: string | null,
  ): Promise<void> {
    const now = this.#now().toISOString();
    await this.#store.addRole({ userId, role, grantedAt: now, grantedBy });
    if (role === 'PARENT' && !(await this.#store.getParentProfile(userId))) {
      await this.#store.upsertParentProfile({
        userId,
        displayName: displayName ?? 'Phụ huynh',
        contactVisibility: 'FAMILY',
        createdAt: now,
      });
    }
    if (role === 'TEACHER' && !(await this.#store.getTeacherProfile(userId))) {
      await this.#store.upsertTeacherProfile({
        userId,
        displayName: displayName ?? 'Giáo viên',
        headline: null,
        subjectsTaught: [],
        verificationStatus: 'UNVERIFIED',
        createdAt: now,
      });
    }
  }

  async listRoles(userId: UserId): Promise<readonly WorkspaceRole[]> {
    return this.#store.listRoles(userId);
  }

  async getIdentity(userId: UserId): Promise<ResolvedIdentity> {
    const user = await this.#store.getUser(userId);
    if (!user) throw new NotFoundError(`user ${userId}`);
    const [roles, parentProfile, teacherProfile] = await Promise.all([
      this.#store.listRoles(userId),
      this.#store.getParentProfile(userId),
      this.#store.getTeacherProfile(userId),
    ]);
    return { user, roles, parentProfile, teacherProfile };
  }

  /**
   * Validate that `workspace` is a role the user holds and return the
   * server-derived request context (doc 22 §4). Never trust a client-asserted
   * role.
   */
  async resolveWorkspace(userId: UserId, workspace: WorkspaceRole): Promise<WorkspaceContext> {
    const roles = await this.#store.listRoles(userId);
    if (!roles.includes(workspace)) throw new WorkspaceNotHeldError(workspace);
    return { userId, workspace };
  }

  /**
   * Resolve a bearer token to a domain identity (doc 22 §4). The `AuthAdapter`
   * verifies the token; we map its `authUserId` to a `users` row. Returns `null`
   * when the token is invalid or no linked user exists — the caller returns 401.
   */
  async authenticate(bearer: string): Promise<ResolvedIdentity | null> {
    const identity = await this.#auth.verifyToken(bearer);
    if (!identity) return null;
    const user = await this.#store.findUserByAuthId(identity.authUserId);
    if (!user) return null;
    return this.getIdentity(user.id);
  }

  /**
   * The server-derived `RequestContext` for a workspace-scoped call: verify the
   * token, then require the declared workspace to be a role the user holds.
   * `childScope` is only meaningful for STUDENT and must match a linked child.
   */
  async sessionContext(
    bearer: string,
    workspace: WorkspaceRole,
  ): Promise<(WorkspaceContext & { childScope?: string }) | null> {
    const resolved = await this.authenticate(bearer);
    if (!resolved) return null;
    if (!resolved.roles.includes(workspace)) throw new WorkspaceNotHeldError(workspace);
    if (workspace === 'STUDENT') {
      const links = await this.#store.listStudentLinksForUser(resolved.user.id);
      const active = links.find((l) => l.status === 'ACTIVE');
      if (!active) throw new WorkspaceNotHeldError('STUDENT (no linked child)');
      return { userId: resolved.user.id, workspace, childScope: active.childId };
    }
    return { userId: resolved.user.id, workspace };
  }

  /**
   * Bind a Student identity to an **existing** Child Profile. Creates a PENDING
   * `student_account_links` row — a guardian must approve it (unless a
   * pre-approving `linkedByUserId` guardian with `can_manage_child` initiated it).
   * NEVER creates a `child_profiles` row.
   */
  async linkStudentAccount(input: LinkStudentInput): Promise<StudentAccountLinkRecord> {
    const child = await this.#store.getChild(input.childId);
    if (!child) throw new NotFoundError(`child ${input.childId}`);

    const studentRoles = await this.#store.listRoles(input.studentUserId);
    if (!studentRoles.includes('STUDENT')) {
      throw new ValidationError('the linked user does not hold the STUDENT role');
    }
    if (await this.#store.getActiveStudentLinkForChild(input.childId)) {
      throw new ConflictError(`child ${input.childId} already has an ACTIVE student account`);
    }

    let status: StudentAccountLinkRecord['status'] = 'PENDING';
    let linkedBy: UserId | null = input.linkedByUserId ?? null;
    if (input.linkedByUserId) {
      const ok = await authorisedGuardian(
        this.#store,
        input.linkedByUserId,
        input.childId,
        'can_manage_child',
      );
      if (!ok) {
        throw new AuthorizationError('initiating guardian lacks can_manage_child');
      }
      status = 'ACTIVE'; // a capable guardian initiated → no separate approval step
    }

    const record: StudentAccountLinkRecord = {
      id: this.#newId(),
      userId: input.studentUserId,
      childId: input.childId,
      linkedByUserId: linkedBy,
      linkMethod: input.linkMethod,
      status,
      createdAt: this.#now().toISOString(),
      revokedAt: null,
    };
    await this.#store.insertStudentLink(record);
    this.#logger?.info('identity.studentLink.created', {
      linkId: record.id,
      childId: input.childId,
      status,
    });
    return record;
  }

  /** A guardian with `can_manage_child` approves a PENDING student link. No new child. */
  async approveStudentLink(linkId: string, approverUserId: UserId): Promise<StudentAccountLinkRecord> {
    const link = await this.#store.getStudentLink(linkId);
    if (!link) throw new NotFoundError(`student link ${linkId}`);
    if (link.status !== 'PENDING') {
      throw new ConflictError(`student link ${linkId} is ${link.status}, not PENDING`);
    }
    const ok = await authorisedGuardian(
      this.#store,
      approverUserId,
      link.childId,
      'can_manage_child',
    );
    if (!ok) throw new AuthorizationError('approver lacks can_manage_child for this child');

    await this.#store.updateStudentLink(linkId, {
      status: 'ACTIVE',
      linkedByUserId: approverUserId,
    });
    const updated = await this.#store.getStudentLink(linkId);
    return updated!;
  }
}
