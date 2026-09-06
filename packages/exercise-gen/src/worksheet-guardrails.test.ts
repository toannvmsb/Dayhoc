import { describe, expect, it } from 'vitest';
import { DailyCostGuard, checkAlerts, DEFAULT_STAGING_ALERTS } from './worksheet-guardrails.js';
import type { ShadowRollup } from './worksheet-read-model.js';

/** doc 66 §2 — daily cost guard + alert thresholds. */

describe('DailyCostGuard', () => {
  it('blocks a run once the cumulative daily cap would be exceeded', () => {
    let t = new Date('2027-02-01T00:00:00Z');
    const g = new DailyCostGuard({ perWorksheetUsd: 0.05, perDayUsd: 0.12 }, () => t);
    expect(g.canRun().ok).toBe(true);
    g.record(0.05);
    g.record(0.05);
    expect(g.spentTodayUsd).toBeCloseTo(0.1);
    // 0.10 + 0.05 = 0.15 > 0.12 → blocked
    expect(g.canRun().ok).toBe(false);
  });

  it('resets at the UTC day boundary', () => {
    let t = new Date('2027-02-01T23:00:00Z');
    const g = new DailyCostGuard({ perWorksheetUsd: 0.05, perDayUsd: 0.05 }, () => t);
    g.record(0.05);
    expect(g.canRun().ok).toBe(false);
    t = new Date('2027-02-02T01:00:00Z');
    expect(g.canRun().ok).toBe(true);
    expect(g.spentTodayUsd).toBe(0);
  });
});

describe('checkAlerts', () => {
  const base: ShadowRollup = {
    runs: 20, worksheetsReady: 15, worksheetsReadyWithPendingCrosscheck: 4, worksheetsFailed: 1,
    fullWorksheetCompletionRate: 0.95, items: 200, readySlots: 180, pendingCrosscheckSlots: 15,
    failedSlots: 5, deterministicProductionRate: 0.9, kernelSlots: 180, avgRetriesPerItem: 0.3,
    fallbackCalls: 10, lastResortCalls: 2, totalActualCostUsd: 0.6, costPerCompletedWorksheetUsd: 0.03,
    p50WorksheetLatencyMs: 12000, p95WorksheetLatencyMs: 30000, costCeilingEvents: 0,
  };

  it('passes a healthy rollup', () => {
    expect(checkAlerts(base, 5).ok).toBe(true);
  });

  it('flags low completion + high retries + review backlog', () => {
    const r = checkAlerts(
      { ...base, fullWorksheetCompletionRate: 0.7, avgRetriesPerItem: 1.2 },
      500,
      DEFAULT_STAGING_ALERTS,
    );
    expect(r.ok).toBe(false);
    expect(r.breaches.join(' ')).toMatch(/completion/);
    expect(r.breaches.join(' ')).toMatch(/retries/);
    expect(r.breaches.join(' ')).toMatch(/review/);
  });

  it('no runs → no alert', () => {
    expect(checkAlerts({ ...base, runs: 0 }, 0).ok).toBe(true);
  });
});
