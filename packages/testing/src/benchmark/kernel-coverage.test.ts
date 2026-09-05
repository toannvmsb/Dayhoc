import { describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import {
  aggregateItemQuality,
  classifyProblemTypes,
  coverageOverSpecs,
  createMockItemContentGenerator,
  orchestrateItemGeneration,
  type ItemBenchmarkRun,
} from '@copilot/exercise-gen';
import { buildItemBenchmarkSpecs, ITEM_BENCHMARK_MODES } from './item-generation-benchmark.js';

/**
 * doc 58 §9/§11 — LOCAL / MOCK kernel-coverage benchmark. No paid model call.
 * Validates: the MathKernel classification matrix, deterministic-verification
 * coverage across the 26 benchmark specs, and — with the deterministic mock as
 * the generator — that kernel-supported items reach PRODUCTION-ready.
 */

const kb = loadKnowledgeBase();

describe('doc 58 §9 — problem-type classification matrix', () => {
  const matrix = classifyProblemTypes(kb);

  it('classifies every KB problem type into A / B / C', () => {
    expect(matrix.length).toBe(kb.problemTypes.length);
    for (const m of matrix) {
      expect(['A', 'B', 'C']).toContain(m.group);
      expect(m.kernelSupport).toBe(m.kernelFamily !== null);
      expect(m.deterministicVerificationPossible).toBe(m.kernelFamily !== null);
      expect(m.crosscheckRequired).toBe(m.kernelFamily === null);
    }
  });

  it('open reasoning / proof / HSG types are Group C (no kernel)', () => {
    const proofs = matrix.filter((m) => /chứng minh|proof|nâng cao|HSG|tự đặt/i.test(m.name) || m.thinkingLevel === 'T5');
    expect(proofs.length).toBeGreaterThan(0);
    for (const p of proofs) expect(p.group).toBe('C');
  });
});

describe('doc 58 §10 — deterministic-verification coverage over the 26 benchmark specs', () => {
  const specs = buildItemBenchmarkSpecs(kb).map((s) => s.spec);
  const cov = coverageOverSpecs(specs, kb);

  it('a MathKernel covers ≥ 70% of representative generated items', () => {
    expect(cov.kernelCoverageRate).toBeGreaterThanOrEqual(0.7);
  });

  it('every uncovered item is an open structure (reasoning / compare-decide), not a plain computation', () => {
    const openStructures = new Set([
      'explain_or_justify',
      'find_the_error',
      'construct_an_example',
      'compare_and_decide',
    ]);
    const plainUncovered = cov.uncovered.filter((u) => !openStructures.has(u.structure));
    // a tiny residue is tolerated (a skill the router doesn't recognise yet)
    expect(plainUncovered.length / cov.totalItems).toBeLessThan(0.03);
  });
});

describe('doc 58 §11 — local mock benchmark: kernel-supported items reach production', () => {
  it('runs all 26 specs, both modes, offline, and hits the §10 targets on kernel-supported types', async () => {
    const runs: ItemBenchmarkRun[] = [];
    for (const mode of ITEM_BENCHMARK_MODES) {
      for (const bs of buildItemBenchmarkSpecs(kb)) {
        const result = await orchestrateItemGeneration({
          spec: bs.spec,
          generator: createMockItemContentGenerator(),
          referenceLibrary: [],
          knowledgeBase: kb,
          config: { itemsPerCall: mode === 'A_1_PER_CALL' ? 1 : 2, maxRetriesPerItem: 1 },
        });
        runs.push({ model: 'mock', mode, benchmarkSpecId: bs.id, result });
      }
    }
    const m = aggregateItemQuality(runs);

    expect(m.kernelCoverageRate).toBeGreaterThanOrEqual(0.7);
    // the deterministic mock uses the kernel's exact numbers + answer, so a
    // kernel-supported item it content-accepts is (near) always production-ready
    expect(m.kernelSupportedProductionRate).toBeGreaterThanOrEqual(0.95);
    expect(m.kernelSupportedWrongRate).toBe(0);
    expect(m.deterministicWrongRate).toBe(0);
    // schema / skill / safety hold
    expect(m.schemaPassRate).toBe(1);
    expect(m.curriculumSafePassRate).toBe(1);
    expect(m.prerequisiteSafePassRate).toBe(1);
  });
});
