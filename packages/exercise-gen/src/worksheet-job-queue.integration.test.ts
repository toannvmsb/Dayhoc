import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { PgWorksheetJobQueue, WorksheetJobWorker } from './worksheet-job-queue.js';
import { PgWorksheetGenerationStore } from './pg-worksheet-persistence.js';
import { createMockItemContentGenerator } from './mock-item-generator.js';
import { makeSpec } from './_spec-fixture.js';
import type { ExerciseGenerationSpec } from '@copilot/domain';

/**
 * doc 67 §D2 — durable worksheet job queue. Restart recovery, idempotency,
 * lease-steal, bounded retry — all against real Postgres, no paid AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('doc 67 §D2 — durable worksheet job queue', () => {
  let pool: import('pg').Pool;
  const kb = loadKnowledgeBase();
  const lib = loadReferenceLibrary();

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL });
  });
  afterAll(async () => {
    if (pool) await pool.end();
  });
  afterEach(async () => {
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM worksheet_jobs WHERE generation_spec_id LIKE 'jobq-%'`);
      await c.query(
        `DELETE FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE generation_spec_id LIKE 'jobq-%')`,
      );
      await c.query(`DELETE FROM worksheet_slots WHERE run_id IN (SELECT id FROM worksheet_generation_runs WHERE generation_spec_id LIKE 'jobq-%')`);
      await c.query(`DELETE FROM worksheet_generation_runs WHERE generation_spec_id LIKE 'jobq-%'`);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
  });

  const spec = (n: number): ExerciseGenerationSpec => makeSpec({ generationSpecId: `jobq-${n}` });

  const mkWorker = (workerId: string, onRun?: () => void) =>
    new WorksheetJobWorker({
      pool,
      workerId,
      knowledgeBase: kb,
      referenceLibrary: lib,
      leaseMs: 5_000,
      backoffMs: 0, // tests drain synchronously; backoff matters only in start()
      buildDeps: () => {
        onRun?.();
        const gen = createMockItemContentGenerator();
        return { generators: { default: gen, highComplexity: gen }, store: new PgWorksheetGenerationStore(pool) };
      },
    });

  it('idempotent enqueue: the same spec+mode enqueues once', async () => {
    const q = new PgWorksheetJobQueue(pool);
    const a = await q.enqueueDurable({ mode: 'SHADOW', spec: spec(1) });
    const b = await q.enqueueDurable({ mode: 'SHADOW', spec: spec(1) });
    expect(a).toBeTruthy();
    expect(b).toBeNull(); // dedup no-op
    expect((await q.stats()).PENDING).toBe(1);
  });

  it('restart recovery: a fresh worker finishes jobs a crashed worker abandoned; nothing runs twice', async () => {
    const q = new PgWorksheetJobQueue(pool);
    for (let i = 10; i < 16; i += 1) await q.enqueueDurable({ mode: 'SHADOW', spec: spec(i) });

    // "worker A" crashes mid-run: 2 rows stuck CLAIMED with an already-expired lease
    await pool.query(
      `UPDATE worksheet_jobs
          SET state='CLAIMED', claimed_by='workerA', claimed_at=now() - interval '1 hour',
              lease_expires_at = now() - interval '30 minutes', attempts = 1
        WHERE id IN (SELECT id FROM worksheet_jobs WHERE generation_spec_id LIKE 'jobq-%' ORDER BY id LIMIT 2)`,
    );

    let runs = 0;
    const processed = await mkWorker('workerB', () => (runs += 1)).runToIdle();

    const stats = await q.stats();
    expect(stats.DONE).toBe(6);
    expect(stats.PENDING).toBe(0);
    expect(stats.CLAIMED).toBe(0);
    expect(processed).toBe(6);

    // exactly one worksheet_generation_runs row per spec — no double processing
    const perSpec = await pool.query<{ n: string }>(
      `SELECT generation_spec_id, count(*)::int n FROM worksheet_generation_runs
        WHERE generation_spec_id LIKE 'jobq-1%' GROUP BY generation_spec_id`,
    );
    expect(perSpec.rows.length).toBe(6);
    for (const r of perSpec.rows) expect(Number(r.n)).toBe(1);
  });

  it('lease-steal: two workers never process the same job concurrently', async () => {
    const q = new PgWorksheetJobQueue(pool);
    for (let i = 20; i < 28; i += 1) await q.enqueueDurable({ mode: 'SHADOW', spec: spec(i) });

    const [a, b] = await Promise.all([mkWorker('wA').runToIdle(), mkWorker('wB').runToIdle()]);
    expect(a + b).toBeGreaterThanOrEqual(8); // every job processed at least once between them

    expect((await q.stats()).DONE).toBe(8);
    const runs = await pool.query<{ n: string }>(
      `SELECT count(*)::int n FROM worksheet_generation_runs WHERE generation_spec_id LIKE 'jobq-2%'`,
    );
    expect(Number(runs.rows[0]!.n)).toBe(8); // one run per job, not more
  });

  it('bounded retry: a job that always no-runs ends FAILED after max_attempts, not looping', async () => {
    const q = new PgWorksheetJobQueue(pool);
    // OFF mode → runWorksheetShadow returns {ran:false} every time → retryable no-run
    await q.enqueueDurable({ mode: 'OFF', spec: spec(30) });
    await pool.query(`UPDATE worksheet_jobs SET max_attempts=2 WHERE generation_spec_id='jobq-30'`);

    const processed = await mkWorker('wRetry').runToIdle(50);
    expect(processed).toBeLessThanOrEqual(3); // 2 attempts + a final idle poll, not infinite
    const row = await pool.query<{ state: string; attempts: number }>(
      `SELECT state, attempts FROM worksheet_jobs WHERE generation_spec_id='jobq-30'`,
    );
    expect(row.rows[0]!.state).toBe('FAILED');
    expect(row.rows[0]!.attempts).toBe(2);
  });
});
