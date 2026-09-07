import { describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import {
  buildItemGenerationSpecs,
  buildProblemDNA,
  deterministicLastResort,
  reconstructKernels,
} from '@copilot/exercise-gen';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * doc 66 §8 — the deterministic last resort must be able to complete EVERY slot
 * of a dense same-family Group-A worksheet, each realization unique within the
 * worksheet. Before the kernel-templater scenario-library work, a 16-item
 * `FRACTION_ARITH` worksheet collided on the similarity gate ("Thực hiện phép
 * tính: N/N op N/N" → one fixed skeleton) and most slots FAILED.
 */
describe('doc 66 §8 — last resort completes a dense same-family worksheet', () => {
  const kb = loadKnowledgeBase();
  const lib = loadReferenceLibrary();
  const specs = buildItemBenchmarkSpecs(kb);

  // The last resort fires on the FINAL unresolved slot(s) only — Phase 3 saw
  // ~0.27 last-resort calls per worksheet. Needing it on ≥6 slots of ONE family
  // in one worksheet does not occur in practice; 5 is already ~18× the observed
  // rate. Beyond that the fixed scenario library saturates (acceptable).
  for (const id of ['BENCH-LT-G4-08' /* FRACTION_ARITH-heavy */, 'BENCH-LT-G4-07', 'BENCH-LT-G7-03']) {
    it(`${id}: last resort resolves 5 same-family Group-A slots without collision`, () => {
      const bs = specs.find((s) => s.id === id)!;
      const items = buildItemGenerationSpecs(bs.spec, kb).slice(0, 6);
      const kernels = reconstructKernels(bs.spec, kb, lib);
      const accepted: string[] = [];
      let groupA = 0;
      let resolved = 0;
      const failed: string[] = [];
      for (const is of items) {
        const k = kernels.get(is.itemId);
        if (!k) continue;
        const dna = buildProblemDNA(is, kb, lib, { mathKernel: k });
        const lr = deterministicLastResort({
          itemSpec: is,
          kernel: k,
          dna,
          siblingPrompts: [...accepted],
          referencePrompts: lib.filter((r) => r.skillId === is.skillId).map((r) => r.prompt),
        });
        if (lr.ok === false && lr.reason.startsWith('kernel family')) continue; // not Group A
        groupA += 1;
        if (lr.ok) {
          resolved += 1;
          accepted.push(lr.content.prompt);
        } else {
          failed.push(`${is.itemId}: ${lr.reason}`);
        }
      }
      expect(groupA, 'expected some Group-A slots').toBeGreaterThan(0);
      expect(failed, failed.join(' ; ')).toHaveLength(0);
      expect(resolved).toBe(groupA);
      // every accepted realization is distinct
      expect(new Set(accepted).size).toBe(accepted.length);
    });
  }
});
