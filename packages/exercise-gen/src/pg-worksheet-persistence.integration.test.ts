import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { makeSpec } from './_spec-fixture.js';
import { orchestrateWorksheet } from './worksheet-orchestrator.js';
import { toWorksheetRecords } from './worksheet-persistence.js';
import { createFaultInjectingGenerator } from './fault-injecting-generator.js';
import { worksheetTraceToUsageEvents } from './worksheet-telemetry.js';

/**
 * Integration — runs only with a migrated `DATABASE_URL` (doc 66 §1). Proves
 * `PgWorksheetGenerationStore` + `PgReviewQueueStore` write the append-only /
 * mutable rows, the read-model rolls up, and the retention purge nulls
 * snapshots.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();

describe.skipIf(!DATABASE_URL)('Pg worksheet persistence (integration)', () => {
  let pool: import('pg').Pool;
  let store: import('./pg-worksheet-persistence.js').PgWorksheetGenerationStore;
  let rq: import('./pg-review-queue.js').PgReviewQueueStore;
  let childId: string;
  const specId = `egs_ws_it_${Date.now()}`;
  const runId = `wsrun_it_${Date.now()}`;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    const { PgWorksheetGenerationStore } = await import('./pg-worksheet-persistence.js');
    const { PgReviewQueueStore } = await import('./pg-review-queue.js');
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PgWorksheetGenerationStore(pool);
    rq = new PgReviewQueueStore(pool);
    const user = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    const fam = await pool.query<{ id: string }>(`INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`, [user.rows[0]!.id]);
    const child = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'WS IT',7) RETURNING id`,
      [fam.rows[0]!.id],
    );
    childId = child.rows[0]!.id;
    // the FK target
    await pool.query(
      `INSERT INTO generation_specs
         (id, child_id, planner_version, target_selector_version, curriculum_revision,
          curriculum_content_hash, twin_version, gap_snapshot_version, school_grade,
          parent_goal, session_goal, total_questions, spec)
       VALUES ($1,$2,'p','t','r','h','tw','gs',7,'kha_gioi','lesson_practice',8,'{}'::jsonb)`,
      [specId, childId],
    );
  });

  afterAll(async () => {
    if (pool && childId) {
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = replica`);
        await client.query(`DELETE FROM review_queue WHERE generation_spec_id = $1`, [specId]);
        await client.query(`DELETE FROM child_profiles WHERE id = $1`, [childId]); // cascades runs/slots/attempts
      } finally {
        await client.query(`SET session_replication_role = origin`);
        client.release();
      }
      await pool.end();
    }
  });

  it('persists run + slots + attempts (append-only), rolls up, purges snapshots', async () => {
    const spec = { ...makeSpec(), generationSpecId: specId, childId: childId as never };
    const gen = createFaultInjectingGenerator({
      name: 'd', model: 'gpt-4.1-mini', role: 'default', scripts: {}, provider: 'openai', usage: { inputTokens: 500, outputTokens: 200 },
    });
    const result = await orchestrateWorksheet({
      spec, knowledgeBase: kb, referenceLibrary: lib,
      generators: { default: gen, highComplexity: gen },
      reviewQueue: rq, childRef: 'ws_it_ref',
    });
    const bundle = toWorksheetRecords(spec, result, { runId, childRef: 'ws_it_ref', mode: 'SHADOW' });
    await store.putRun(bundle);
    await expect(store.putRun(bundle)).rejects.toThrow(); // append-only (PK)

    const back = await store.getRun(runId);
    expect(back?.generationSpecId).toBe(specId);
    expect((await store.listSlots(runId)).length).toBe(bundle.slots.length);
    expect((await store.listAttempts(runId)).length).toBe(bundle.attempts.length);

    const { shadowRollup, purgeReviewSnapshots } = await import('./worksheet-read-model.js');
    const roll = await shadowRollup(pool);
    expect(roll.runs).toBeGreaterThanOrEqual(1);

    // usage events map + carry the spec id
    const events = worksheetTraceToUsageEvents(result.trace, { userRef: 'u', childRef: 'ws_it_ref', plan: 'plus' });
    expect(events.every((e) => e.generationSpecId === specId)).toBe(true);

    // a review row for the Group-C PENDING_CROSSCHECK slot (no adapter) is NOT
    // created (only crosscheck-UNCERTAIN / FAILED raise rows). Force one:
    const item = await rq.create({ generationSpecId: specId, itemId: 'x', reason: 'BOTH_MODELS_FAILED', detail: 'd', promptSnapshot: 'P', workedSolutionSnapshot: 'S' });
    expect((await rq.listPending()).some((p) => p.id === item.id)).toBe(true);
    const purged = await purgeReviewSnapshots(pool, 0);
    expect(purged).toBeGreaterThanOrEqual(1);
    expect((await rq.get(item.id))?.promptSnapshot).toBeNull();
    await rq.resolve(item.id, 'REGENERATE_REQUESTED', 'reviewer_it');
    await expect(rq.resolve(item.id, 'APPROVED', 'x')).rejects.toThrow();
  });
});
