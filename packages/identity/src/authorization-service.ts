import type { PermissionCode, WorkspaceRole } from '@copilot/domain';
import { authorisedGuardian, guardianAuthority } from './guardian-authority.js';
import { AuthorizationError } from './errors.js';
import type { PermissionService } from './permission-service.js';
import type { RelationshipStore } from './relationship-store.js';
import type { IdentityStore } from './store.js';

export interface WorkspaceRequestContext {
  readonly userId: string;
  readonly workspace: WorkspaceRole;
  /** STUDENT workspace only — the single child this session is scoped to. */
  readonly childScope?: string;
}

export type ChildResource = { readonly kind: 'child'; readonly childId: string; readonly subjectId?: string | null };
export type FamilyResource = { readonly kind: 'family'; readonly familyId: string };
export type ClassResource = { readonly kind: 'class'; readonly classroomId: string };
export type AdminResource = { readonly kind: 'admin' };
export type Resource = ChildResource | FamilyResource | ClassResource | AdminResource;

/**
 * Actions the API can request. Child-data actions map to a `PermissionCode` for
 * the TEACHER path (doc 22 §5).
 */
export const CHILD_SAFE_ACTIONS = ['view_today', 'submit_attempt', 'view_own_profile'] as const;
export type ChildSafeAction = (typeof CHILD_SAFE_ACTIONS)[number];

export const ACTION_TO_PERMISSION: Partial<Record<string, PermissionCode>> = {
  'view_child': 'VIEW_CLASS_CONTEXT',
  'view_learning_context': 'VIEW_CLASS_CONTEXT',
  'view_assignment_completion': 'VIEW_ASSIGNMENT_COMPLETION',
  'view_selected_mastery': 'VIEW_SELECTED_MASTERY',
  'view_selected_gaps': 'VIEW_SELECTED_GAPS',
  'view_twin_summary': 'VIEW_LEARNING_TWIN_SUMMARY',
  'submit_current_lesson': 'SUBMIT_CURRENT_LESSON',
  'submit_curriculum_progress': 'SUBMIT_CURRICULUM_PROGRESS',
  'submit_homework': 'SUBMIT_HOMEWORK',
  'submit_test_result': 'SUBMIT_TEST_RESULT',
  'submit_exam_notice': 'SUBMIT_EXAM_NOTICE',
  'submit_exam_scope': 'SUBMIT_EXAM_SCOPE',
  'submit_skill_assessment': 'SUBMIT_SKILL_ASSESSMENT',
  'submit_learning_observation': 'SUBMIT_LEARNING_OBSERVATION',
  'create_assignment': 'CREATE_ASSIGNMENT',
};

export interface AuthorizationServiceOptions {
  readonly identityStore: IdentityStore;
  readonly relationshipStore: RelationshipStore;
  readonly permissions: PermissionService;
  readonly now?: () => Date;
}

/**
 * The single server-side authorization gate (doc 22 §5). RBAC (workspace) +
 * relationship-aware ABAC (guardian capabilities, teacher permissions, privacy
 * mode, consent). UI hiding is never sufficient; every child-facing handler
 * calls this before touching data. Emits a `CHILD_DATA_ACCESS_DENIED` audit row
 * on a denied child read.
 */
export class AuthorizationService {
  readonly #identity: IdentityStore;
  readonly #rel: RelationshipStore;
  readonly #perms: PermissionService;
  readonly #now: () => Date;

  constructor(opts: AuthorizationServiceOptions) {
    this.#identity = opts.identityStore;
    this.#rel = opts.relationshipStore;
    this.#perms = opts.permissions;
    this.#now = opts.now ?? (() => new Date());
  }

  /** Validate that the declared workspace is a role the user actually holds (A-4). */
  async requireWorkspace(userId: string, workspace: WorkspaceRole): Promise<void> {
    const roles = await this.#identity.listRoles(userId as never);
    if (!roles.includes(workspace)) {
      throw new AuthorizationError(`workspace '${workspace}' is not held by this user`);
    }
  }

  async authorize(ctx: WorkspaceRequestContext, resource: Resource, action: string): Promise<void> {
    await this.requireWorkspace(ctx.userId, ctx.workspace);

    switch (ctx.workspace) {
      case 'PARENT':
        return this.#authorizeParent(ctx, resource, action);
      case 'STUDENT':
        return this.#authorizeStudent(ctx, resource, action);
      case 'TEACHER':
        return this.#authorizeTeacher(ctx, resource, action);
      case 'ADMIN':
        if (resource.kind === 'child') {
          throw new AuthorizationError('ADMIN has no child-data path');
        }
        return;
    }
  }

  async #authorizeParent(ctx: WorkspaceRequestContext, resource: Resource, action: string): Promise<void> {
    if (resource.kind === 'child') {
      const capability =
        action.startsWith('manage_privacy') || action === 'set_privacy_mode' || action === 'grant_permission'
          ? 'can_manage_privacy'
          : action.startsWith('manage') || action.startsWith('create') || action === 'link_student'
            ? 'can_manage_child'
            : null;
      if (capability) {
        const ok = await authorisedGuardian(this.#identity, ctx.userId as never, resource.childId, capability);
        if (!ok) return this.#denyChild(ctx, resource.childId, `guardian lacks ${capability}`);
        return;
      }
      // read-only actions — any ACTIVE guardian relationship
      const authority = await guardianAuthority(this.#identity, ctx.userId as never, resource.childId);
      if (!authority.isGuardian) return this.#denyChild(ctx, resource.childId, 'not a guardian of this child');
      return;
    }
    if (resource.kind === 'family') {
      const members = await this.#identity.listFamilyMemberships(resource.familyId as never);
      if (!members.some((m) => m.userId === ctx.userId)) {
        throw new AuthorizationError('not a member of this family');
      }
      return;
    }
    throw new AuthorizationError('PARENT workspace cannot reach this resource');
  }

  #authorizeStudent(ctx: WorkspaceRequestContext, resource: Resource, action: string): Promise<void> {
    if (resource.kind !== 'child') throw new AuthorizationError('STUDENT workspace reaches only its own child');
    if (ctx.childScope !== resource.childId) {
      throw new AuthorizationError('student token is scoped to another child');
    }
    if (!(CHILD_SAFE_ACTIONS as readonly string[]).includes(action)) {
      throw new AuthorizationError(`action '${action}' is not child-safe`);
    }
    return Promise.resolve();
  }

  async #authorizeTeacher(ctx: WorkspaceRequestContext, resource: Resource, action: string): Promise<void> {
    if (resource.kind === 'class') return; // class membership is checked by the education layer
    if (resource.kind !== 'child') throw new AuthorizationError('TEACHER workspace cannot reach this resource');

    const code = ACTION_TO_PERMISSION[action];
    if (!code) throw new AuthorizationError(`no permission mapping for teacher action '${action}'`);
    const decision = await this.#perms.can(
      ctx.userId,
      resource.childId,
      code,
      resource.subjectId ?? null,
      this.#now(),
    );
    if (!decision.allowed) {
      return this.#denyChild(ctx, resource.childId, `can(${code}) denied: ${decision.reason}`);
    }
  }

  async #denyChild(ctx: WorkspaceRequestContext, childId: string, reason: string): Promise<never> {
    await this.#rel.appendAuditEvent({
      id: cryptoRandom(),
      actorUserId: ctx.userId,
      actorWorkspace: ctx.workspace,
      eventType: 'CHILD_DATA_ACCESS_DENIED',
      subjectType: 'child_profiles',
      subjectId: childId,
      childId,
      payload: { reason },
      createdAt: this.#now().toISOString(),
    });
    throw new AuthorizationError(reason);
  }
}

function cryptoRandom(): string {
  // small local helper — avoids importing node:crypto at module top for tree-shaking
  return globalThis.crypto?.randomUUID?.() ?? `evt-${Math.random().toString(36).slice(2)}`;
}
