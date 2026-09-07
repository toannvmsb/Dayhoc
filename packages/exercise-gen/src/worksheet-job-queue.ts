import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { AiGenerationMode, ExerciseGenerationSpec } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ReferenceExample } from '@copilot/reference-library';
import type { AiUsageEvent } from '@copilot/ai';
import type { ItemContentGenerator } from './item-generator.js';
import type { AnswerCrosscheckAdapter } from './answer-crosscheck.js';
import type { ReviewQueueStore } from './review-queue.js';
import type { WorksheetGenerationStore } from './worksheet-persistence.js';
import type { WorksheetUsageContext } from './worksheet-telemetry.js';
import type { DailyCostGuard } from './worksheet-guardrails.js';
import type { WorksheetOrchestratorConfig } from './worksheet-orchestrator.js';
import {
  runWorksheetShadow,
  type WorksheetShadowJob,
  type WorksheetShadowOutcome,
  type WorksheetShadowQueue,
} from './worksheet-shadow.js';

export const WORKSHEET_JOB_QUEUE_VERSION = 'worksheet-job-queue.v1';

/** the SERIALIZABLE slice of a shadow job — everything that survives a restart. */
export interface WorksheetJobRecord {
  readonly mode: AiGenerationMode;
  readonly spec: ExerciseGenerationSpec;
  readonly childRef?: string | null;
  readonly usageContext?: WorksheetUsageContext | null;
  readonly config?: Partial<WorksheetOrchestratorConfig> | null;
}

export interface WorksheetJobRow {
  readonly id: string;
  readonly dedupKey: string;
  readonly mode: AiGenerationMode;
  readonly generationSpecId: string;
  readonly childRef: string | null;
  readonly spec: ExerciseGenerationSpec;
  readonly usageContext: WorksheetUsageContext | null;
  readonly config: Partial<WorksheetOrchestratorConfig> | null;
  readonly state: 'PENDING' | 'CLAIMED' | 'DONE' | 'FAILED';
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly runId: string | null;
  readonly lastError: string | null;
}

/**
 * Idempotency key — one job per (generation spec, mode). The planner mints a
 * fresh `generationSpecId` for a genuinely new plan, so a new plan gets a new
 * job while a parent re-opening `getToday` many times a day does not.
 */
export function worksheetJobDedupKey(mode: string, generationSpecId: string): string {
  return createHash('sha256').update(`${mode}::${generationSpecId}`).digest('hex').slice(0, 32);
}

function rowToJob(r: Record<string, unknown>): WorksheetJobRow {
  return {
    id: String(r.id),
    dedupKey: String(r.dedup_key),
    mode: r.mode as AiGenerationMode,
    generationSpecId: String(r.generation_spec_id),
    childRef: (r.child_ref as string | null) ?? null,
    spec: r.spec as ExerciseGenerationSpec,
    usageContext: (r.usage_context as WorksheetUsageContext | null) ?? null,
    config: (r.config as Partial<WorksheetOrchestratorConfig> | null) ?? null,
    state: r.state as WorksheetJobRow['state'],
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    runId: (r.run_id as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
  };
}

/**
 * Durable Postgres-backed queue. `enqueue` persists ONLY the serializable slice
 * (spec + mode + refs + config); the non-serializable deps on `WorksheetShadowJob`
 * (generators, KB, adapters, stores, sinks) are ignored here and rebuilt by the
 * worker. `ON CONFLICT (dedup_key) DO NOTHING` makes re-enqueue a no-op.
 */
export class PgWorksheetJobQueue implements WorksheetShadowQueue {
  readonly #pool: Pool;
  readonly #newId: () => string;

  constructor(pool: Pool, opts: { newId?: () => string } = {}) {
    this.#pool = pool;
    this.#newId = opts.newId ?? (() => `wjob_${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 20)}`);
  }

  /** WorksheetShadowQueue — fire-and-forget. Persists, never throws to the caller. */
  enqueue(mode: AiGenerationMode, job: WorksheetShadowJob): void {
    void this.enqueueDurable({
      mode,
      spec: job.spec,
      childRef: job.childRef ?? null,
      usageContext: job.usageContext ?? null,
      config: job.config ?? null,
    }).catch(() => undefined);
  }

  /** explicit, awaitable form — returns the job id, or null if it was a dedup no-op. */
  async enqueueDurable(rec: WorksheetJobRecord): Promise<string | null> {
    const id = this.#newId();
    const dedupKey = worksheetJobDedupKey(rec.mode, rec.spec.generationSpecId);
    const res = await this.#pool.query<{ id: string }>(
      `INSERT INTO worksheet_jobs (id, dedup_key, mode, generation_spec_id, child_ref, spec, usage_context, config)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      [
        id,
        dedupKey,
        rec.mode,
        rec.spec.generationSpecId,
        rec.childRef,
        JSON.stringify(rec.spec),
        rec.usageContext ? JSON.stringify(rec.usageContext) : null,
        rec.config ? JSON.stringify(rec.config) : null,
      ],
    );
    return res.rows[0]?.id ?? null;
  }

  async stats(): Promise<Record<WorksheetJobRow['state'], number>> {
    const res = await this.#pool.query<{ state: string; n: string }>(
      `SELECT state, count(*)::int n FROM worksheet_jobs GROUP BY state`,
    );
    const out: Record<string, number> = { PENDING: 0, CLAIMED: 0, DONE: 0, FAILED: 0 };
    for (const r of res.rows) out[r.state] = Number(r.n);
    return out as Record<WorksheetJobRow['state'], number>;
  }
}

/** deps a worker rebuilds per claimed job (never serialized). */
export interface WorksheetJobDeps {
  readonly generators: { readonly default: ItemContentGenerator; readonly highComplexity: ItemContentGenerator };
  readonly crosscheckAdapter?: AnswerCrosscheckAdapter;
  readonly reviewQueue?: ReviewQueueStore;
  readonly store?: WorksheetGenerationStore;
  readonly usageSink?: (event: AiUsageEvent) => void;
  readonly costGuard?: DailyCostGuard;
}

export interface WorksheetJobWorkerOptions {
  readonly pool: Pool;
  readonly workerId: string;
  readonly knowledgeBase: KnowledgeBase;
  readonly referenceLibrary: readonly ReferenceExample[];
  /** rebuild the non-serializable deps for a claimed job. */
  readonly buildDeps: (row: WorksheetJobRow) => WorksheetJobDeps;
  /** how long a CLAIMED job is owned before another worker may steal it. */
  readonly leaseMs?: number;
  /** backoff before a re-queued (retryable) job becomes claimable again. */
  readonly backoffMs?: number;
  /** poll interval for `start()`. */
  readonly pollMs?: number;
  readonly now?: () => Date;
  readonly onOutcome?: (row: WorksheetJobRow, outcome: WorksheetShadowOutcome | { ran: false; reason: string }) => void;
}

/** privacy-safe error category — never content. */
function errorCategory(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|network/i.test(msg)) return 'NETWORK';
  if (/timeout/i.test(msg)) return 'TIMEOUT';
  if (/schema|validation|zod/i.test(msg)) return 'SCHEMA';
  if (/cost|budget|cap/i.test(msg)) return 'COST_CAP';
  return 'OTHER';
}

/**
 * A single-loop worker. Claims one job at a time with `FOR UPDATE SKIP LOCKED`,
 * runs the SHADOW orchestrator, and moves the job to DONE / FAILED / back to
 * PENDING (bounded retry with backoff). A crashed worker's CLAIMED job is
 * reclaimed once its lease expires — nothing is lost or double-served (the
 * orchestrator writes a fresh `worksheet_generation_runs` row per successful
 * run, and a job only reaches DONE once).
 */
export class WorksheetJobWorker {
  readonly #o: Required<Omit<WorksheetJobWorkerOptions, 'onOutcome'>> & Pick<WorksheetJobWorkerOptions, 'onOutcome'>;
  #running = false;
  #stopReq = false;

  constructor(o: WorksheetJobWorkerOptions) {
    this.#o = {
      leaseMs: 120_000,
      backoffMs: 30_000,
      pollMs: 1_000,
      now: () => new Date(),
      ...o,
    };
  }

  /** claim + process one job. Returns 'idle' when nothing is claimable. */
  async processOne(): Promise<'processed' | 'idle'> {
    const claimed = await this.#claim();
    if (!claimed) return 'idle';

    // cost guard is per-process; if this worker is out of budget, release the
    // job (no attempt consumed) with a longer backoff for another worker / a
    // later day.
    const deps = this.#o.buildDeps(claimed);
    if (deps.costGuard && !deps.costGuard.canRun().ok) {
      await this.#release(claimed, 'COST_CAP', this.#o.backoffMs * 10, /* consumeAttempt */ false);
      this.#o.onOutcome?.(claimed, { ran: false, reason: 'worker out of daily budget' });
      return 'processed';
    }

    let outcome: WorksheetShadowOutcome;
    try {
      const shadowJob: WorksheetShadowJob = {
        spec: claimed.spec,
        knowledgeBase: this.#o.knowledgeBase,
        referenceLibrary: this.#o.referenceLibrary,
        generators: deps.generators,
        ...(deps.crosscheckAdapter ? { crosscheckAdapter: deps.crosscheckAdapter } : {}),
        ...(deps.reviewQueue ? { reviewQueue: deps.reviewQueue } : {}),
        ...(deps.store ? { store: deps.store } : {}),
        ...(deps.usageSink ? { usageSink: deps.usageSink } : {}),
        ...(deps.costGuard ? { costGuard: deps.costGuard } : {}),
        ...(claimed.usageContext ? { usageContext: claimed.usageContext } : {}),
        childRef: claimed.childRef,
        ...(claimed.config ? { config: claimed.config } : {}),
        now: this.#o.now,
      };
      outcome = await runWorksheetShadow(claimed.mode, shadowJob);
    } catch (e) {
      await this.#fail(claimed, errorCategory(e));
      this.#o.onOutcome?.(claimed, { ran: false, reason: errorCategory(e) });
      return 'processed';
    }

    if (outcome.ran) {
      await this.#o.pool.query(
        `UPDATE worksheet_jobs SET state='DONE', run_id=$2, last_error=NULL, updated_at=now() WHERE id=$1`,
        [claimed.id, outcome.runId],
      );
    } else {
      // a shadow no-run (cost cap, OFF/LIVE treated-as-OFF) — retryable
      await this.#fail(claimed, `NO_RUN:${outcome.reason}`.slice(0, 120));
    }
    this.#o.onOutcome?.(claimed, outcome);
    return 'processed';
  }

  async #claim(): Promise<WorksheetJobRow | null> {
    const leaseS = Math.ceil(this.#o.leaseMs / 1000);
    const res = await this.#o.pool.query(
      `UPDATE worksheet_jobs j
         SET state='CLAIMED', claimed_by=$1, claimed_at=now(),
             lease_expires_at = now() + ($2 || ' seconds')::interval,
             attempts = attempts + 1, updated_at = now()
       WHERE j.id = (
         SELECT id FROM worksheet_jobs
          WHERE (state='PENDING' AND available_at <= now())
             OR (state='CLAIMED' AND lease_expires_at < now())
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       RETURNING *`,
      [this.#o.workerId, String(leaseS)],
    );
    return res.rows[0] ? rowToJob(res.rows[0]) : null;
  }

  async #fail(row: WorksheetJobRow, category: string): Promise<void> {
    // `attempts` was already incremented at claim time.
    if (row.attempts >= row.maxAttempts) {
      await this.#o.pool.query(
        `UPDATE worksheet_jobs SET state='FAILED', last_error=$2, updated_at=now() WHERE id=$1`,
        [row.id, category],
      );
    } else {
      await this.#release(row, category, this.#o.backoffMs, true);
    }
  }

  async #release(row: WorksheetJobRow, category: string, backoffMs: number, consumeAttempt: boolean): Promise<void> {
    await this.#o.pool.query(
      `UPDATE worksheet_jobs
          SET state='PENDING', claimed_by=NULL, claimed_at=NULL, lease_expires_at=NULL,
              available_at = now() + ($2 || ' milliseconds')::interval,
              attempts = attempts - $3,
              last_error = $4, updated_at = now()
        WHERE id = $1`,
      [row.id, String(Math.max(0, backoffMs)), consumeAttempt ? 0 : 1, category],
    );
  }

  /** run the poll loop until `stop()`. */
  async start(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    this.#stopReq = false;
    while (!this.#stopReq) {
      let did: 'processed' | 'idle' = 'idle';
      try {
        did = await this.processOne();
      } catch {
        did = 'idle';
      }
      if (did === 'idle') await new Promise((r) => setTimeout(r, this.#o.pollMs));
    }
    this.#running = false;
  }

  stop(): void {
    this.#stopReq = true;
  }

  /** drain every currently-claimable job (tests / one-shot workers). */
  async runToIdle(maxIterations = 10_000): Promise<number> {
    let n = 0;
    for (let i = 0; i < maxIterations; i += 1) {
      if ((await this.processOne()) === 'idle') break;
      n += 1;
    }
    return n;
  }
}
