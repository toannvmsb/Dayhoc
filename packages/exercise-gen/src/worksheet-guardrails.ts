import type { ShadowRollup } from './worksheet-read-model.js';

/**
 * Staging SHADOW guardrails (doc 66 §2) — a per-worksheet ceiling (already on the
 * orchestrator config) PLUS a cumulative daily cap, and privacy-safe alert
 * thresholds over the rollup.
 */

export interface WorksheetCostCaps {
  /** hard USD ceiling for ONE worksheet run (passed to the orchestrator). */
  readonly perWorksheetUsd: number;
  /** hard cumulative USD cap per UTC day — the shadow runner stops enqueuing. */
  readonly perDayUsd: number;
}

export const DEFAULT_STAGING_COST_CAPS: WorksheetCostCaps = {
  perWorksheetUsd: 0.05,
  perDayUsd: 2.0,
};

/**
 * Tracks cumulative spend for the current UTC day. `canRun(estUsd)` is the
 * pre-enqueue gate; `record(actualUsd)` is called after a run completes.
 */
export class DailyCostGuard {
  #day: string;
  #spentUsd = 0;

  constructor(
    private readonly caps: WorksheetCostCaps = DEFAULT_STAGING_COST_CAPS,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.#day = this.utcDay();
  }

  private utcDay(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private roll(): void {
    const d = this.utcDay();
    if (d !== this.#day) {
      this.#day = d;
      this.#spentUsd = 0;
    }
  }

  get spentTodayUsd(): number {
    this.roll();
    return this.#spentUsd;
  }

  /** may a run costing up to `estUsd` (default: the per-worksheet cap) proceed? */
  canRun(estUsd = this.caps.perWorksheetUsd): { ok: boolean; reason?: string } {
    this.roll();
    if (this.#spentUsd + Math.min(estUsd, this.caps.perWorksheetUsd) > this.caps.perDayUsd) {
      return { ok: false, reason: `daily cap $${this.caps.perDayUsd} reached ($${this.#spentUsd.toFixed(4)} spent)` };
    }
    return { ok: true };
  }

  record(actualUsd: number): void {
    this.roll();
    this.#spentUsd += Math.max(0, actualUsd);
  }
}

export interface AlertThresholds {
  readonly minFullWorksheetCompletionRate: number; // e.g. 0.95 (staging), 0.99 (pre-LIVE)
  readonly minDeterministicProductionRate: number; // e.g. 0.85
  readonly maxAvgRetriesPerItem: number; // e.g. 0.6
  readonly maxCostPerCompletedWorksheetUsd: number; // e.g. 0.05
  readonly maxPendingReviewItems: number; // e.g. 50
  readonly maxCostCeilingEventRate: number; // ceilingEvents / runs, e.g. 0.1
}

export const DEFAULT_STAGING_ALERTS: AlertThresholds = {
  minFullWorksheetCompletionRate: 0.9,
  minDeterministicProductionRate: 0.8,
  maxAvgRetriesPerItem: 0.8,
  maxCostPerCompletedWorksheetUsd: 0.06,
  maxPendingReviewItems: 100,
  maxCostCeilingEventRate: 0.15,
};

export interface AlertResult {
  readonly ok: boolean;
  readonly breaches: readonly string[];
}

export function checkAlerts(
  rollup: ShadowRollup,
  pendingReviewItems: number,
  th: AlertThresholds = DEFAULT_STAGING_ALERTS,
): AlertResult {
  const b: string[] = [];
  if (rollup.runs === 0) return { ok: true, breaches: [] };
  if (rollup.fullWorksheetCompletionRate < th.minFullWorksheetCompletionRate) {
    b.push(`full-worksheet completion ${(rollup.fullWorksheetCompletionRate * 100).toFixed(1)}% < ${(th.minFullWorksheetCompletionRate * 100).toFixed(0)}%`);
  }
  if (rollup.kernelSlots > 0 && rollup.deterministicProductionRate < th.minDeterministicProductionRate) {
    b.push(`deterministic production ${(rollup.deterministicProductionRate * 100).toFixed(1)}% < ${(th.minDeterministicProductionRate * 100).toFixed(0)}%`);
  }
  if (rollup.avgRetriesPerItem > th.maxAvgRetriesPerItem) {
    b.push(`avg retries/item ${rollup.avgRetriesPerItem.toFixed(2)} > ${th.maxAvgRetriesPerItem}`);
  }
  if (rollup.costPerCompletedWorksheetUsd > th.maxCostPerCompletedWorksheetUsd) {
    b.push(`cost/completed worksheet $${rollup.costPerCompletedWorksheetUsd.toFixed(4)} > $${th.maxCostPerCompletedWorksheetUsd}`);
  }
  if (pendingReviewItems > th.maxPendingReviewItems) {
    b.push(`pending review items ${pendingReviewItems} > ${th.maxPendingReviewItems}`);
  }
  if (rollup.costCeilingEvents / rollup.runs > th.maxCostCeilingEventRate) {
    b.push(`cost-ceiling event rate ${((rollup.costCeilingEvents / rollup.runs) * 100).toFixed(1)}% > ${(th.maxCostCeilingEventRate * 100).toFixed(0)}%`);
  }
  return { ok: b.length === 0, breaches: b };
}
