/**
 * DẠYZI — durable worksheet generation worker (doc 69 §5 / doc 70 §2).
 *
 * A LIVE / pilot deployment MUST NOT rely on the in-process queue: run one (or a
 * few) of these as a long-lived process next to the API. It claims jobs from
 * `worksheet_jobs` with `FOR UPDATE SKIP LOCKED`, generates against the SAME
 * locked routing + budget gates as the in-process path, and on each completed
 * run records the LIVE serving intent + operational spend.
 *
 *   node services/api/dist/bin/worksheet-worker.js
 *
 * Env: DATABASE_URL, OPENAI_API_KEY, AI_GENERATION_MODE=LIVE,
 *      AI_CROSSCHECK_MODE=LIVE, WORKSHEET_QUEUE=durable,
 *      INTERNAL_LIVE_GEN_DAILY_CAP_USD, INTERNAL_LIVE_XCHECK_DAILY_CAP_USD.
 *
 * Exits non-zero if the config would make the worker a no-op (OFF / no key /
 * blocking) so a supervisor surfaces the misconfig instead of idling silently.
 */
import { Pool } from 'pg';
import { loadKnowledgeBase } from '@copilot/math-data';
import { createWorksheetJobWorker } from '../production/worksheet-generation.js';

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('[worksheet-worker] DATABASE_URL is not set');
    process.exit(2);
  }
  const pool = new Pool({
    connectionString,
    max: Number(process.env.WORKER_PG_MAX ?? 4),
    keepAlive: true,
    idleTimeoutMillis: 20_000,
  });
  pool.on('error', (e) => console.error('[worksheet-worker] pg pool error', e.message));

  const worker = createWorksheetJobWorker({
    pool,
    knowledgeBase: loadKnowledgeBase(),
    workerId: process.env.WORKER_ID ?? `wjw_${process.pid}`,
    ...(process.env.WORKER_POLL_MS ? { pollMs: Number(process.env.WORKER_POLL_MS) } : {}),
  });

  if (!worker) {
    console.error(
      '[worksheet-worker] refusing to start — AI_GENERATION_MODE is OFF, OPENAI_API_KEY is missing, ' +
        'or the staging config is blocking. Fix the env and redeploy.',
    );
    await pool.end();
    process.exit(3);
  }

  let stopping = false;
  const shutdown = async (sig: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    console.error(`[worksheet-worker] ${sig} — draining and stopping`);
    worker.stop();
    // give an in-flight job a moment to land, then close.
    await new Promise((r) => setTimeout(r, 2_000));
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.error(`[worksheet-worker] started (workerId=${process.env.WORKER_ID ?? `wjw_${process.pid}`})`);
  await worker.start(); // polls until stop()
}

void main().catch((e) => {
  console.error('[worksheet-worker] fatal', e);
  process.exit(1);
});
