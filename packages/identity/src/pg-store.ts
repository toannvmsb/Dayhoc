import type { Pool, PoolClient } from 'pg';
type Queryable = Pool | PoolClient;
import {
  asFamilyId,
  asUserId,
  type FamilyId,
  type FamilyMembershipRecord,
  type ParentChildRelationshipRecord,
  type ParentProfileRecord,
  type StudentAccountLinkRecord,
  type TeacherProfileRecord,
  type UserId,
  type UserRecord,
  type UserRoleRecord,
  type WorkspaceRole,
} from '@copilot/domain';
import type {
  ChildStub,
  IdentityStore,
  LegacyUserRole,
  RelationshipPatch,
  StudentLinkPatch,
} from './store.js';

export { PgRelationshipStore, migrateTeacherInvitesFromLegacy } from './relationship-pg-store.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : String(v);
const isoOrNull = (v: unknown): string | null =>
  v === null || v === undefined ? null : iso(v);

function rowToUser(r: any): UserRecord {
  return {
    id: asUserId(r.id),
    authUserId: r.auth_user_id ?? null,
    primaryEmail: r.primary_email ?? null,
    primaryPhone: r.primary_phone ?? null,
    displayName: r.display_name ?? null,
    locale: r.locale,
    status: r.status,
    createdAt: iso(r.created_at),
  };
}

function rowToRelationship(r: any): ParentChildRelationshipRecord {
  return {
    id: r.id,
    parentUserId: asUserId(r.parent_user_id),
    childId: r.child_id,
    relationshipType: r.relationship_type,
    canManageChild: r.can_manage_child,
    canManagePrivacy: r.can_manage_privacy,
    canApproveTeacherRelationships: r.can_approve_teacher_relationships,
    authoritySource: r.authority_source,
    isLegalGuardian: r.is_legal_guardian ?? null,
    status: r.status,
    validFrom: isoOrNull(r.valid_from),
    validUntil: isoOrNull(r.valid_until),
    createdAt: iso(r.created_at),
    revokedAt: isoOrNull(r.revoked_at),
  };
}

function rowToStudentLink(r: any): StudentAccountLinkRecord {
  return {
    id: r.id,
    userId: asUserId(r.user_id),
    childId: r.child_id,
    linkedByUserId: r.linked_by_user_id ? asUserId(r.linked_by_user_id) : null,
    linkMethod: r.link_method,
    status: r.status,
    createdAt: iso(r.created_at),
    revokedAt: isoOrNull(r.revoked_at),
  };
}

/**
 * PostgreSQL backend for `@copilot/identity` (schema: migration
 * `*_identity_family`). Dumb CRUD — invariants live in the services.
 */
export class PgIdentityStore implements IdentityStore {
  constructor(private readonly pool: Queryable) {}

  async insertUser(u: UserRecord, legacyRole: LegacyUserRole = 'parent'): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, role, auth_user_id, primary_email, primary_phone, display_name, locale, status, created_at)
       VALUES ($1, $9, $2, $3, $4, $5, $6, $7, $8)`,
      [u.id, u.authUserId, u.primaryEmail, u.primaryPhone, u.displayName, u.locale, u.status, u.createdAt, legacyRole],
    );
  }

  async getUser(id: UserId): Promise<UserRecord | null> {
    const r = await this.pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }

  async findUserByAuthId(authUserId: string): Promise<UserRecord | null> {
    const r = await this.pool.query(`SELECT * FROM users WHERE auth_user_id = $1`, [authUserId]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const r = await this.pool.query(`SELECT * FROM users WHERE lower(primary_email) = lower($1)`, [
      email,
    ]);
    return r.rows[0] ? rowToUser(r.rows[0]) : null;
  }

  async addRole(rec: UserRoleRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_roles (user_id, role, granted_at, granted_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, role) DO NOTHING`,
      [rec.userId, rec.role, rec.grantedAt, rec.grantedBy],
    );
  }

  async listRoles(userId: UserId): Promise<readonly WorkspaceRole[]> {
    const r = await this.pool.query(`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, [
      userId,
    ]);
    return r.rows.map((x: any) => x.role as WorkspaceRole);
  }

  async upsertParentProfile(p: ParentProfileRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO parent_profiles (user_id, display_name, contact_visibility, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name,
         contact_visibility = EXCLUDED.contact_visibility`,
      [p.userId, p.displayName, p.contactVisibility, p.createdAt],
    );
  }

  async upsertTeacherProfile(p: TeacherProfileRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO teacher_profiles (user_id, display_name, headline, subjects_taught, verification_status, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name,
         headline = EXCLUDED.headline, subjects_taught = EXCLUDED.subjects_taught,
         verification_status = EXCLUDED.verification_status`,
      [
        p.userId,
        p.displayName,
        p.headline,
        JSON.stringify(p.subjectsTaught),
        p.verificationStatus,
        p.createdAt,
      ],
    );
  }

  async getParentProfile(userId: UserId): Promise<ParentProfileRecord | null> {
    const r = await this.pool.query(`SELECT * FROM parent_profiles WHERE user_id = $1`, [userId]);
    const x = r.rows[0] as any;
    return x
      ? {
          userId: asUserId(x.user_id),
          displayName: x.display_name,
          contactVisibility: x.contact_visibility,
          createdAt: iso(x.created_at),
        }
      : null;
  }

  async getTeacherProfile(userId: UserId): Promise<TeacherProfileRecord | null> {
    const r = await this.pool.query(`SELECT * FROM teacher_profiles WHERE user_id = $1`, [userId]);
    const x = r.rows[0] as any;
    return x
      ? {
          userId: asUserId(x.user_id),
          displayName: x.display_name,
          headline: x.headline ?? null,
          subjectsTaught: Array.isArray(x.subjects_taught) ? x.subjects_taught : [],
          verificationStatus: x.verification_status,
          createdAt: iso(x.created_at),
        }
      : null;
  }

  async insertFamily(id: FamilyId, ownerParentId: UserId, createdAt: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO families (id, owner_parent_id, created_at) VALUES ($1, $2, $3)`,
      [id, ownerParentId, createdAt],
    );
  }

  async familyExists(id: FamilyId): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM families WHERE id = $1`, [id]);
    return r.rowCount === 1;
  }

  async addFamilyMembership(m: FamilyMembershipRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (family_id, user_id) DO NOTHING`,
      [m.familyId, m.userId, m.memberRole, m.joinedAt],
    );
  }

  async listFamilyMemberships(familyId: FamilyId): Promise<readonly FamilyMembershipRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM family_memberships WHERE family_id = $1 ORDER BY joined_at`,
      [familyId],
    );
    return r.rows.map((x: any) => ({
      familyId: asFamilyId(x.family_id),
      userId: asUserId(x.user_id),
      memberRole: x.member_role,
      joinedAt: iso(x.joined_at),
    }));
  }

  async insertChild(c: ChildStub): Promise<void> {
    await this.pool.query(
      `INSERT INTO child_profiles (id, family_id, display_name, school_grade, date_of_birth)
       VALUES ($1, $2, $3, $4, $5)`,
      [c.id, c.familyId, c.displayName, c.schoolGrade, c.dateOfBirth],
    );
  }

  async getChild(id: string): Promise<ChildStub | null> {
    const r = await this.pool.query(
      `SELECT id, family_id, display_name, school_grade, date_of_birth FROM child_profiles WHERE id = $1`,
      [id],
    );
    const x = r.rows[0] as any;
    return x
      ? {
          id: x.id,
          familyId: asFamilyId(x.family_id),
          displayName: x.display_name,
          schoolGrade: x.school_grade,
          dateOfBirth: x.date_of_birth ? iso(x.date_of_birth).slice(0, 10) : null,
        }
      : null;
  }

  async countChildren(): Promise<number> {
    const r = await this.pool.query(`SELECT count(*)::int AS n FROM child_profiles`);
    return (r.rows[0] as any).n;
  }

  async insertRelationship(rec: ParentChildRelationshipRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO parent_child_relationships
         (id, parent_user_id, child_id, relationship_type, can_manage_child, can_manage_privacy,
          can_approve_teacher_relationships, authority_source, is_legal_guardian, status,
          valid_from, valid_until, created_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        rec.id,
        rec.parentUserId,
        rec.childId,
        rec.relationshipType,
        rec.canManageChild,
        rec.canManagePrivacy,
        rec.canApproveTeacherRelationships,
        rec.authoritySource,
        rec.isLegalGuardian,
        rec.status,
        rec.validFrom,
        rec.validUntil,
        rec.createdAt,
        rec.revokedAt,
      ],
    );
  }

  async updateRelationship(id: string, patch: RelationshipPatch): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const col: Record<string, string> = {
      relationshipType: 'relationship_type',
      canManageChild: 'can_manage_child',
      canManagePrivacy: 'can_manage_privacy',
      canApproveTeacherRelationships: 'can_approve_teacher_relationships',
      authoritySource: 'authority_source',
      isLegalGuardian: 'is_legal_guardian',
      status: 'status',
      revokedAt: 'revoked_at',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${col[k]} = $${vals.length}`);
    }
    if (sets.length === 0) return;
    vals.push(id);
    await this.pool.query(
      `UPDATE parent_child_relationships SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals,
    );
  }

  async getRelationship(id: string): Promise<ParentChildRelationshipRecord | null> {
    const r = await this.pool.query(`SELECT * FROM parent_child_relationships WHERE id = $1`, [id]);
    return r.rows[0] ? rowToRelationship(r.rows[0]) : null;
  }

  async listRelationshipsForChild(
    childId: string,
  ): Promise<readonly ParentChildRelationshipRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM parent_child_relationships WHERE child_id = $1 ORDER BY created_at`,
      [childId],
    );
    return r.rows.map(rowToRelationship);
  }

  async listRelationshipsForPair(
    parentUserId: UserId,
    childId: string,
  ): Promise<readonly ParentChildRelationshipRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM parent_child_relationships WHERE parent_user_id = $1 AND child_id = $2 ORDER BY created_at`,
      [parentUserId, childId],
    );
    return r.rows.map(rowToRelationship);
  }

  async insertStudentLink(rec: StudentAccountLinkRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO student_account_links
         (id, user_id, child_id, linked_by_user_id, link_method, status, created_at, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        rec.id,
        rec.userId,
        rec.childId,
        rec.linkedByUserId,
        rec.linkMethod,
        rec.status,
        rec.createdAt,
        rec.revokedAt,
      ],
    );
  }

  async updateStudentLink(id: string, patch: StudentLinkPatch): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    const col: Record<string, string> = {
      status: 'status',
      linkedByUserId: 'linked_by_user_id',
      revokedAt: 'revoked_at',
    };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      vals.push(v);
      sets.push(`${col[k]} = $${vals.length}`);
    }
    if (sets.length === 0) return;
    vals.push(id);
    await this.pool.query(
      `UPDATE student_account_links SET ${sets.join(', ')} WHERE id = $${vals.length}`,
      vals,
    );
  }

  async getStudentLink(id: string): Promise<StudentAccountLinkRecord | null> {
    const r = await this.pool.query(`SELECT * FROM student_account_links WHERE id = $1`, [id]);
    return r.rows[0] ? rowToStudentLink(r.rows[0]) : null;
  }

  async getActiveStudentLinkForChild(childId: string): Promise<StudentAccountLinkRecord | null> {
    const r = await this.pool.query(
      `SELECT * FROM student_account_links WHERE child_id = $1 AND status = 'ACTIVE'`,
      [childId],
    );
    return r.rows[0] ? rowToStudentLink(r.rows[0]) : null;
  }

  async listStudentLinksForUser(userId: UserId): Promise<readonly StudentAccountLinkRecord[]> {
    const r = await this.pool.query(
      `SELECT * FROM student_account_links WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    );
    return r.rows.map(rowToStudentLink);
  }
}

/**
 * Idempotent legacy → identity backfill. **Mirrors the SQL in migration
 * `*_identity_family`** — keep the two in sync. Safe to run repeatedly; used by
 * the migration itself and by scenario-driven integration tests.
 *
 *  - `user_roles`: PARENT / TEACHER / ADMIN from the legacy single `users.role`
 *    (`'child'` rows are intentionally skipped — ID-Q2).
 *  - `parent_profiles` / `teacher_profiles`: from `parents` / `teachers`.
 *  - `family_memberships`: OWNER from `families.owner_parent_id`, GUARDIAN from
 *    `parents`.
 *  - `parent_child_relationships`: family owner → `MIGRATED_FAMILY_OWNER`
 *    (all capabilities, `is_legal_guardian = NULL`); other parents →
 *    `SELF_DECLARED` (`can_manage_child` only).
 */
export async function backfillIdentityFromLegacy(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO user_roles (user_id, role, granted_at)
    SELECT u.id,
           CASE u.role WHEN 'parent' THEN 'PARENT'
                       WHEN 'teacher' THEN 'TEACHER'
                       WHEN 'admin' THEN 'ADMIN' END,
           now()
    FROM users u
    WHERE u.role IN ('parent','teacher','admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO parent_profiles (user_id, display_name, contact_visibility, created_at)
    SELECT DISTINCT ON (p.user_id) p.user_id, p.display_name, 'FAMILY', now()
    FROM parents p
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)
    ORDER BY p.user_id, p.id
    ON CONFLICT (user_id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO teacher_profiles (user_id, display_name, verification_status, created_at)
    SELECT DISTINCT ON (t.user_id) t.user_id, 'Teacher', 'UNVERIFIED', now()
    FROM teachers t
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id)
    ORDER BY t.user_id, t.id
    ON CONFLICT (user_id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
    SELECT f.id, f.owner_parent_id, 'OWNER', now()
    FROM families f
    WHERE f.owner_parent_id IS NOT NULL
    ON CONFLICT (family_id, user_id) DO NOTHING;
  `);
  await pool.query(`
    INSERT INTO family_memberships (family_id, user_id, member_role, joined_at)
    SELECT p.family_id, p.user_id, 'GUARDIAN', now()
    FROM parents p
    WHERE EXISTS (SELECT 1 FROM families f WHERE f.id = p.family_id)
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.user_id)
      AND NOT EXISTS (
        SELECT 1 FROM families f WHERE f.id = p.family_id AND f.owner_parent_id = p.user_id
      )
    ON CONFLICT (family_id, user_id) DO NOTHING;
  `);
  await pool.query(`
    WITH family_parents AS (
      SELECT c.id AS child_id,
             fm.user_id AS parent_user_id,
             (fm.member_role = 'OWNER') AS is_owner
      FROM child_profiles c
      JOIN family_memberships fm ON fm.family_id = c.family_id
      WHERE fm.member_role IN ('OWNER','GUARDIAN')
    )
    INSERT INTO parent_child_relationships (
      parent_user_id, child_id, relationship_type,
      can_manage_child, can_manage_privacy, can_approve_teacher_relationships,
      authority_source, is_legal_guardian, status, created_at
    )
    SELECT fp.parent_user_id, fp.child_id, 'GUARDIAN',
           true, fp.is_owner, fp.is_owner,
           CASE WHEN fp.is_owner THEN 'MIGRATED_FAMILY_OWNER' ELSE 'SELF_DECLARED' END,
           NULL, 'ACTIVE', now()
    FROM family_parents fp
    WHERE NOT EXISTS (
      SELECT 1 FROM parent_child_relationships r
      WHERE r.parent_user_id = fp.parent_user_id
        AND r.child_id = fp.child_id
        AND r.status = 'ACTIVE'
    );
  `);
}
