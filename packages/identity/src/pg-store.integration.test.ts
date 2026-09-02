import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUserId } from '@copilot/domain';
import { FamilyService } from './family-service.js';
import { guardianAuthority } from './guardian-authority.js';
import { IdentityService } from './identity-service.js';
import { InMemoryAuthAdapter } from './auth-adapter.js';

/**
 * Integration test — runs only when DATABASE_URL points at a database migrated
 * through `*_identity_family` (`npm run db:migrate` first). Proves:
 *  - `PgIdentityStore` round-trips through the real schema,
 *  - the legacy → identity backfill (test I / doc 26 §63) produces
 *    `MIGRATED_FAMILY_OWNER` provenance + the right capability split,
 *  - `child_id` is unchanged by the migration.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PgIdentityStore + backfill (integration)', () => {
  let pool: import('pg').Pool;
  let PgIdentityStore: typeof import('./pg-store.js').PgIdentityStore;
  let backfillIdentityFromLegacy: typeof import('./pg-store.js').backfillIdentityFromLegacy;
  const createdUserIds: string[] = [];
  const createdChildIds: string[] = [];
  const createdFamilyIds: string[] = [];

  beforeAll(async () => {
    const { Pool } = await import('pg');
    ({ PgIdentityStore, backfillIdentityFromLegacy } = await import('./pg-store.js'));
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = replica`);
        if (createdChildIds.length) {
          await client.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [
            createdChildIds,
          ]);
        }
        if (createdFamilyIds.length) {
          await client.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [createdFamilyIds]);
        }
        if (createdUserIds.length) {
          await client.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUserIds]);
        }
      } finally {
        await client.query(`SET session_replication_role = origin`);
        client.release();
      }
      await pool.end();
    }
  });

  it('round-trips a create-family / create-child / link-student flow through Postgres', async () => {
    const store = new PgIdentityStore(pool);
    const identity = new IdentityService({ store, auth: new InMemoryAuthAdapter('it-i1') });
    const family = new FamilyService({ store });

    const parent = await identity.register({
      email: `it-i1-parent-${Date.now()}@example.com`,
      password: 'supersecret',
      intendedRole: 'PARENT',
      displayName: 'IT Parent',
    });
    createdUserIds.push(parent.user.id);

    const familyId = await family.createFamily(parent.user.id);
    createdFamilyIds.push(familyId);

    const childId = await family.createChild({
      familyId,
      creatorUserId: parent.user.id,
      displayName: 'IT Child',
      schoolGrade: 7,
      dateOfBirth: '2013-05-01',
    });
    createdChildIds.push(childId);
    const childBefore = await store.getChild(childId);

    const student = await identity.register({
      email: `it-i1-student-${Date.now()}@example.com`,
      password: 'studentpass',
      intendedRole: 'STUDENT',
    });
    createdUserIds.push(student.user.id);

    const link = await identity.linkStudentAccount({
      studentUserId: student.user.id,
      childId,
      linkMethod: 'PARENT_INVITE',
      linkedByUserId: parent.user.id,
    });
    expect(link.status).toBe('ACTIVE');

    // child_id + profile unchanged
    expect(await store.getChild(childId)).toEqual(childBefore);

    const authority = await guardianAuthority(store, parent.user.id, childId);
    expect(authority).toEqual({
      canManageChild: true,
      canManagePrivacy: true,
      canApproveTeacherRelationships: true,
      isGuardian: true,
    });
  });

  it('test I (63) — legacy backfill: MIGRATED_FAMILY_OWNER provenance + capability split', async () => {
    // --- arrange a legacy-shaped family: owner + co-parent, both `parents` rows ---
    const owner = await pool.query<{ id: string }>(
      `INSERT INTO users(role, display_name) VALUES ('parent','IT Owner') RETURNING id`,
    );
    const coParent = await pool.query<{ id: string }>(
      `INSERT INTO users(role, display_name) VALUES ('parent','IT CoParent') RETURNING id`,
    );
    const ownerId = owner.rows[0]!.id;
    const coParentId = coParent.rows[0]!.id;
    createdUserIds.push(ownerId, coParentId);

    const fam = await pool.query<{ id: string }>(
      `INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`,
      [ownerId],
    );
    const familyId = fam.rows[0]!.id;
    createdFamilyIds.push(familyId);

    await pool.query(
      `INSERT INTO parents(user_id, family_id, display_name) VALUES ($1,$2,'IT Owner'),($3,$2,'IT CoParent')`,
      [ownerId, familyId, coParentId],
    );
    const child = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'IT Legacy Child',4) RETURNING id`,
      [familyId],
    );
    const childId = child.rows[0]!.id;
    createdChildIds.push(childId);

    const childCountBefore = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM child_profiles`,
    );

    // --- act: idempotent backfill (run twice to prove idempotency) ---
    await backfillIdentityFromLegacy(pool);
    await backfillIdentityFromLegacy(pool);

    // --- assert ---
    const store = new PgIdentityStore(pool);
    const rels = await store.listRelationshipsForChild(childId);
    expect(rels).toHaveLength(2);

    const ownerRel = rels.find((r) => r.parentUserId === asUserId(ownerId))!;
    expect(ownerRel).toMatchObject({
      authoritySource: 'MIGRATED_FAMILY_OWNER',
      canManageChild: true,
      canManagePrivacy: true,
      canApproveTeacherRelationships: true,
      isLegalGuardian: null,
      status: 'ACTIVE',
    });

    const coRel = rels.find((r) => r.parentUserId === asUserId(coParentId))!;
    expect(coRel).toMatchObject({
      authoritySource: 'SELF_DECLARED',
      canManageChild: true,
      canManagePrivacy: false,
      canApproveTeacherRelationships: false,
      isLegalGuardian: null,
    });

    expect(await guardianAuthority(store, asUserId(ownerId), childId)).toEqual({
      canManageChild: true,
      canManagePrivacy: true,
      canApproveTeacherRelationships: true,
      isGuardian: true,
    });
    expect(await guardianAuthority(store, asUserId(coParentId), childId)).toEqual({
      canManageChild: true,
      canManagePrivacy: false,
      canApproveTeacherRelationships: false,
      isGuardian: true,
    });

    // roles backfilled, no STUDENT role invented for anyone
    expect([...(await store.listRoles(asUserId(ownerId)))]).toEqual(['PARENT']);

    // child count unchanged by the backfill (no duplicate profile)
    const childCountAfter = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM child_profiles`,
    );
    expect(childCountAfter.rows[0]!.n).toBe(childCountBefore.rows[0]!.n);
  });

  it('the `children` compat view reflects `child_profiles`', async () => {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM children c JOIN child_profiles p ON p.id = c.id`,
    );
    const total = await pool.query(`SELECT count(*)::int AS n FROM child_profiles`);
    expect((r.rows[0] as { n: number }).n).toBe((total.rows[0] as { n: number }).n);
  });
});
