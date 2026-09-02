import type {
  AuditEventRecord,
  AuditEventType,
  PermissionCode,
  PermissionGrantRecord,
  PrivacyPreferencesRecord,
  RelationshipKind,
  RelationshipRequestRecord,
  RelationshipRequestStatus,
  TeacherChildLinkRecord,
  TeacherLinkStatus,
  TeacherParentLinkRecord,
} from '@copilot/domain';

export interface RequestPatch {
  readonly status?: RelationshipRequestStatus;
  readonly respondedByUserId?: string | null;
  readonly respondedAt?: string | null;
  readonly approvedPermissions?: readonly PermissionCode[] | null;
}
export interface TeacherChildLinkPatch {
  readonly status?: TeacherLinkStatus;
  readonly acceptedByParentUserId?: string | null;
  readonly needsGuardianReview?: boolean;
  readonly acceptedAt?: string | null;
  readonly rejectedAt?: string | null;
  readonly revokedAt?: string | null;
  readonly validFrom?: string | null;
  readonly validUntil?: string | null;
}
export interface TeacherParentLinkPatch {
  readonly status?: TeacherLinkStatus;
  readonly acceptedByUserId?: string | null;
  readonly acceptedAt?: string | null;
  readonly revokedAt?: string | null;
}
export interface GrantPatch {
  readonly status?: 'ACTIVE' | 'REVOKED';
  readonly revokedAt?: string | null;
}

/** Persistence port for I4 (relationships + permissions + audit). Dumb CRUD. */
export interface RelationshipStore {
  insertRequest(r: RelationshipRequestRecord): Promise<void>;
  updateRequest(id: string, patch: RequestPatch): Promise<void>;
  getRequest(id: string): Promise<RelationshipRequestRecord | null>;
  findPendingRequest(key: {
    requesterUserId: string;
    targetChildId: string | null;
    relationshipKind: RelationshipKind;
    subjectId: string | null;
  }): Promise<RelationshipRequestRecord | null>;
  listRequestsForResponder(userId: string): Promise<readonly RelationshipRequestRecord[]>;
  listRequestsByRequester(userId: string): Promise<readonly RelationshipRequestRecord[]>;
  listRequestsForChild(childId: string): Promise<readonly RelationshipRequestRecord[]>;

  insertTeacherChildLink(r: TeacherChildLinkRecord): Promise<void>;
  updateTeacherChildLink(id: string, patch: TeacherChildLinkPatch): Promise<void>;
  getTeacherChildLink(id: string): Promise<TeacherChildLinkRecord | null>;
  listTeacherChildLinks(key: {
    teacherUserId?: string;
    childId?: string;
  }): Promise<readonly TeacherChildLinkRecord[]>;

  insertTeacherParentLink(r: TeacherParentLinkRecord): Promise<void>;
  updateTeacherParentLink(id: string, patch: TeacherParentLinkPatch): Promise<void>;
  getTeacherParentLink(id: string): Promise<TeacherParentLinkRecord | null>;
  listTeacherParentLinks(key: {
    teacherUserId?: string;
    parentUserId?: string;
  }): Promise<readonly TeacherParentLinkRecord[]>;

  insertGrant(r: PermissionGrantRecord): Promise<void>;
  updateGrant(id: string, patch: GrantPatch): Promise<void>;
  listGrantsForLink(linkId: string): Promise<readonly PermissionGrantRecord[]>;

  getPrivacyPreferences(childId: string): Promise<PrivacyPreferencesRecord | null>;
  upsertPrivacyPreferences(r: PrivacyPreferencesRecord): Promise<void>;

  appendAuditEvent(r: AuditEventRecord): Promise<void>;
  listAuditEvents(key: { childId?: string; eventType?: AuditEventType }): Promise<readonly AuditEventRecord[]>;
}

// ---------------------------------------------------------------------------

const clone = <T>(v: T): T => structuredClone(v);
function strip<T extends object>(p: T): Partial<T> {
  const o: Partial<T> = {};
  for (const [k, v] of Object.entries(p)) if (v !== undefined) (o as Record<string, unknown>)[k] = v;
  return o;
}

export class InMemoryRelationshipStore implements RelationshipStore {
  readonly #requests = new Map<string, RelationshipRequestRecord>();
  readonly #tcl = new Map<string, TeacherChildLinkRecord>();
  readonly #tpl = new Map<string, TeacherParentLinkRecord>();
  readonly #grants = new Map<string, PermissionGrantRecord>();
  readonly #privacy = new Map<string, PrivacyPreferencesRecord>();
  readonly #audit: AuditEventRecord[] = [];

  insertRequest(r: RelationshipRequestRecord): Promise<void> {
    if (r.status === 'PENDING') {
      for (const x of this.#requests.values()) {
        if (
          x.status === 'PENDING' &&
          x.requesterUserId === r.requesterUserId &&
          x.targetChildId === r.targetChildId &&
          x.relationshipKind === r.relationshipKind &&
          (x.subjectId ?? null) === (r.subjectId ?? null) &&
          r.targetChildId !== null
        ) {
          return Promise.reject(new Error('DUPLICATE_PENDING_REQUEST'));
        }
      }
    }
    this.#requests.set(r.id, clone(r));
    return Promise.resolve();
  }
  updateRequest(id: string, patch: RequestPatch): Promise<void> {
    const cur = this.#requests.get(id);
    if (!cur) return Promise.reject(new Error(`request ${id} not found`));
    this.#requests.set(id, { ...cur, ...strip(patch) });
    return Promise.resolve();
  }
  getRequest(id: string): Promise<RelationshipRequestRecord | null> {
    const r = this.#requests.get(id);
    return Promise.resolve(r ? clone(r) : null);
  }
  findPendingRequest(key: {
    requesterUserId: string;
    targetChildId: string | null;
    relationshipKind: RelationshipKind;
    subjectId: string | null;
  }): Promise<RelationshipRequestRecord | null> {
    for (const r of this.#requests.values()) {
      if (
        r.status === 'PENDING' &&
        r.requesterUserId === key.requesterUserId &&
        r.targetChildId === key.targetChildId &&
        r.relationshipKind === key.relationshipKind &&
        (r.subjectId ?? null) === key.subjectId
      ) {
        return Promise.resolve(clone(r));
      }
    }
    return Promise.resolve(null);
  }
  listRequestsForResponder(userId: string): Promise<readonly RelationshipRequestRecord[]> {
    // best-effort — the service decides who the required responder is; this
    // returns candidates: teacher-targeted requests + parent-targeted + child requests.
    return Promise.resolve(
      [...this.#requests.values()].filter(
        (r) => r.targetUserId === userId || r.respondedByUserId === userId,
      ).map(clone),
    );
  }
  listRequestsByRequester(userId: string): Promise<readonly RelationshipRequestRecord[]> {
    return Promise.resolve([...this.#requests.values()].filter((r) => r.requesterUserId === userId).map(clone));
  }
  listRequestsForChild(childId: string): Promise<readonly RelationshipRequestRecord[]> {
    return Promise.resolve([...this.#requests.values()].filter((r) => r.targetChildId === childId).map(clone));
  }

  insertTeacherChildLink(r: TeacherChildLinkRecord): Promise<void> {
    if (r.status === 'PENDING' || r.status === 'ACCEPTED') {
      for (const x of this.#tcl.values()) {
        if (
          (x.status === 'PENDING' || x.status === 'ACCEPTED') &&
          x.teacherUserId === r.teacherUserId &&
          x.childId === r.childId &&
          (x.subjectId ?? null) === (r.subjectId ?? null) &&
          x.accessSource === r.accessSource
        ) {
          return Promise.reject(new Error('ACTIVE_LINK_EXISTS'));
        }
      }
    }
    if (r.status === 'ACCEPTED' && r.acceptedByParentUserId === null) {
      return Promise.reject(new Error('R2_VIOLATION: ACCEPTED link must name the accepting guardian'));
    }
    this.#tcl.set(r.id, clone(r));
    return Promise.resolve();
  }
  updateTeacherChildLink(id: string, patch: TeacherChildLinkPatch): Promise<void> {
    const cur = this.#tcl.get(id);
    if (!cur) return Promise.reject(new Error(`teacher_child_link ${id} not found`));
    const next = { ...cur, ...strip(patch) };
    if (next.status === 'ACCEPTED' && next.acceptedByParentUserId === null) {
      return Promise.reject(new Error('R2_VIOLATION'));
    }
    this.#tcl.set(id, next);
    return Promise.resolve();
  }
  getTeacherChildLink(id: string): Promise<TeacherChildLinkRecord | null> {
    const r = this.#tcl.get(id);
    return Promise.resolve(r ? clone(r) : null);
  }
  listTeacherChildLinks(key: { teacherUserId?: string; childId?: string }): Promise<readonly TeacherChildLinkRecord[]> {
    return Promise.resolve(
      [...this.#tcl.values()]
        .filter(
          (r) =>
            (key.teacherUserId === undefined || r.teacherUserId === key.teacherUserId) &&
            (key.childId === undefined || r.childId === key.childId),
        )
        .map(clone),
    );
  }

  insertTeacherParentLink(r: TeacherParentLinkRecord): Promise<void> {
    this.#tpl.set(r.id, clone(r));
    return Promise.resolve();
  }
  updateTeacherParentLink(id: string, patch: TeacherParentLinkPatch): Promise<void> {
    const cur = this.#tpl.get(id);
    if (!cur) return Promise.reject(new Error(`teacher_parent_link ${id} not found`));
    this.#tpl.set(id, { ...cur, ...strip(patch) });
    return Promise.resolve();
  }
  getTeacherParentLink(id: string): Promise<TeacherParentLinkRecord | null> {
    const r = this.#tpl.get(id);
    return Promise.resolve(r ? clone(r) : null);
  }
  listTeacherParentLinks(key: { teacherUserId?: string; parentUserId?: string }): Promise<readonly TeacherParentLinkRecord[]> {
    return Promise.resolve(
      [...this.#tpl.values()]
        .filter(
          (r) =>
            (key.teacherUserId === undefined || r.teacherUserId === key.teacherUserId) &&
            (key.parentUserId === undefined || r.parentUserId === key.parentUserId),
        )
        .map(clone),
    );
  }

  insertGrant(r: PermissionGrantRecord): Promise<void> {
    if (r.status === 'ACTIVE') {
      for (const x of this.#grants.values()) {
        if (
          x.status === 'ACTIVE' &&
          x.subjectLinkId === r.subjectLinkId &&
          x.permissionCode === r.permissionCode &&
          (x.subjectId ?? null) === (r.subjectId ?? null) &&
          x.accessSource === r.accessSource
        ) {
          return Promise.resolve(); // idempotent
        }
      }
    }
    this.#grants.set(r.id, clone(r));
    return Promise.resolve();
  }
  updateGrant(id: string, patch: GrantPatch): Promise<void> {
    const cur = this.#grants.get(id);
    if (!cur) return Promise.reject(new Error(`grant ${id} not found`));
    this.#grants.set(id, { ...cur, ...strip(patch) });
    return Promise.resolve();
  }
  listGrantsForLink(linkId: string): Promise<readonly PermissionGrantRecord[]> {
    return Promise.resolve([...this.#grants.values()].filter((g) => g.subjectLinkId === linkId).map(clone));
  }

  getPrivacyPreferences(childId: string): Promise<PrivacyPreferencesRecord | null> {
    const p = this.#privacy.get(childId);
    return Promise.resolve(p ? clone(p) : null);
  }
  upsertPrivacyPreferences(r: PrivacyPreferencesRecord): Promise<void> {
    this.#privacy.set(r.childId, clone(r));
    return Promise.resolve();
  }

  appendAuditEvent(r: AuditEventRecord): Promise<void> {
    this.#audit.push(clone(r));
    return Promise.resolve();
  }
  listAuditEvents(key: { childId?: string; eventType?: AuditEventType }): Promise<readonly AuditEventRecord[]> {
    return Promise.resolve(
      this.#audit
        .filter(
          (e) =>
            (key.childId === undefined || e.childId === key.childId) &&
            (key.eventType === undefined || e.eventType === key.eventType),
        )
        .map(clone),
    );
  }
}
