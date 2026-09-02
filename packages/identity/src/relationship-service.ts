import { randomUUID } from 'node:crypto';
import {
  CLASS_ASSIGNMENT_ALLOWED_CODES,
  SENSITIVE_PERMISSION_CODES,
  type AccessSource,
  type AuditEventRecord,
  type AuditEventType,
  type DiscoveryMethod,
  type PermissionCode,
  type RelationshipKind,
  type RelationshipRequestRecord,
  type RelationshipType,
  type TeacherChildLinkRecord,
  type TeacherParentLinkRecord,
  type TeacherParentPurpose,
} from '@copilot/domain';
import type { Logger } from '@copilot/observability';
import { authorisedGuardian } from './guardian-authority.js';
import { AuthorizationError, ConflictError, NotFoundError, ValidationError } from './errors.js';
import type { PermissionService } from './permission-service.js';
import type { RelationshipStore } from './relationship-store.js';
import type { IdentityStore } from './store.js';

export interface RelationshipServiceOptions {
  readonly store: RelationshipStore;
  readonly identityStore: IdentityStore;
  readonly permissions: PermissionService;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly newId?: () => string;
  /** Request expiry (ID-Q5) — a config value, default 14 days. */
  readonly requestExpiryDays?: number;
}

export interface CreateRequestInput {
  readonly requesterUserId: string;
  readonly requesterRole: 'PARENT' | 'TEACHER';
  readonly relationshipKind: RelationshipKind;
  readonly targetType: 'PARENT' | 'CHILD' | 'TEACHER';
  readonly targetChildId?: string;
  readonly targetUserId?: string;
  readonly relationshipType?: RelationshipType;
  readonly subjectId?: string;
  readonly accessSource?: AccessSource;
  readonly proposedPermissions?: readonly PermissionCode[];
  readonly discoveryMethod?: DiscoveryMethod;
  readonly message?: string;
  readonly purpose?: TeacherParentPurpose;
}

/**
 * Relationship-request workflow (doc 21 §4, §4.1; doc 25 §5).
 *
 * R-2: a teacher-initiated Teacher–Child request creates a PENDING row and
 * NOTHING else — no link, no grant, ZERO child-data access. Only an authorised
 * guardian (`can_approve_teacher_relationships`) may accept it, and a teacher
 * can never accept their own request.
 */
export class RelationshipService {
  readonly #store: RelationshipStore;
  readonly #identity: IdentityStore;
  readonly #perms: PermissionService;
  readonly #logger: Logger | undefined;
  readonly #now: () => Date;
  readonly #newId: () => string;
  readonly #expiryDays: number;

  constructor(opts: RelationshipServiceOptions) {
    this.#store = opts.store;
    this.#identity = opts.identityStore;
    this.#perms = opts.permissions;
    this.#logger = opts.logger;
    this.#now = opts.now ?? (() => new Date());
    this.#newId = opts.newId ?? randomUUID;
    this.#expiryDays = opts.requestExpiryDays ?? 14;
  }

  async createRequest(input: CreateRequestInput): Promise<RelationshipRequestRecord> {
    const subjectId = input.subjectId ?? null;
    if (input.relationshipKind === 'TEACHER_CHILD' && !input.targetChildId) {
      throw new ValidationError('a TEACHER_CHILD request needs targetChildId');
    }
    const proposed = [...(input.proposedPermissions ?? [])];

    // a parent may only request for their own child; a capable guardian check
    if (input.requesterRole === 'PARENT' && input.targetChildId) {
      const ok = await authorisedGuardian(
        this.#identity,
        input.requesterUserId as never,
        input.targetChildId,
        'can_manage_child',
      );
      if (!ok) throw new AuthorizationError('requester is not an authorised guardian of the target child');
    }

    // idempotency — return the existing PENDING request if one matches
    if (input.targetChildId) {
      const existing = await this.#store.findPendingRequest({
        requesterUserId: input.requesterUserId,
        targetChildId: input.targetChildId,
        relationshipKind: input.relationshipKind,
        subjectId,
      });
      if (existing) return existing;
    }

    const record: RelationshipRequestRecord = {
      id: this.#newId(),
      requesterUserId: input.requesterUserId,
      requesterRole: input.requesterRole,
      targetType: input.targetType,
      targetUserId: input.targetUserId ?? null,
      targetChildId: input.targetChildId ?? null,
      relationshipKind: input.relationshipKind,
      relationshipType: input.relationshipType ?? 'SUBJECT_TEACHER',
      subjectId: (subjectId as RelationshipRequestRecord['subjectId']) ?? null,
      accessSource: input.accessSource ?? 'PARENT_DIRECT',
      proposedPermissions: proposed,
      message: input.message ?? null,
      discoveryMethod: input.discoveryMethod ?? 'PARENT_LINK',
      status: 'PENDING',
      expiresAt: new Date(this.#now().getTime() + this.#expiryDays * 86_400_000).toISOString(),
      respondedByUserId: null,
      respondedAt: null,
      approvedPermissions: null,
      createdAt: this.#now().toISOString(),
    };
    await this.#store.insertRequest(record);
    await this.#audit('RELATIONSHIP_REQUEST_CREATED', {
      actorUserId: input.requesterUserId,
      subjectType: 'relationship_requests',
      subjectId: record.id,
      childId: record.targetChildId,
      payload: { relationshipKind: record.relationshipKind, requesterRole: record.requesterRole },
    });
    this.#logger?.info('relationship.request.created', { id: record.id, kind: record.relationshipKind });
    return record;
  }

  /**
   * Accept a request.
   *  - Teacher→Child: `responderUserId` must be an authorised guardian
   *    (`can_approve_teacher_relationships`); a teacher accepting their own
   *    request → 403.
   *  - Parent→Teacher: the teacher accepts.
   *  - Teacher→Parent: that parent accepts.
   */
  async acceptRequest(
    requestId: string,
    responderUserId: string,
    approvedPermissions?: readonly PermissionCode[],
  ): Promise<{ request: RelationshipRequestRecord; link: TeacherChildLinkRecord | TeacherParentLinkRecord }> {
    const req = await this.#store.getRequest(requestId);
    if (!req) throw new NotFoundError(`request ${requestId}`);
    if (req.status === 'ACCEPTED') {
      // idempotent — return the existing link
      const link = await this.#findLinkForRequest(req);
      if (link) return { request: req, link };
    }
    if (req.status !== 'PENDING') {
      throw new ConflictError(`request ${requestId} is ${req.status}, not PENDING`, 'REQUEST_NOT_PENDING');
    }
    if (this.#expired(req)) {
      await this.#store.updateRequest(requestId, { status: 'EXPIRED' });
      throw new ConflictError('request has expired; send a new one', 'REQUEST_EXPIRED');
    }
    if (req.requesterUserId === responderUserId) {
      throw new AuthorizationError('the requester cannot accept their own request');
    }

    if (req.relationshipKind === 'TEACHER_CHILD') {
      return this.#acceptTeacherChild(req, responderUserId, approvedPermissions);
    }
    return this.#acceptTeacherParent(req, responderUserId);
  }

  async #acceptTeacherChild(
    req: RelationshipRequestRecord,
    responderUserId: string,
    approvedPermissions: readonly PermissionCode[] | undefined,
  ): Promise<{ request: RelationshipRequestRecord; link: TeacherChildLinkRecord }> {
    const childId = req.targetChildId!;
    const teacherUserId = req.requesterRole === 'TEACHER' ? req.requesterUserId : req.targetUserId;
    if (!teacherUserId) throw new ValidationError('cannot resolve the teacher identity for this request');

    // Required responder (doc 21 §4):
    //  - a TEACHER-initiated Child request → an authorised guardian
    //    (`can_approve_teacher_relationships`) — R-2.
    //  - a PARENT-initiated request → the target teacher confirms it.
    if (req.requesterRole === 'TEACHER') {
      const guardianOk = await authorisedGuardian(
        this.#identity,
        responderUserId as never,
        childId,
        'can_approve_teacher_relationships',
      );
      if (!guardianOk) {
        throw new AuthorizationError(
          'only a guardian with can_approve_teacher_relationships may accept this',
        );
      }
    } else if (responderUserId !== teacherUserId) {
      throw new AuthorizationError('only the invited teacher may accept a parent-initiated request');
    }

    // supersede: if an ACTIVE link already exists, cancel this request
    const activeLink = (
      await this.#store.listTeacherChildLinks({ teacherUserId, childId })
    ).find((l) => l.status === 'ACCEPTED' && (l.subjectId ?? null) === (req.subjectId ?? null));
    if (activeLink) {
      await this.#store.updateRequest(req.id, {
        status: 'CANCELLED',
        respondedByUserId: responderUserId,
        respondedAt: this.#now().toISOString(),
      });
      await this.#audit('RELATIONSHIP_REQUEST_CANCELLED', {
        actorUserId: responderUserId,
        subjectType: 'relationship_requests',
        subjectId: req.id,
        childId,
        payload: { reason: 'SUPERSEDED_BY_EXISTING_LINK' },
      });
      return { request: { ...req, status: 'CANCELLED' }, link: activeLink };
    }

    const approved = clampApproved(req.proposedPermissions, approvedPermissions);
    const nowIso = this.#now().toISOString();
    const link: TeacherChildLinkRecord = {
      id: this.#newId(),
      teacherUserId,
      childId,
      subjectId: req.subjectId,
      relationshipType: req.relationshipType,
      accessSource: req.accessSource,
      accessSourceId: null,
      initiatedByRole: req.requesterRole,
      initiatedByUserId: req.requesterUserId,
      originRequestId: req.id,
      status: 'ACCEPTED',
      acceptedByParentUserId: responderUserId,
      needsGuardianReview: false,
      validFrom: nowIso,
      validUntil: null,
      acceptedAt: nowIso,
      rejectedAt: null,
      revokedAt: null,
      createdAt: nowIso,
    };
    await this.#store.insertTeacherChildLink(link);

    for (const code of approved) {
      // sensitive codes are always PARENT_DIRECT; class-derivable codes may keep
      // the request's access source
      const src: AccessSource =
        SENSITIVE_PERMISSION_CODES.includes(code) || !CLASS_ASSIGNMENT_ALLOWED_CODES.includes(code)
          ? 'PARENT_DIRECT'
          : req.accessSource;
      await this.#perms.grant({
        linkId: link.id,
        linkType: 'TEACHER_CHILD',
        code,
        subjectId: req.subjectId,
        accessSource: src,
        grantedByUserId: responderUserId,
      });
    }

    await this.#store.updateRequest(req.id, {
      status: 'ACCEPTED',
      respondedByUserId: responderUserId,
      respondedAt: nowIso,
      approvedPermissions: approved,
    });
    await this.#audit('RELATIONSHIP_REQUEST_ACCEPTED', {
      actorUserId: responderUserId,
      subjectType: 'teacher_child_links',
      subjectId: link.id,
      childId,
      payload: { approvedPermissions: approved },
    });
    return { request: { ...req, status: 'ACCEPTED', approvedPermissions: approved }, link };
  }

  async #acceptTeacherParent(
    req: RelationshipRequestRecord,
    responderUserId: string,
  ): Promise<{ request: RelationshipRequestRecord; link: TeacherParentLinkRecord }> {
    const teacherUserId = req.requesterRole === 'TEACHER' ? req.requesterUserId : req.targetUserId;
    const parentUserId = req.requesterRole === 'PARENT' ? req.requesterUserId : req.targetUserId ?? responderUserId;
    if (!teacherUserId || !parentUserId) throw new ValidationError('cannot resolve teacher/parent identities');
    if (req.requesterRole === 'TEACHER' && responderUserId !== (req.targetUserId ?? responderUserId)) {
      throw new AuthorizationError('only the targeted parent may accept this request');
    }

    const nowIso = this.#now().toISOString();
    const link: TeacherParentLinkRecord = {
      id: this.#newId(),
      teacherUserId,
      parentUserId,
      childId: req.targetChildId,
      subjectId: req.subjectId,
      purpose: 'COMMUNICATION',
      initiatedByRole: req.requesterRole,
      initiatedByUserId: req.requesterUserId,
      originRequestId: req.id,
      status: 'ACCEPTED',
      acceptedByUserId: responderUserId,
      acceptedAt: nowIso,
      revokedAt: null,
      createdAt: nowIso,
    };
    await this.#store.insertTeacherParentLink(link);
    // MESSAGE_PARENT only — NO child-data access (R-3)
    await this.#perms.grant({
      linkId: link.id,
      linkType: 'TEACHER_PARENT',
      code: 'MESSAGE_PARENT',
      subjectId: null,
      accessSource: 'PARENT_DIRECT',
      grantedByUserId: responderUserId,
    });
    await this.#store.updateRequest(req.id, {
      status: 'ACCEPTED',
      respondedByUserId: responderUserId,
      respondedAt: nowIso,
      approvedPermissions: ['MESSAGE_PARENT'],
    });
    await this.#audit('RELATIONSHIP_REQUEST_ACCEPTED', {
      actorUserId: responderUserId,
      subjectType: 'teacher_parent_links',
      subjectId: link.id,
      childId: req.targetChildId,
      payload: { purpose: 'COMMUNICATION' },
    });
    return { request: { ...req, status: 'ACCEPTED' }, link };
  }

  async rejectRequest(requestId: string, responderUserId: string): Promise<void> {
    const req = await this.#store.getRequest(requestId);
    if (!req) throw new NotFoundError(`request ${requestId}`);
    if (req.status !== 'PENDING') throw new ConflictError('request is not PENDING', 'REQUEST_NOT_PENDING');
    if (req.relationshipKind === 'TEACHER_CHILD' && req.targetChildId) {
      const ok = await authorisedGuardian(
        this.#identity,
        responderUserId as never,
        req.targetChildId,
        'can_approve_teacher_relationships',
      );
      if (!ok && req.requesterRole === 'TEACHER') {
        throw new AuthorizationError('only an authorised guardian may reject this request');
      }
    }
    await this.#store.updateRequest(requestId, {
      status: 'REJECTED',
      respondedByUserId: responderUserId,
      respondedAt: this.#now().toISOString(),
    });
    await this.#audit('RELATIONSHIP_REQUEST_REJECTED', {
      actorUserId: responderUserId,
      subjectType: 'relationship_requests',
      subjectId: requestId,
      childId: req.targetChildId,
      payload: {},
    });
  }

  async cancelRequest(requestId: string, requesterUserId: string): Promise<void> {
    const req = await this.#store.getRequest(requestId);
    if (!req) throw new NotFoundError(`request ${requestId}`);
    if (req.requesterUserId !== requesterUserId) throw new AuthorizationError('only the requester may cancel');
    if (req.status !== 'PENDING') throw new ConflictError('request is not PENDING', 'REQUEST_NOT_PENDING');
    await this.#store.updateRequest(requestId, { status: 'CANCELLED' });
    await this.#audit('RELATIONSHIP_REQUEST_CANCELLED', {
      actorUserId: requesterUserId,
      subjectType: 'relationship_requests',
      subjectId: requestId,
      childId: req.targetChildId,
      payload: { reason: 'CANCELLED_BY_REQUESTER' },
    });
  }

  /** Revoke an ACCEPTED link. Future access stops immediately; history is kept (R-6). */
  async revokeTeacherChildLink(linkId: string, actorUserId: string): Promise<void> {
    const link = await this.#store.getTeacherChildLink(linkId);
    if (!link) throw new NotFoundError(`teacher_child_link ${linkId}`);
    const ok = await authorisedGuardian(
      this.#identity,
      actorUserId as never,
      link.childId,
      'can_manage_privacy',
    );
    if (!ok) throw new AuthorizationError('actor lacks can_manage_privacy for this child');
    await this.#store.updateTeacherChildLink(linkId, {
      status: 'REVOKED',
      revokedAt: this.#now().toISOString(),
    });
    await this.#perms.revokeGrantsForLink(linkId);
    await this.#audit('RELATIONSHIP_REVOKED', {
      actorUserId,
      subjectType: 'teacher_child_links',
      subjectId: linkId,
      childId: link.childId,
      payload: {},
    });
  }

  /** Revoke only the PARENT_DIRECT grants on a link, leaving CLASS_ASSIGNMENT ones. */
  async revokeParentDirectGrants(linkId: string, actorUserId: string): Promise<void> {
    const link = await this.#store.getTeacherChildLink(linkId);
    if (!link) throw new NotFoundError(`teacher_child_link ${linkId}`);
    const ok = await authorisedGuardian(this.#identity, actorUserId as never, link.childId, 'can_manage_privacy');
    if (!ok) throw new AuthorizationError('actor lacks can_manage_privacy');
    const n = await this.#perms.revokeGrantsForLink(linkId, 'PARENT_DIRECT');
    await this.#audit('PERMISSION_REVOKED', {
      actorUserId,
      subjectType: 'teacher_child_links',
      subjectId: linkId,
      childId: link.childId,
      payload: { accessSource: 'PARENT_DIRECT', count: n },
    });
  }

  async listInbox(userId: string): Promise<readonly RelationshipRequestRecord[]> {
    return this.#store.listRequestsForResponder(userId);
  }
  async listOutbox(userId: string): Promise<readonly RelationshipRequestRecord[]> {
    return this.#store.listRequestsByRequester(userId);
  }
  async listChildRelationships(childId: string): Promise<readonly TeacherChildLinkRecord[]> {
    return this.#store.listTeacherChildLinks({ childId });
  }
  async listAuditEvents(childId: string): Promise<readonly AuditEventRecord[]> {
    return this.#store.listAuditEvents({ childId });
  }

  async #findLinkForRequest(
    req: RelationshipRequestRecord,
  ): Promise<TeacherChildLinkRecord | TeacherParentLinkRecord | null> {
    if (req.relationshipKind === 'TEACHER_CHILD') {
      const links = await this.#store.listTeacherChildLinks(
        req.targetChildId ? { childId: req.targetChildId } : {},
      );
      return links.find((l) => l.originRequestId === req.id) ?? null;
    }
    const links = await this.#store.listTeacherParentLinks({});
    return links.find((l) => l.originRequestId === req.id) ?? null;
  }

  #expired(req: RelationshipRequestRecord): boolean {
    return Date.parse(req.expiresAt) <= this.#now().getTime();
  }

  async #audit(
    eventType: AuditEventType,
    d: {
      actorUserId: string | null;
      subjectType: string;
      subjectId: string;
      childId: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    const record: AuditEventRecord = {
      id: this.#newId(),
      actorUserId: d.actorUserId,
      actorWorkspace: null,
      eventType,
      subjectType: d.subjectType,
      subjectId: d.subjectId,
      childId: d.childId,
      payload: d.payload,
      createdAt: this.#now().toISOString(),
    };
    await this.#store.appendAuditEvent(record);
  }
}

function clampApproved(
  proposed: readonly PermissionCode[],
  approved: readonly PermissionCode[] | undefined,
): readonly PermissionCode[] {
  if (approved === undefined) return proposed;
  return approved.filter((c) => proposed.includes(c));
}
