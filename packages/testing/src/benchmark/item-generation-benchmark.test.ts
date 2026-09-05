import { describe, expect, it } from 'vitest';
import { createMockItemContentGenerator } from '@copilot/exercise-gen';
import {
  buildItemBenchmarkSpecs,
  estimateItemBenchmarkCalls,
  formatItemBenchmarkReport,
  ITEM_BENCHMARK_MODES,
  runItemBenchmark,
} from './item-generation-benchmark.js';

describe('doc 56 §8 — item benchmark manifest', () => {
  const specs = buildItemBenchmarkSpecs();

  it('has ≥20 specs spanning grade 4 + 7 and the required axes', () => {
    expect(specs.length).toBeGreaterThanOrEqual(20);
    const grades = new Set(specs.map((s) => s.grade));
    expect(grades.has(4)).toBe(true);
    expect(grades.has(7)).toBe(true);
    const axes = new Set(specs.map((s) => s.axis));
    for (const need of ['basic_current', 'gap_repair', 'thinking', 'frontier_advanced', 'application']) {
      expect([...axes]).toContain(need);
    }
  });

  it('never uses 8-item single-call generation — orchestrator mode is 1 or 2 per call', () => {
    expect(ITEM_BENCHMARK_MODES).toEqual(['A_1_PER_CALL', 'B_2_PER_CALL']);
  });

  it('estimates a deterministic call count + cost envelope for the checkpoint', () => {
    const est = estimateItemBenchmarkCalls(specs, ['m1', 'm2', 'm3'], ITEM_BENCHMARK_MODES);
    expect(est.minCalls).toBeGreaterThan(0);
    expect(est.maxCalls).toBeGreaterThanOrEqual(est.minCalls);
    expect(est.requestedItems).toBeGreaterThan(0);
  });
});

describe('doc 56 §9 — benchmark run (offline, mock generators)', () => {
  it('produces per-model/per-mode quality + cost-per-accepted-item, deterministically', async () => {
    const specs = buildItemBenchmarkSpecs().slice(0, 6);
    const report = await runItemBenchmark({
      generators: { 'mock-a': createMockItemContentGenerator(), 'mock-b': createMockItemContentGenerator() },
      specs,
      maxModelCalls: 10_000,
      maxCostUsd: 100,
    });
    expect(report.byModelMode.length).toBe(2 * ITEM_BENCHMARK_MODES.length);
    for (const m of report.byModelMode) {
      // the deterministic mock clears the hard safety gates on the slice; a few
      // items fail the (real) similarity gate on same-family kernel worksheets —
      // that is the gate working, not a mock defect
      expect(m.contentAcceptanceRate).toBeGreaterThan(0.8);
      expect(m.costPerAcceptedItemVnd).toBe(0); // mock is free
      expect(m.schemaPassRate).toBe(1);
      expect(m.prerequisiteSafePassRate).toBe(1);
      // doc 58: a MathKernel now covers most items → most are PRODUCTION-ready,
      // not merely PENDING_CROSSCHECK
      expect(m.kernelCoverageRate).toBeGreaterThan(0.7);
      expect(m.kernelSupportedProductionRate).toBeGreaterThan(0.9);
      expect(m.kernelSupportedWrongRate).toBe(0);
      expect(m.productionAcceptanceRate).toBeGreaterThan(0.5);
      expect(m.productionAcceptanceRate).toBeLessThanOrEqual(m.contentAcceptanceRate);
    }
    expect(formatItemBenchmarkReport(report)).toContain('cost / PRODUCTION item');
  });

  it('honours the spend guardrail (stops before the call ceiling)', async () => {
    const specs = buildItemBenchmarkSpecs();
    const report = await runItemBenchmark({
      generators: { 'mock-a': createMockItemContentGenerator() },
      specs,
      maxModelCalls: 5,
      maxCostUsd: 100,
    });
    expect(report.stoppedEarly).toBe(true);
    // it stops before running the whole manifest (may overshoot by at most one spec)
    expect(report.perSpec.length).toBeLessThan(specs.length);
  });
});
