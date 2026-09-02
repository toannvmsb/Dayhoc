import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EvidenceService } from './service.js';

/**
 * Integration test — runs only when DATABASE_URL points at a migrated database
 * (`npm run db:migrate` first). Proves PgLedgerStore + the append-only triggers
 * work together. Skipped in the default unit run and in CI-without-Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PgLedgerStore (integration)', () => {
  let pool: import('pg').Pool;
  let store: import('./pg-store.js').PgLedgerStore;
  let childId: string;
  let userId: string;
  let familyId: string;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    const { PgLedgerStore } = await import('./pg-store.js');
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PgLedgerStore(pool);
    const user = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    userId = user.rows[0]!.id;
    const fam = await pool.query<{ id: string }>(
      `INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`,
      [userId],
    );
    familyId = fam.rows[0]!.id;
    const child = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'IT Test',7) RETURNING id`,
      [familyId],
    );
    childId = child.rows[0]!.id;
  });

  afterAll(async () => {
    // Cascading a child delete into `evidence` hits the append-only trigger — by
    // design. Retention/erasure runs as a privileged op that suspends triggers;
    // we do the same here for test teardown only. Clean up EVERYTHING the test
    // created (child + family + user) so it can't skew a backfill/audit run.
    if (pool && childId) {
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = replica`);
        await client.query(`DELETE FROM child_profiles WHERE id = $1`, [childId]);
        await client.query(`DELETE FROM families WHERE id = $1`, [familyId]);
        await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
      } finally {
        await client.query(`SET session_replication_role = origin`);
        client.release();
      }
    }
    await pool?.end();
  });

  it('round-trips mixed-provenance evidence through Postgres', async () => {
    const service = new EvidenceService({ store });
    await service.record({
      childId, source: 'app_practice', occurredAt: '2026-08-30T10:00:00Z',
      skillId: 'M4.FRAC.COMMON_DENOM', result: { correct: false, score: 0.4 },
      hintDependency: 0.5, confidenceTier: 'B', provenance: 'parent',
    });
    await service.record({
      childId, source: 'school_test', occurredAt: '2026-08-31T08:00:00Z',
      skillId: 'M4.FRAC.EQUIVALENT', result: { correct: true }, confidenceTier: 'A', provenance: 'assessment',
    });
    const history = await service.history(childId);
    expect(history).toHaveLength(2);
    expect(history[0]!.occurredAt < history[1]!.occurredAt).toBe(true);
    expect(history[0]!.hintDependency).toBe(0.5);
  });

  it('the database itself rejects UPDATE and DELETE on evidence', async () => {
    await expect(pool.query(`UPDATE evidence SET confidence_tier='A' WHERE child_id=$1`, [childId])).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query(`DELETE FROM evidence WHERE child_id=$1`, [childId])).rejects.toThrow(/append-only/);
  });
});
