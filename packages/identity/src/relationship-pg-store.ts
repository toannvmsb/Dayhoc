import type { Pool } from 'pg';
import type {
  AuditEventRecord,
  AuditEventType,
  PermissionGrantRecord,
  PrivacyPreferencesRecord,
  RelationshipKind,
  RelationshipRequestRecord,
  TeacherChildLinkRecord,
  TeacherParentLinkRecord,
} from '@copilot/domain';
import type {
  GrantPatch,
  RelationshipStore,
  RequestPatch,
  TeacherChildLinkPatch,
  TeacherParentLinkPatch,
} from './relationship-store.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoN = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

function rowToRequest(r: any): RelationshipRequestRecord {
  return {
    id: r.id,
    requesterUserId: r.requester_user_id,
    requesterRole: r.requester_role,
    targetType: r.target_type,
    targetUserId: r.target_user_id ?? null,
    targetChildId: r.target_child_id ?? null,
    relationshipKind: r.relationship_kind,
    relationshipType: r.relationship_type,
    subjectId: r.subject_id ?? null,
    accessSource: r.access_source,
    proposedPermissions: arr(r.proposed_permissions),
    message: r.message ?? null,
    discoveryMethod: r.discovery_method,
    status: r.status,
    expiresAt: iso(r.expires_at),
    respondedByUserId: r.responded_by_user_id ?? null,
    respondedAt: isoN(r.responded_at),
    approvedPermissions: r.approved_permissions === null || r.approved_permissions === undefined ? null : arr(r.approved_permissions),
    createdAt: iso(r.created_at),
  };
}
function rowToTcl(r: any): TeacherChildLinkRecord {
  return {
    id: r.id,
    teacherUserId: r.teacher_user_id,
    childId: r.child_id,
    subjectId: r.subject_id ?? null,
    relationshipType: r.relationship_type,
    accessSource: r.access_source,
    accessSourceId: r.access_source_id ?? null,
    initiatedByRole: r.initiated_by_role,
    initiatedByUserId: r.initiated_by_user_id,
    originRequestId: r.origin_request_id ?? null,
    status: r.status,
    acceptedByParentUserId: r.accepted_by_parent_user_id ?? null,
    needsGuardianReview: r.needs_guardian_review,
    validFrom: isoN(r.valid_from),
    validUntil: isoN(r.valid_until),
    acceptedAt: isoN(r.accepted_at),
    rejectedAt: isoN(r.rejected_at),
    revokedAt: isoN(r.revoked_at),
    createdAt: iso(r.created_at),
  };
}
function rowToTpl(r: any): TeacherParentLinkRecord {
  return {
    id: r.id,
    teacherUserId: r.teacher_user_id,
    parentUserId: r.parent_user_id,
    childId: r.child_id ?? null,
    subjectId: r.subject_id ?? null,
    purpose: r.purpose,
    initiatedByRole: r.initiated_by_role,
    initiatedByUserId: r.initiated_by_user_id,
    originRequestId: r.origin_request_id ?? null,
    status: r.status,
    acceptedByUserId: r.accepted_by_user_id ?? null,
    acceptedAt: isoN(r.accepted_at),
    revokedAt: isoN(r.revoked_at),
    createdAt: iso(r.created_at),
  };
}
function rowToGrant(r: any): PermissionGrantRecord {
  return {
    id: r.id,
    subjectLinkType: r.subject_link_type,
    subjectLinkId: r.subject_link_id,
    permissionCode: r.permission_code,
    subjectId: r.subject_id ?? null,
    accessSource: r.access_source,
    grantedByUserId: r.granted_by_user_id,
    status: r.status,
    grantedAt: iso(r.granted_at),
    revokedAt: isoN(r.revoked_at),
  };
}
function rowToPrivacy(r: any): PrivacyPreferencesRecord {
  return {
    childId: r.child_id,
    defaultClassPrivacyMode: r.default_class_privacy_mode,
    allowTeacherDiscoveryByEmail: r.allow_teacher_discovery_by_email,
    allowTeacherDiscoveryByClassJoin: r.allow_teacher_discovery_by_class_join,
    shareBehaviourObservationsWithChild: r.share_behaviour_observations_with_child,
    updatedBy: r.updated_by ?? null,
    updatedAt: iso(r.updated_at),
  };
}
function rowToAudit(r: any): AuditEventRecord {
  return {
    id: r.id,
    actorUserId: r.actor_user_id ?? null,
    actorWorkspace: r.actor_workspace ?? null,
    eventType: r.event_type,
    subjectType: r.subject_type ?? null,
    subjectId: r.subject_id ?? null,
    childId: r.child_id ?? null,
    payload: r.payload ?? {},
    createdAt: iso(r.created_at),
  };
}

function setClause(patch: object, cols: Record<string, string>): { sql: string; vals: unknown[] } {
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined || !cols[k]) continue;
    vals.push(k === 'approvedPermissions' && v !== null ? JSON.stringify(v) : v);
    sets.push(`${cols[k]} = $${vals.length}${k === 'approvedPermissions' ? '::jsonb' : ''}`);
  }
  return { sql: sets.join(', '), vals };
}

export class PgRelationshipStore implements RelationshipStore {
  constructor(private readonly pool: Pool) {}

  async insertRequest(r: RelationshipRequestRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO relationship_requests (id, requester_user_id, requester_role, target_type,
         target_user_id, target_child_id, relationship_kind, relationship_type, subject_id,
         access_source, proposed_permissions, message, discovery_method, status, expires_at,
         responded_by_user_id, responded_at, approved_permissions, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        r.id, r.requesterUserId, r.requesterRole, r.targetType, r.targetUserId, r.targetChildId,
        r.relationshipKind, r.relationshipType, r.subjectId, r.accessSource,
        JSON.stringify(r.proposedPermissions), r.message, r.discoveryMethod, r.status, r.expiresAt,
        r.respondedByUserId, r.respondedAt, r.approvedPermissions ? JSON.stringify(r.approvedPermissions) : null,
        r.createdAt,
      ],
    );
  }
  async updateRequest(id: string, patch: RequestPatch): Promise<void> {
    const { sql, vals } = setClause(patch, {
      status: 'status', respondedByUserId: 'responded_by_user_id', respondedAt: 'responded_at',
      approvedPermissions: 'approved_permissions',
    });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE relationship_requests SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getRequest(id: string): Promise<RelationshipRequestRecord | null> {
    const r = await this.pool.query(`SELECT * FROM relationship_requests WHERE id = $1`, [id]);
    return r.rows[0] ? rowToRequest(r.rows[0]) : null;
  }
  async findPendingRequest(key: {
    requesterUserId: string; targetChildId: string | null; relationshipKind: RelationshipKind; subjectId: string | null;
  }): Promise<RelationshipRequestRecord | null> {
    const r = await this.pool.query(
      `SELECT * FROM relationship_requests
       WHERE status = 'PENDING' AND requester_user_id = $1 AND relationship_kind = $2
         AND target_child_id IS NOT DISTINCT FROM $3
         AND subject_id IS NOT DISTINCT FROM $4`,
      [key.requesterUserId, key.relationshipKind, key.targetChildId, key.subjectId],
    );
    return r.rows[0] ? rowToRequest(r.rows[0]) : null;
  }
  async listRequestsForResponder(userId: string): Promise<readonly RelationshipRequestRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM relationship_requests WHERE target_user_id = $1 OR responded_by_user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return r.rows.map(rowToRequest);
  }
  async listRequestsByRequester(userId: string): Promise<readonly RelationshipRequestRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM relationship_requests WHERE requester_user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return r.rows.map(rowToRequest);
  }
  async listRequestsForChild(childId: string): Promise<readonly RelationshipRequestRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM relationship_requests WHERE target_child_id = $1 ORDER BY created_at`,
      [childId],
    );
    return r.rows.map(rowToRequest);
  }

  async insertTeacherChildLink(r: TeacherChildLinkRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO teacher_child_links (id, teacher_user_id, child_id, subject_id, relationship_type,
         access_source, access_source_id, initiated_by_role, initiated_by_user_id, origin_request_id,
         status, accepted_by_parent_user_id, needs_guardian_review, valid_from, valid_until,
         accepted_at, rejected_at, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        r.id, r.teacherUserId, r.childId, r.subjectId, r.relationshipType, r.accessSource,
        r.accessSourceId, r.initiatedByRole, r.initiatedByUserId, r.originRequestId, r.status,
        r.acceptedByParentUserId, r.needsGuardianReview, r.validFrom, r.validUntil, r.acceptedAt,
        r.rejectedAt, r.revokedAt, r.createdAt,
      ],
    );
  }
  async updateTeacherChildLink(id: string, patch: TeacherChildLinkPatch): Promise<void> {
    const { sql, vals } = setClause(patch, {
      status: 'status', acceptedByParentUserId: 'accepted_by_parent_user_id',
      needsGuardianReview: 'needs_guardian_review', acceptedAt: 'accepted_at',
      rejectedAt: 'rejected_at', revokedAt: 'revoked_at', validFrom: 'valid_from', validUntil: 'valid_until',
    });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE teacher_child_links SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getTeacherChildLink(id: string): Promise<TeacherChildLinkRecord | null> {
    const r = await this.pool.query(`SELECT * FROM teacher_child_links WHERE id = $1`, [id]);
    return r.rows[0] ? rowToTcl(r.rows[0]) : null;
  }
  async listTeacherChildLinks(key: { teacherUserId?: string; childId?: string }): Promise<readonly TeacherChildLinkRecord[]> {
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (key.teacherUserId) {
      vals.push(key.teacherUserId);
      conds.push(`teacher_user_id = $${vals.length}`);
    }
    if (key.childId) {
      vals.push(key.childId);
      conds.push(`child_id = $${vals.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await this.pool.query(`SELECT * FROM teacher_child_links ${where} ORDER BY created_at`, vals);
    return r.rows.map(rowToTcl);
  }

  async insertTeacherParentLink(r: TeacherParentLinkRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO teacher_parent_links (id, teacher_user_id, parent_user_id, child_id, subject_id,
         purpose, initiated_by_role, initiated_by_user_id, origin_request_id, status,
         accepted_by_user_id, accepted_at, revoked_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        r.id, r.teacherUserId, r.parentUserId, r.childId, r.subjectId, r.purpose, r.initiatedByRole,
        r.initiatedByUserId, r.originRequestId, r.status, r.acceptedByUserId, r.acceptedAt, r.revokedAt,
        r.createdAt,
      ],
    );
  }
  async updateTeacherParentLink(id: string, patch: TeacherParentLinkPatch): Promise<void> {
    const { sql, vals } = setClause(patch, {
      status: 'status', acceptedByUserId: 'accepted_by_user_id', acceptedAt: 'accepted_at', revokedAt: 'revoked_at',
    });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE teacher_parent_links SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async getTeacherParentLink(id: string): Promise<TeacherParentLinkRecord | null> {
    const r = await this.pool.query(`SELECT * FROM teacher_parent_links WHERE id = $1`, [id]);
    return r.rows[0] ? rowToTpl(r.rows[0]) : null;
  }
  async listTeacherParentLinks(key: { teacherUserId?: string; parentUserId?: string }): Promise<readonly TeacherParentLinkRecord[]> {
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (key.teacherUserId) {
      vals.push(key.teacherUserId);
      conds.push(`teacher_user_id = $${vals.length}`);
    }
    if (key.parentUserId) {
      vals.push(key.parentUserId);
      conds.push(`parent_user_id = $${vals.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await this.pool.query(`SELECT * FROM teacher_parent_links ${where} ORDER BY created_at`, vals);
    return r.rows.map(rowToTpl);
  }

  async insertGrant(r: PermissionGrantRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO permission_grants (id, subject_link_type, subject_link_id, permission_code, subject_id,
         access_source, granted_by_user_id, status, granted_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING`,
      [
        r.id, r.subjectLinkType, r.subjectLinkId, r.permissionCode, r.subjectId, r.accessSource,
        r.grantedByUserId, r.status, r.grantedAt, r.revokedAt,
      ],
    );
  }
  async updateGrant(id: string, patch: GrantPatch): Promise<void> {
    const { sql, vals } = setClause(patch, { status: 'status', revokedAt: 'revoked_at' });
    if (!sql) return;
    vals.push(id);
    await this.pool.query(`UPDATE permission_grants SET ${sql} WHERE id = $${vals.length}`, vals);
  }
  async listGrantsForLink(linkId: string): Promise<readonly PermissionGrantRecord[]> {
    const r = await this.pool.query(`SELECT * FROM permission_grants WHERE subject_link_id = $1`, [linkId]);
    return r.rows.map(rowToGrant);
  }

  async getPrivacyPreferences(childId: string): Promise<PrivacyPreferencesRecord | null> {
    const r = await this.pool.query(`SELECT * FROM privacy_preferences WHERE child_id = $1`, [childId]);
    return r.rows[0] ? rowToPrivacy(r.rows[0]) : null;
  }
  async upsertPrivacyPreferences(r: PrivacyPreferencesRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO privacy_preferences (child_id, default_class_privacy_mode, allow_teacher_discovery_by_email,
         allow_teacher_discovery_by_class_join, share_behaviour_observations_with_child, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (child_id) DO UPDATE SET
         default_class_privacy_mode = EXCLUDED.default_class_privacy_mode,
         allow_teacher_discovery_by_email = EXCLUDED.allow_teacher_discovery_by_email,
         allow_teacher_discovery_by_class_join = EXCLUDED.allow_teacher_discovery_by_class_join,
         share_behaviour_observations_with_child = EXCLUDED.share_behaviour_observations_with_child,
         updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
      [
        r.childId, r.defaultClassPrivacyMode, r.allowTeacherDiscoveryByEmail,
        r.allowTeacherDiscoveryByClassJoin, r.shareBehaviourObservationsWithChild, r.updatedBy, r.updatedAt,
      ],
    );
  }

  async appendAuditEvent(r: AuditEventRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (id, actor_user_id, actor_workspace, event_type, subject_type, subject_id,
         child_id, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
      [
        r.id, r.actorUserId, r.actorWorkspace, r.eventType, r.subjectType, r.subjectId, r.childId,
        JSON.stringify(r.payload), r.createdAt,
      ],
    );
  }
  async listAuditEvents(key: { childId?: string; eventType?: AuditEventType }): Promise<readonly AuditEventRecord[]> {
    const conds: string[] = [];
    const vals: unknown[] = [];
    if (key.childId) {
      vals.push(key.childId);
      conds.push(`child_id = $${vals.length}`);
    }
    if (key.eventType) {
      vals.push(key.eventType);
      conds.push(`event_type = $${vals.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await this.pool.query(`SELECT * FROM audit_events ${where} ORDER BY created_at`, vals);
    return r.rows.map(rowToAudit);
  }
}

/**
 * The teacher_invites → relationships migration, as an idempotent function that
 * mirrors migration `*_relationships_permissions`. Safe to re-run.
 */
export async function migrateTeacherInvitesFromLegacy(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO teacher_child_links (
      teacher_user_id, child_id, subject_id, relationship_type, access_source,
      initiated_by_role, initiated_by_user_id, status, accepted_by_parent_user_id,
      needs_guardian_review, accepted_at, created_at
    )
    SELECT t.user_id, ti.child_id, (SELECT id FROM subjects WHERE code = 'MATH'),
           'SUBJECT_TEACHER', 'PARENT_DIRECT', 'PARENT', f.owner_parent_id, 'ACCEPTED',
           f.owner_parent_id, true, now(), ti.created_at
    FROM teacher_invites ti
    JOIN teachers t ON t.id = ti.teacher_id
    JOIN families f ON f.id = ti.family_id
    WHERE ti.status = 'accepted' AND ti.teacher_id IS NOT NULL AND f.owner_parent_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM teacher_child_links x
        WHERE x.teacher_user_id = t.user_id AND x.child_id = ti.child_id AND x.status IN ('PENDING','ACCEPTED')
      );
  `);
  await pool.query(`
    INSERT INTO permission_grants (subject_link_type, subject_link_id, permission_code, subject_id,
      access_source, granted_by_user_id, status, granted_at)
    SELECT 'TEACHER_CHILD', l.id, code.c, l.subject_id, 'PARENT_DIRECT', l.accepted_by_parent_user_id, 'ACTIVE', now()
    FROM teacher_child_links l
    CROSS JOIN (VALUES ('VIEW_CLASS_CONTEXT'), ('SUBMIT_CURRENT_LESSON')) AS code(c)
    WHERE l.needs_guardian_review = true
      AND NOT EXISTS (
        SELECT 1 FROM permission_grants g
        WHERE g.subject_link_id = l.id AND g.permission_code = code.c AND g.status = 'ACTIVE'
      );
  `);
}
