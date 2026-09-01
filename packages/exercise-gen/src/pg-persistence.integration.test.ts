import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { createMockExerciseGenerator } from './mock-generator.js';
import { orchestrateGeneration } from './orchestrator.js';
import { toGenerationRecords } from './persistence.js';
import { makeSpec } from './_spec-fixture.js';

/**
 * Integration test — runs only when DATABASE_URL points at a migrated database
 * (`npm run db:migrate` first). Proves `PgGenerationStore` writes both
 * append-only rows and that a set traces back to its spec. Skipped in the
 * default unit run and in CI-without-Postgres.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();

describe.skipIf(!DATABASE_URL)('PgGenerationStore (integration)', () => {
  let pool: import('pg').Pool;
  let store: import('./pg-persistence.js').PgGenerationStore;
  let childId: string;
  const specId = `egs_it_${Date.now()}`;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    const { PgGenerationStore } = await import('./pg-persistence.js');
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PgGenerationStore(pool);
    const user = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    const fam = await pool.query<{ id: string }>(`INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`, [user.rows[0]!.id]);
    const child = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'Gen IT',7) RETURNING id`,
      [fam.rows[0]!.id],
    );
    childId = child.rows[0]!.id;
  });

  afterAll(async () => {
    if (pool && childId) {
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = replica`);
        await client.query(`DELETE FROM child_profiles WHERE id = $1`, [childId]);
      } finally {
        await client.query(`SET session_replication_role = origin`);
        client.release();
      }
      await pool.end();
    }
  });

  it('persists spec + set and the set traces to the spec', async () => {
    const spec = { ...makeSpec(), generationSpecId: specId, childId: childId as never };
    const result = await orchestrateGeneration({ spec, generator: createMockExerciseGenerator(), referenceLibrary: lib, knowledgeBase: kb });
    const { specRecord, setRecord } = toGenerationRecords(spec, result, { setId: `ges_it_${Date.now()}` });

    await store.putSpec(specRecord);
    await store.putExerciseSet(setRecord);

    const sets = await store.listExerciseSets(specId);
    expect(sets).toHaveLength(1);
    expect(sets[0]!.generationSpecId).toBe(specId);

    const back = await store.getSpec(specId);
    expect(back?.targetSelectorVersion).toBe(spec.provenance.targetSelectorVersion);

    // append-only: a second putExerciseSet with the same id is rejected by the trigger,
    // but a NEW id for the same spec is fine
    await expect(store.putExerciseSet({ ...setRecord })).rejects.toThrow();
  });
});
