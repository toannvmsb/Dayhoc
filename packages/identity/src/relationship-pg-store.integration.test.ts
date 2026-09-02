import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration test — DB migrated through `*_relationships_permissions`. Proves:
 *  - `PgRelationshipStore` round-trips through the real schema,
 *  - the R-2 DB constraint (an ACCEPTED teacher_child_links must name the
 *    accepting guardian),
 *  - the audit_events append-only trigger,
 *  - `migrateTeacherInvitesFromLegacy` → LEGACY_MINIMAL, no over-grant (test H / §62).
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PgRelationshipStore + teacher_invites migration (integration)', () => {
  let pool: import('pg').Pool;
  let PgRelationshipStore: typeof import('./relationship-pg-store.js').PgRelationshipStore;
  let migrateTeacherInvitesFromLegacy: typeof import('./relationship-pg-store.js').migrateTeacherInvitesFromLegacy;
  const createdUserIds: string[] = [];
  const createdChildIds: string[] = [];
  const createdFamilyIds: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    ({ PgRelationshipStore, migrateTeacherInvitesFromLegacy } = await import('./relationship-pg-store.js'));
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      const c = await pool.connect();
      try {
        await c.query(`SET session_replication_role = replica`);
        await c.query(`DELETE FROM audit_events WHERE child_id = ANY($1::uuid[])`, [createdChildIds]);
        await c.query(`DELETE FROM permission_grants WHERE granted_by_user_id = ANY($1::uuid[])`, [createdUserIds]);
        await c.query(`DELETE FROM teacher_child_links WHERE child_id = ANY($1::uuid[])`, [createdChildIds]);
        await c.query(`DELETE FROM relationship_requests WHERE target_child_id = ANY($1::uuid[])`, [createdChildIds]);
        await c.query(`DELETE FROM teacher_invites WHERE child_id = ANY($1::uuid[])`, [createdChildIds]);
        await c.query(`DELETE FROM teachers WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
        await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [createdChildIds]);
        await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [createdFamilyIds]);
        await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
      } finally {
        await c.query(`SET session_replication_role = origin`);
        c.release();
      }
      await pool.end();
    }
  });

  it('audit_events is append-only (DB trigger)', async () => {
    const store = new PgRelationshipStore(pool);
    const owner = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    createdUserIds.push(owner.rows[0]!.id);
    await store.appendAuditEvent({
      id: crypto.randomUUID(),
      actorUserId: owner.rows[0]!.id,
      actorWorkspace: 'PARENT',
      eventType: 'RELATIONSHIP_REQUEST_CREATED',
      subjectType: 'test',
      subjectId: null,
      childId: null,
      payload: { t: 1 },
      createdAt: new Date().toISOString(),
    });
    await expect(
      pool.query(`UPDATE audit_events SET payload = '{}'::jsonb WHERE actor_user_id = $1`, [owner.rows[0]!.id]),
    ).rejects.toThrow(/append-only/);
  });

  it('test H (62) — a legacy accepted teacher_invite migrates to LEGACY_MINIMAL only', async () => {
    // arrange legacy-shaped data
    const parent = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    const teacherUser = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('teacher') RETURNING id`);
    createdUserIds.push(parent.rows[0]!.id, teacherUser.rows[0]!.id);
    const fam = await pool.query<{ id: string }>(
      `INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`,
      [parent.rows[0]!.id],
    );
    createdFamilyIds.push(fam.rows[0]!.id);
    const teacher = await pool.query<{ id: string }>(
      `INSERT INTO teachers(user_id) VALUES ($1) RETURNING id`,
      [teacherUser.rows[0]!.id],
    );
    const child = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'IT Rel Child',7) RETURNING id`,
      [fam.rows[0]!.id],
    );
    const childId = child.rows[0]!.id;
    createdChildIds.push(childId);
    await pool.query(
      `INSERT INTO teacher_invites(family_id, child_id, teacher_id, status, invited_by)
       VALUES ($1,$2,$3,'accepted',$4)`,
      [fam.rows[0]!.id, childId, teacher.rows[0]!.id, parent.rows[0]!.id],
    );

    // act — idempotent, run twice
    await migrateTeacherInvitesFromLegacy(pool);
    await migrateTeacherInvitesFromLegacy(pool);

    // assert
    const store = new PgRelationshipStore(pool);
    const links = await store.listTeacherChildLinks({ childId });
    expect(links).toHaveLength(1);
    expect(links[0]!).toMatchObject({
      status: 'ACCEPTED',
      accessSource: 'PARENT_DIRECT',
      needsGuardianReview: true,
      acceptedByParentUserId: parent.rows[0]!.id,
    });
    const grants = await store.listGrantsForLink(links[0]!.id);
    const codes = grants.filter((g) => g.status === 'ACTIVE').map((g) => g.permissionCode).sort();
    expect(codes).toEqual(['SUBMIT_CURRENT_LESSON', 'VIEW_CLASS_CONTEXT']);
    // NEVER a sensitive or child-specific code
    expect(codes).not.toContain('VIEW_SELECTED_GAPS');
    expect(codes).not.toContain('VIEW_LEARNING_TWIN_SUMMARY');
    expect(codes).not.toContain('SUBMIT_SKILL_ASSESSMENT');
  });

  it('DB rejects an ACCEPTED teacher_child_links with no accepting guardian (R-2 constraint)', async () => {
    const teacherUser = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('teacher') RETURNING id`);
    createdUserIds.push(teacherUser.rows[0]!.id);
    const childId = createdChildIds[0]!;
    await expect(
      pool.query(
        `INSERT INTO teacher_child_links
           (teacher_user_id, child_id, relationship_type, access_source, initiated_by_role,
            initiated_by_user_id, status)
         VALUES ($1,$2,'SUBJECT_TEACHER','PARENT_DIRECT','TEACHER',$1,'ACCEPTED')`,
        [teacherUser.rows[0]!.id, childId],
      ),
    ).rejects.toThrow();
  });
});
