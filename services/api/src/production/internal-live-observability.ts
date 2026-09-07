import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { shadowRollup, reviewQueueRollup, failureBreakdown } from '@copilot/exercise-gen';
import {
  loadInternalLiveBudgets,
  internalLiveSpendToday,
  resolveKillSwitch,
  type KillSwitchState,
} from './internal-live.js';

const row1 = <T>(r: { rows: T[] }): T => r.rows[0]!;

/**
 * CONTROLLED INTERNAL LIVE — privacy-safe read models (doc 69 §7/§10). No child
 * question / answer / evidence content in any of these. Only pseudonymous refs,
 * states, counts, categories, latency, cost.
 */

// ---------------------------------------------------------------------------
// review-queue operations (doc 69 §10)
// ---------------------------------------------------------------------------

export interface ReviewQueueOps {
  readonly pending: number;
  readonly resolved: number;
  readonly total: number;
  readonly pendingByReason: Readonly<Record<string, number>>;
  readonly resolvedByDecision: Readonly<Record<string, number>>;
  /** age of the OLDEST pending item, hours. */
  readonly oldestPendingAgeHours: number;
  readonly medianPendingAgeHours: number;
  /** median PENDING→resolved time over the last window, hours. */
  readonly medianResolutionHours: number;
}

export async function reviewQueueOps(pool: Pool, sinceIso?: string): Promise<ReviewQueueOps> {
  const since = sinceIso ?? '1970-01-01T00:00:00Z';
  const base = await reviewQueueRollup(pool);
  const pending = Object.values(base.pendingByReason).reduce((a, b) => a + b, 0);
  const resolved = Object.values(base.resolvedByState).reduce((a, b) => a + b, 0);

  const ages = row1(await pool.query<{ oldest_h: string | null; median_h: string | null }>(
    `SELECT
       extract(epoch FROM (now() - min(created_at))) / 3600 oldest_h,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (now() - created_at)) / 3600) median_h
     FROM review_queue WHERE state = 'PENDING'`,
  ));
  const res = row1(await pool.query<{ median_h: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_at - created_at)) / 3600) median_h
       FROM review_queue WHERE resolved_at IS NOT NULL AND created_at >= $1`,
    [since],
  ));

  return {
    pending,
    resolved,
    total: base.total,
    pendingByReason: base.pendingByReason,
    resolvedByDecision: base.resolvedByState,
    oldestPendingAgeHours: Number(ages.oldest_h ?? 0),
    medianPendingAgeHours: Number(ages.median_h ?? 0),
    medianResolutionHours: Number(res.median_h ?? 0),
  };
}

// ---------------------------------------------------------------------------
// product funnel (doc 69 §7) — derived from the assignments/attempts tables,
// aggregate counts only (no per-child rows leave this function).
// ---------------------------------------------------------------------------

export interface ProductFunnel {
  readonly aiWorksheetRuns: number;
  readonly aiAssignmentsCreated: number; // practice_started (AI source)
  readonly aiAssignmentsCompleted: number; // practice_completed (AI source)
  readonly worksheetToPracticeConversion: number; // assignments created / worksheet runs
  readonly practiceCompletionRate: number; // completed / created
  /** children with an attempt on two consecutive UTC days in the window. */
  readonly day1ReturnChildren: number;
  readonly activeChildren: number;
}

export async function productFunnel(pool: Pool, sinceIso?: string): Promise<ProductFunnel> {
  const since = sinceIso ?? new Date(Date.now() - 30 * 86_400_000).toISOString();

  const ws = row1(await pool.query<{ n: string }>(
    `SELECT count(*)::int n FROM worksheet_generation_runs WHERE mode = 'LIVE' AND created_at >= $1`,
    [since],
  ));
  const asg = row1(await pool.query<{ created: string; completed: string }>(
    `SELECT
       count(*) FILTER (WHERE source = 'AI_GENERATED') created,
       count(*) FILTER (WHERE source = 'AI_GENERATED' AND status = 'COMPLETED') completed
     FROM assignments WHERE created_at >= $1`,
    [since],
  ));
  const ret = row1(await pool.query<{ returned: string; active: string }>(
    `WITH days AS (
       SELECT child_id, date_trunc('day', started_at) d
       FROM attempts WHERE started_at >= $1 GROUP BY child_id, date_trunc('day', started_at)
     )
     SELECT
       count(DISTINCT a.child_id) returned,
       (SELECT count(DISTINCT child_id) FROM days) active
     FROM days a JOIN days b ON a.child_id = b.child_id AND b.d = a.d + interval '1 day'`,
    [since],
  ));

  const runs = Number(ws.n);
  const created = Number(asg.created);
  const completed = Number(asg.completed);
  return {
    aiWorksheetRuns: runs,
    aiAssignmentsCreated: created,
    aiAssignmentsCompleted: completed,
    worksheetToPracticeConversion: runs > 0 ? created / runs : 0,
    practiceCompletionRate: created > 0 ? completed / created : 0,
    day1ReturnChildren: Number(ret.returned ?? 0),
    activeChildren: Number(ret.active ?? 0),
  };
}

// ---------------------------------------------------------------------------
// combined INTERNAL LIVE dashboard read model
// ---------------------------------------------------------------------------

export interface InternalLiveDashboard {
  readonly windowSinceIso: string;
  readonly killSwitch: KillSwitchState;
  readonly cohortSize: number;
  readonly worksheet: {
    readonly runs: number;
    readonly coreWorksheetDeliveryRate: number;
    readonly verifiedDeliveryRate: number; // delivered items backed by deterministic OR crosscheck-PASS
    readonly unsafeDeliveryRate: number;
    readonly readySlots: number;
    readonly substitutedSlots: number;
    readonly omittedSlots: number;
    readonly firstPassRate: number;
    readonly retryRate: number;
    readonly fallbackRate: number;
    readonly lastResortRate: number;
    readonly crosscheckRate: number;
    readonly reviewQueueRate: number;
    readonly costPerWorksheetUsd: number;
    readonly p50WorksheetLatencyMs: number;
    readonly p95WorksheetLatencyMs: number;
  };
  readonly budgets: {
    readonly genDailyCapUsd: number;
    readonly xcheckDailyCapUsd: number;
    readonly genSpentTodayUsd: number;
    readonly xcheckSpentTodayUsd: number;
    readonly genRemainingUsd: number;
    readonly xcheckRemainingUsd: number;
  };
  readonly review: ReviewQueueOps;
  readonly funnel: ProductFunnel;
  readonly failureBreakdown: readonly { failureCategory: string; count: number }[];
}

export async function internalLiveDashboard(pool: Pool, opts: { sinceIso?: string } = {}): Promise<InternalLiveDashboard> {
  const since = opts.sinceIso ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const roll = await shadowRollup(pool, since, 'LIVE');

  const v = row1(await pool.query<{ delivered: string; verified: string; unsafe: string }>(
    `WITH r AS (SELECT id FROM worksheet_generation_runs WHERE mode = 'LIVE' AND created_at >= $1),
          s AS (SELECT sl.* FROM worksheet_slots sl JOIN r ON r.id = sl.run_id WHERE sl.final_state = 'READY')
     SELECT count(*) delivered,
            count(*) FILTER (WHERE answer_status = 'DETERMINISTIC_CORRECT' OR crosscheck_verdict = 'PASS') verified,
            count(*) FILTER (WHERE NOT (answer_status = 'DETERMINISTIC_CORRECT' OR crosscheck_verdict = 'PASS')) unsafe
       FROM s`,
    [since],
  ));
  const delivered = Number(v.delivered) || 1;

  const paths = row1(await pool.query<{
    first: string; retry: string; fallback: string; last_resort: string; crosscheck: string; total: string;
  }>(
    `WITH r AS (SELECT id FROM worksheet_generation_runs WHERE mode = 'LIVE' AND created_at >= $1),
          s AS (SELECT sl.* FROM worksheet_slots sl JOIN r ON r.id = sl.run_id),
          a AS (SELECT run_id, item_id, count(*) c, bool_or(step = 'escalate' AND accepted) esc,
                       bool_or(step = 'last_resort' AND accepted) lr
                FROM worksheet_slot_attempts WHERE run_id IN (SELECT id FROM r) GROUP BY run_id, item_id)
     SELECT
       count(*) FILTER (WHERE s.final_state='READY' AND NOT s.substituted AND NOT coalesce(a.esc,false) AND NOT s.last_resort_used AND NOT (s.crosscheck_required AND s.crosscheck_verdict='PASS') AND coalesce(a.c,1)<=1) first,
       count(*) FILTER (WHERE s.final_state='READY' AND coalesce(a.c,1)>1 AND NOT coalesce(a.esc,false) AND NOT s.last_resort_used AND NOT s.substituted) retry,
       count(*) FILTER (WHERE s.final_state='READY' AND coalesce(a.esc,false) AND NOT s.last_resort_used AND NOT s.substituted) fallback,
       count(*) FILTER (WHERE s.final_state='READY' AND s.last_resort_used) last_resort,
       count(*) FILTER (WHERE s.final_state='READY' AND s.crosscheck_required AND s.crosscheck_verdict='PASS' AND NOT s.last_resort_used AND NOT s.substituted) crosscheck,
       count(*) total
     FROM s LEFT JOIN a ON a.run_id = s.run_id AND a.item_id = s.item_id`,
    [since],
  ));
  const totalSlots = Number(paths.total) || 1;

  const budgets = loadInternalLiveBudgets();
  const spend = await internalLiveSpendToday(pool);
  const review = await reviewQueueOps(pool, since);
  const funnel = await productFunnel(pool, since);
  const killSwitch = await resolveKillSwitch(pool);
  const c = row1(await pool.query<{ n: string }>(`SELECT count(*)::int n FROM internal_live_cohort WHERE removed_at IS NULL`));
  const failures = await failureBreakdown(pool, since);

  return {
    windowSinceIso: since,
    killSwitch,
    cohortSize: Number(c.n),
    worksheet: {
      runs: roll.runs,
      coreWorksheetDeliveryRate: roll.coreWorksheetDeliveryRate,
      verifiedDeliveryRate: Number(v.verified) / delivered,
      unsafeDeliveryRate: Number(v.unsafe) / delivered,
      readySlots: roll.readySlots,
      substitutedSlots: roll.substitutedSlots,
      omittedSlots: roll.omittedSlots,
      firstPassRate: Number(paths.first) / totalSlots,
      retryRate: Number(paths.retry) / totalSlots,
      fallbackRate: Number(paths.fallback) / totalSlots,
      lastResortRate: Number(paths.last_resort) / totalSlots,
      crosscheckRate: Number(paths.crosscheck) / totalSlots,
      reviewQueueRate: totalSlots ? review.pending / totalSlots : 0,
      costPerWorksheetUsd: roll.costPerCompletedWorksheetUsd,
      p50WorksheetLatencyMs: roll.p50WorksheetLatencyMs,
      p95WorksheetLatencyMs: roll.p95WorksheetLatencyMs,
    },
    budgets: {
      genDailyCapUsd: budgets.genDailyCapUsd,
      xcheckDailyCapUsd: budgets.xcheckDailyCapUsd,
      genSpentTodayUsd: spend.generation,
      xcheckSpentTodayUsd: spend.crosscheck,
      genRemainingUsd: Math.max(0, budgets.genDailyCapUsd - spend.generation),
      xcheckRemainingUsd: Math.max(0, budgets.xcheckDailyCapUsd - spend.crosscheck),
    },
    review,
    funnel,
    failureBreakdown: failures.map((f) => ({ failureCategory: f.failureCategory, count: f.count })),
  };
}

// ---------------------------------------------------------------------------
// Wave-1 QA sampling (doc 69 §8) — gated, SHORT-RETENTION, access-logged, not analytics
// ---------------------------------------------------------------------------

export interface QaSampleInput {
  readonly runId: string;
  readonly generationSpecId: string;
  readonly childRef: string | null;
  readonly itemId: string;
  readonly criticality: string | null;
  readonly finalState: string | null;
  readonly promptSnapshot: string | null;
  readonly workedSolutionSnapshot: string | null;
  readonly answerSnapshot: string | null;
}

/** default QA retention — SHORT (doc 69 §8). Overridable via env, capped at 30d. */
export function qaRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.INTERNAL_LIVE_QA_RETENTION_DAYS ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 30) : 7;
}

/** 1-in-N sampling rate for delivered worksheets (doc 69 §8). 0 disables. */
export function qaSampleRate(env: Record<string, string | undefined> = process.env): number {
  const n = Number.parseInt(env.INTERNAL_LIVE_QA_SAMPLE_ONE_IN ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

export async function captureQaSamples(
  pool: Pool,
  samples: readonly QaSampleInput[],
  env: Record<string, string | undefined> = process.env,
): Promise<number> {
  if (samples.length === 0) return 0;
  const retentionMs = qaRetentionDays(env) * 86_400_000;
  const until = new Date(Date.now() + retentionMs).toISOString();
  let n = 0;
  for (const s of samples) {
    await pool.query(
      `INSERT INTO internal_live_qa_sample
         (id, run_id, generation_spec_id, child_ref, item_id, criticality, final_state,
          prompt_snapshot, worked_solution_snapshot, answer_snapshot, retention_until)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        randomUUID(), s.runId, s.generationSpecId, s.childRef, s.itemId, s.criticality, s.finalState,
        s.promptSnapshot, s.workedSolutionSnapshot, s.answerSnapshot, until,
      ],
    ).catch(() => undefined);
    n += 1;
  }
  return n;
}

export interface QaSampleRow {
  readonly id: string;
  readonly generationSpecId: string;
  readonly itemId: string;
  readonly criticality: string | null;
  readonly finalState: string | null;
  readonly promptSnapshot: string | null;
  readonly workedSolutionSnapshot: string | null;
  readonly answerSnapshot: string | null;
  readonly sampledAt: string;
  readonly retentionUntil: string;
}

/** Access-logged read of ONE QA sample (doc 69 §8). Records who opened it. */
export async function readQaSample(pool: Pool, id: string, reviewerRef: string): Promise<QaSampleRow | null> {
  const { rows } = await pool.query<{
    id: string; generation_spec_id: string; item_id: string; criticality: string | null; final_state: string | null;
    prompt_snapshot: string | null; worked_solution_snapshot: string | null; answer_snapshot: string | null;
    sampled_at: string; retention_until: string; purged: boolean;
  }>(`SELECT * FROM internal_live_qa_sample WHERE id = $1`, [id]);
  const r = rows[0];
  if (!r || r.purged) return null;
  await pool.query(
    `UPDATE internal_live_qa_sample
        SET access_log = access_log || jsonb_build_object('ref', $2::text, 'at', now())
      WHERE id = $1`,
    [id, reviewerRef],
  ).catch(() => undefined);
  return {
    id: r.id,
    generationSpecId: r.generation_spec_id,
    itemId: r.item_id,
    criticality: r.criticality,
    finalState: r.final_state,
    promptSnapshot: r.prompt_snapshot,
    workedSolutionSnapshot: r.worked_solution_snapshot,
    answerSnapshot: r.answer_snapshot,
    sampledAt: r.sampled_at,
    retentionUntil: r.retention_until,
  };
}

export async function listQaSamples(pool: Pool, limit = 50): Promise<readonly Omit<QaSampleRow, 'promptSnapshot' | 'workedSolutionSnapshot' | 'answerSnapshot'>[]> {
  const { rows } = await pool.query<{
    id: string; generation_spec_id: string; item_id: string; criticality: string | null; final_state: string | null;
    sampled_at: string; retention_until: string;
  }>(
    `SELECT id, generation_spec_id, item_id, criticality, final_state, sampled_at, retention_until
       FROM internal_live_qa_sample WHERE purged = false ORDER BY sampled_at DESC LIMIT $1`,
    [Math.min(limit, 200)],
  );
  return rows.map((r) => ({
    id: r.id,
    generationSpecId: r.generation_spec_id,
    itemId: r.item_id,
    criticality: r.criticality,
    finalState: r.final_state,
    sampledAt: r.sampled_at,
    retentionUntil: r.retention_until,
  }));
}

/** Purge QA snapshots past their retention (doc 69 §8). Nulls the content, keeps
 *  the operational row (id, ids, states) marked purged. Returns rows touched. */
export async function purgeExpiredQaSamples(pool: Pool): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE internal_live_qa_sample
        SET prompt_snapshot = NULL, worked_solution_snapshot = NULL, answer_snapshot = NULL, purged = true
      WHERE purged = false AND retention_until < now()`,
  );
  return rowCount ?? 0;
}
