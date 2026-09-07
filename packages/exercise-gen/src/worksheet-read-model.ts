import type { Pool } from 'pg';

/**
 * Read-only queries over the worksheet-orchestrator tables for a SHADOW
 * observability dashboard (doc 65 §D / doc 66 §1). Privacy-safe by
 * construction — the underlying tables carry no PII.
 */

export interface ShadowRollup {
  readonly runs: number;
  readonly worksheetsReady: number;
  /** @deprecated always 0 — pending crosscheck is no longer a delivered state (doc 68). */
  readonly worksheetsReadyWithPendingCrosscheck: number;
  readonly worksheetsReadyWithSafeSubstitution: number;
  readonly worksheetsReadyWithOptionalOmissions: number;
  readonly worksheetsFailed: number;
  /** @deprecated old "0 failed slots" metric — use `coreWorksheetDeliveryRate` (doc 68 §8). */
  readonly fullWorksheetCompletionRate: number;
  /** worksheets where every REQUIRED_CORE slot is READY (doc 68 §8). */
  readonly coreWorksheetDeliveryRate: number;
  readonly items: number;
  readonly readySlots: number;
  readonly pendingCrosscheckSlots: number;
  readonly failedSlots: number;
  readonly substitutedSlots: number;
  readonly omittedSlots: number;
  readonly deterministicProductionRate: number; // production_ready slots / kernel slots
  readonly kernelSlots: number;
  readonly avgRetriesPerItem: number;
  readonly fallbackCalls: number;
  readonly lastResortCalls: number;
  readonly totalActualCostUsd: number;
  readonly costPerCompletedWorksheetUsd: number;
  readonly p50WorksheetLatencyMs: number;
  readonly p95WorksheetLatencyMs: number;
  readonly costCeilingEvents: number;
}

export interface FailureBreakdownRow {
  readonly failureCategory: string;
  readonly count: number;
}

export interface ReviewQueueRollup {
  readonly pendingByReason: Record<string, number>;
  readonly resolvedByState: Record<string, number>;
  readonly total: number;
}

export async function shadowRollup(pool: Pool, sinceIso?: string, mode = 'SHADOW'): Promise<ShadowRollup> {
  const since = sinceIso ?? '1970-01-01T00:00:00Z';
  const { rows: [r] } = await pool.query(
    `WITH runs AS (
       SELECT * FROM worksheet_generation_runs WHERE mode = $2 AND created_at >= $1
     ), slots AS (
       SELECT s.* FROM worksheet_slots s JOIN runs ON runs.id = s.run_id
     )
     SELECT
       (SELECT count(*) FROM runs)                                              AS runs,
       (SELECT count(*) FROM runs WHERE worksheet_state = 'READY')              AS ws_ready,
       (SELECT count(*) FROM runs WHERE worksheet_state = 'READY_WITH_SAFE_SUBSTITUTION')  AS ws_ready_sub,
       (SELECT count(*) FROM runs WHERE worksheet_state = 'READY_WITH_OPTIONAL_OMISSIONS') AS ws_ready_omit,
       (SELECT count(*) FROM runs WHERE worksheet_state = 'FAILED')             AS ws_failed,
       (SELECT count(*) FROM runs WHERE worksheet_state <> 'FAILED')            AS ws_core_delivered,
       (SELECT coalesce(sum(substituted_slots),0) FROM runs)                    AS sub_slots,
       (SELECT coalesce(sum(omitted_slots),0) FROM runs)                        AS omit_slots,
       (SELECT count(*) FROM slots)                                             AS items,
       (SELECT count(*) FROM slots WHERE final_state = 'READY')                 AS ready_slots,
       (SELECT count(*) FROM slots WHERE final_state = 'FAILED')                AS failed_slots,
       (SELECT count(*) FROM slots WHERE kernel_family IS NOT NULL)             AS kernel_slots,
       (SELECT count(*) FROM slots WHERE kernel_family IS NOT NULL AND production_ready) AS kernel_prod,
       (SELECT coalesce(sum(retries),0) FROM runs)                             AS retries,
       (SELECT coalesce(sum(fallback_calls),0) FROM runs)                      AS fallback_calls,
       (SELECT coalesce(sum(last_resort_calls),0) FROM runs)                   AS last_resort_calls,
       (SELECT coalesce(sum(actual_cost_usd),0) FROM runs)                     AS cost,
       (SELECT count(*) FROM runs WHERE cost_ceiling_hit)                      AS ceiling_events,
       (SELECT coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY worksheet_latency_ms),0) FROM runs) AS p50,
       (SELECT coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY worksheet_latency_ms),0) FROM runs) AS p95`,
    [since, mode],
  );
  const runs = Number(r.runs);
  const items = Number(r.items);
  const kernelSlots = Number(r.kernel_slots);
  const wsCoreDelivered = Number(r.ws_core_delivered);
  const cost = Number(r.cost);
  return {
    runs,
    worksheetsReady: Number(r.ws_ready),
    worksheetsReadyWithPendingCrosscheck: 0,
    worksheetsReadyWithSafeSubstitution: Number(r.ws_ready_sub),
    worksheetsReadyWithOptionalOmissions: Number(r.ws_ready_omit),
    worksheetsFailed: Number(r.ws_failed),
    fullWorksheetCompletionRate: runs > 0 ? wsCoreDelivered / runs : 0,
    coreWorksheetDeliveryRate: runs > 0 ? wsCoreDelivered / runs : 0,
    items,
    readySlots: Number(r.ready_slots),
    pendingCrosscheckSlots: 0,
    failedSlots: Number(r.failed_slots),
    substitutedSlots: Number(r.sub_slots),
    omittedSlots: Number(r.omit_slots),
    kernelSlots,
    deterministicProductionRate: kernelSlots > 0 ? Number(r.kernel_prod) / kernelSlots : 0,
    avgRetriesPerItem: items > 0 ? Number(r.retries) / items : 0,
    fallbackCalls: Number(r.fallback_calls),
    lastResortCalls: Number(r.last_resort_calls),
    totalActualCostUsd: cost,
    costPerCompletedWorksheetUsd: wsCoreDelivered > 0 ? cost / wsCoreDelivered : 0,
    p50WorksheetLatencyMs: Number(r.p50),
    p95WorksheetLatencyMs: Number(r.p95),
    costCeilingEvents: Number(r.ceiling_events),
  };
}

export async function failureBreakdown(pool: Pool, sinceIso?: string): Promise<readonly FailureBreakdownRow[]> {
  const since = sinceIso ?? '1970-01-01T00:00:00Z';
  const { rows } = await pool.query(
    `SELECT a.failure_category, count(*)::int AS count
       FROM worksheet_slot_attempts a
       JOIN worksheet_generation_runs r ON r.id = a.run_id
      WHERE a.accepted = false AND a.failure_category IS NOT NULL AND r.created_at >= $1
      GROUP BY a.failure_category ORDER BY count DESC`,
    [since],
  );
  return rows.map((x) => ({ failureCategory: x.failure_category, count: x.count }));
}

export async function reviewQueueRollup(pool: Pool): Promise<ReviewQueueRollup> {
  const { rows } = await pool.query(`SELECT state, reason, count(*)::int AS count FROM review_queue GROUP BY state, reason`);
  const pendingByReason: Record<string, number> = {};
  const resolvedByState: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    total += r.count;
    if (r.state === 'PENDING') pendingByReason[r.reason] = (pendingByReason[r.reason] ?? 0) + r.count;
    else resolvedByState[r.state] = (resolvedByState[r.state] ?? 0) + r.count;
  }
  return { pendingByReason, resolvedByState, total };
}

/**
 * Retention purge (doc 65 §J.4). Nulls the SHORT-RETENTION prompt / solution
 * snapshots on `review_queue` rows older than `retentionDays` — the operational
 * columns (reason, state, ids) stay for audit. Returns the row count touched.
 */
export async function purgeReviewSnapshots(pool: Pool, retentionDays = 30): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE review_queue
        SET prompt_snapshot = NULL, worked_solution_snapshot = NULL
      WHERE created_at < now() - ($1 || ' days')::interval
        AND (prompt_snapshot IS NOT NULL OR worked_solution_snapshot IS NOT NULL)`,
    [String(retentionDays)],
  );
  return rowCount ?? 0;
}
