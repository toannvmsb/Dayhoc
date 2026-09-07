import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import {
  reconstructKernels,
  composeExercise,
  validateAgainstKernel,
  buildItemGenerationSpecs,
} from '@copilot/exercise-gen';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * Phase 4 finding — offline rescore of the extended-shadow raw sidecar through
 * the CORRECTED kernel semantics + validator (no paid calls). The Phase 4 P0
 * flag on `BENCH-LT-G4-08::item-15` was a KERNEL DEFECT: `semantics.operation`
 * came out ADDITION for a `3/9 - 4/5` subtraction kernel because the fraction
 * `/` was counted as a division operator, so a valid subtraction word problem
 * tripped SEMANTIC_STRUCTURE_MISMATCH → DETERMINISTIC_WRONG.
 *
 * This rescore re-derives every kernel and re-validates every captured
 * last-attempt realization. Gate: 0 kernel item whose realization equals its
 * kernel answer may be classed DETERMINISTIC_WRONG.
 */

const RAW = 'D:/Lap trinh/Claude/Dayhoc/WS_SMOKE_EXT_raw.jsonl';
const OUT = 'D:/Lap trinh/Claude/Dayhoc/docs/implementation/data/66_phase4_offline_rescore.txt';

interface RawRow {
  pass: number;
  specId: string;
  itemId: string;
  finalState: string;
  prompt: string;
  workedSolution: string;
  answer: string;
}

describe('Phase 4 — offline rescore of the extended-shadow raw sidecar', () => {
  it.skipIf(!existsSize())('no kernel realization that equals its kernel answer is DETERMINISTIC_WRONG', () => {
    const kb = loadKnowledgeBase();
    const lib = loadReferenceLibrary();
    const benchSpecs = buildItemBenchmarkSpecs(kb);
    const byId = new Map(benchSpecs.map((b) => [b.id, b.spec]));

    const rows: RawRow[] = readFileSync(RAW, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as RawRow);

    // cache: specId -> { itemSpec map, kernel map }
    const specCache = new Map<
      string,
      { items: ReturnType<typeof buildItemGenerationSpecs>; kernels: Map<string, unknown> }
    >();
    const resolve = (specId: string) => {
      let c = specCache.get(specId);
      if (!c) {
        const spec = byId.get(specId)!;
        c = { items: buildItemGenerationSpecs(spec, kb), kernels: reconstructKernels(spec, kb, lib) as Map<string, unknown> };
        specCache.set(specId, c);
      }
      return c;
    };

    let kernelRows = 0;
    let stillWrong = 0;
    let recovered = 0;
    const stillWrongDetail: string[] = [];
    const recoveredDetail: string[] = [];

    for (const r of rows) {
      const spec = byId.get(r.specId);
      if (!spec) continue;
      const { items, kernels } = resolve(r.specId);
      const itemSpec = items.find((i) => i.itemId === r.itemId);
      const kernel = kernels.get(r.itemId) as Parameters<typeof validateAgainstKernel>[1] | undefined;
      if (!itemSpec || !kernel) continue;
      kernelRows += 1;

      const content = {
        prompt: r.prompt,
        workedSolution: r.workedSolution,
        answer: r.answer,
        hints: ['a', 'b', 'c', 'd', 'e', 'f'],
      };
      const composed = composeExercise(itemSpec, content as never, kernel);
      if (!composed.ok) continue; // a compose failure is a real reject, not a kernel FP
      const v = validateAgainstKernel(composed.exercise, kernel);
      if (v.consistent) {
        if (r.finalState === 'FAILED') {
          recovered += 1;
          recoveredDetail.push(`${r.specId}::${r.itemId} p${r.pass} (was FAILED) → now consistent`);
        }
        continue;
      }
      // still inconsistent — is it a HARD contradiction on an answer that
      // actually EQUALS the kernel? that would be a residual FP (the test's
      // stated invariant). A realization whose answer differs from the kernel
      // AND drops the given number is a family RE-ROUTE (the frozen sidecar
      // predates a kernel now covering this skill, e.g. PARALLEL_ANGLES) — not a
      // semantics false-positive.
      const semUnknown = v.semanticVerdict === 'UNKNOWN';
      const kAns = kernel && 'expectedAnswer' in kernel ? (kernel as { expectedAnswer: { value?: number } }).expectedAnswer : undefined;
      const rawNum = Number((r.answer ?? '').replace(/[^\d.-]/g, ''));
      const answerEqualsKernel = kAns?.value !== undefined && Number.isFinite(rawNum) && Math.abs(rawNum - kAns.value) < 1e-6;
      const familyReroute = v.codes.includes('KERNEL_NUMBER_DROPPED') && !answerEqualsKernel;
      if (!semUnknown && !familyReroute) {
        stillWrong += 1;
        stillWrongDetail.push(`${r.specId}::${r.itemId} p${r.pass} codes=${v.codes.join(',')} :: ${v.detail}`);
      }
    }

    writeFileSync(
      OUT,
      [
        `DẠYZI — PHASE 4 OFFLINE RESCORE (corrected kernel semantics + validator)  ${new Date().toISOString()}`,
        `raw rows: ${rows.length}   kernel-backed rows rescored: ${kernelRows}`,
        ``,
        `still DETERMINISTIC_WRONG after fix: ${stillWrong}`,
        `previously-FAILED rows now kernel-consistent: ${recovered}`,
        ``,
        `--- still wrong ---`,
        ...stillWrongDetail.map((d) => `  ${d}`),
        ``,
        `--- recovered ---`,
        ...recoveredDetail.map((d) => `  ${d}`),
      ].join('\n'),
    );

    expect(stillWrong, stillWrongDetail.join(' ; ')).toBe(0);
  });

  it('no-op unless the raw sidecar is present', () => {
    expect(true).toBe(true);
  });
});

function existsSize(): boolean {
  try {
    return existsSync(RAW) && readFileSync(RAW, 'utf8').length > 0;
  } catch {
    return false;
  }
}
