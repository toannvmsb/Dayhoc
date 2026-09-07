import { describe, expect, it } from 'vitest';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { makeSpec } from './_spec-fixture.js';
import { buildItemGenerationSpecs } from './item-spec.js';
import { reconstructKernels } from './item-orchestrator.js';
import { createFaultInjectingGenerator, type FaultScript } from './fault-injecting-generator.js';
import { createMockAnswerCrosscheck } from './answer-crosscheck.js';
import { createInMemoryReviewQueue } from './review-queue.js';
import { orchestrateWorksheet } from './worksheet-orchestrator.js';
import { computeWorksheetCohortMetrics } from './worksheet-metrics.js';

/**
 * doc 63 §10/§11 + doc 68 — production recovery orchestrator, offline
 * fault-injection. No paid calls. Demonstrates: routing, per-model retry,
 * cross-model escalation, deterministic last-resort, SAFE DEGRADED COMPLETION
 * (criticality-aware safe substitute / optional omission), cost ceiling, and
 * that accepted slots are never regenerated.
 */

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const SPEC = makeSpec();
const PASS_XCHECK = createMockAnswerCrosscheck(() => 'PASS');

const itemSpecs = buildItemGenerationSpecs(SPEC, kb);
const kernels = reconstructKernels(SPEC, kb, lib);
const kernelItemIds = itemSpecs.filter((s) => kernels.get(s.itemId)).map((s) => s.itemId);
const groupCItemIds = itemSpecs.filter((s) => !kernels.get(s.itemId)).map((s) => s.itemId);

function run(
  defaultScripts: Record<string, FaultScript>,
  highScripts: Record<string, FaultScript> = {},
  config = {},
  provider: 'mock' | 'openai' = 'mock',
  opts: { crosscheck?: 'pass' | 'none' } = {},
) {
  return orchestrateWorksheet({
    spec: SPEC,
    knowledgeBase: kb,
    referenceLibrary: lib,
    generators: {
      default: createFaultInjectingGenerator({ name: 'def', model: 'gpt-4.1-mini', role: 'default', scripts: defaultScripts, provider, usage: { inputTokens: 800, outputTokens: 300 } }),
      highComplexity: createFaultInjectingGenerator({ name: 'high', model: 'gpt-5-mini', role: 'high', scripts: highScripts, provider, usage: { inputTokens: 900, outputTokens: 600 } }),
    },
    ...(opts.crosscheck === 'none' ? {} : { crosscheckAdapter: PASS_XCHECK }),
    reviewQueue: createInMemoryReviewQueue(),
    config,
    now: () => new Date('2027-02-01T00:00:00Z'),
    fxVndPerUsd: 26000,
  });
}

describe('doc 63 §10 — happy path + routing', () => {
  it('all-success: every slot READY on the first attempt, one model call each', async () => {
    const r = await run({});
    expect(r.worksheetState).toBe('READY');
    expect(r.readySlots).toBe(itemSpecs.length);
    expect(r.items.length).toBe(itemSpecs.length);
    expect(r.failedSlots).toBe(0);
    expect(r.omittedSlots).toBe(0);
    expect(r.trace.totals.modelCalls).toBe(itemSpecs.length);
    // routing is deterministic + versioned
    expect(r.trace.routerVersion).toBe('model-router.v1');
    for (const s of r.trace.perSlot) expect(['DEFAULT', 'HIGH_COMPLEXITY']).toContain(s.initialRole);
  });

  it('THINKING / FRONTIER / T5 / reasoning-structure slots route to HIGH_COMPLEXITY', async () => {
    const r = await run({});
    for (const s of r.trace.perSlot) {
      const is = itemSpecs.find((x) => x.itemId === s.itemId)!;
      if (is.targetRole === 'FRONTIER' || is.thinkingLevel === 'T5' || is.knowledgeLevel >= 'K4') {
        expect(s.initialRole).toBe('HIGH_COMPLEXITY');
      }
    }
  });
});

describe('doc 63 §2/§3 — retry then escalation', () => {
  it('a similarity failure on attempt 1 recovers on a same-model retry (diversity instruction)', async () => {
    // two RATIO_SHARE slots both reuse a fixed template on attempt 1 → the 2nd collides
    const a = 'egs_c4_test::item-05';
    const b = 'egs_c4_test::item-06';
    const r = await run({ [a]: { failAttempts: 1, mode: 'SIMILARITY' }, [b]: { failAttempts: 1, mode: 'SIMILARITY' } });
    const slot = r.trace.perSlot.find((s) => s.itemId === b)!;
    expect(slot.finalState).toBe('READY');
    expect(slot.attempts.length).toBeGreaterThanOrEqual(2);
    expect(slot.attempts[0]!.retryReason).toBe('SIMILARITY_OR_DUPLICATE');
    expect(slot.attempts[1]!.step).toBe('retry_same');
    expect(r.trace.totals.retries).toBeGreaterThanOrEqual(1);
  });

  it('a DEFAULT slot that keeps failing escalates to gpt-5-mini and succeeds', async () => {
    const target = kernelItemIds.find((id) => {
      const is = itemSpecs.find((x) => x.itemId === id)!;
      return is.targetRole !== 'FRONTIER' && is.thinkingLevel !== 'T5' && is.knowledgeLevel < 'K4';
    })!;
    const r = await run({ [target]: { failAttempts: 5, mode: 'KERNEL_DRIFT', role: 'default' } }, {});
    const slot = r.trace.perSlot.find((s) => s.itemId === target)!;
    expect(slot.initialRole).toBe('DEFAULT');
    expect(slot.attempts.some((a) => a.step === 'escalate')).toBe(true);
    expect(slot.finalState).toBe('READY');
    expect(r.trace.totals.fallbackCalls).toBeGreaterThanOrEqual(1);
    // the escalated attempt used gpt-5-mini
    expect(slot.attempts.find((a) => a.step === 'escalate')!.model).toBe('gpt-5-mini');
  });

  it('retry instructions are failure-specific, not a dump', async () => {
    const target = kernelItemIds[0]!;
    const r = await run({ [target]: { failAttempts: 1, mode: 'KERNEL_DRIFT' } });
    const slot = r.trace.perSlot.find((s) => s.itemId === target)!;
    expect(slot.attempts[0]!.retryReason).toBe('KERNEL_DRIFT');
  });

  it('a COMPOSE failure carries a corrective instruction into the retry (not a blind re-roll)', async () => {
    // SCHEMA fault sets answer='B' on a numeric kernel item → composeExercise
    // fails. Before the fix the retry re-ran with no correction; now the
    // deterministic regeneration instruction is threaded through and the slot
    // recovers on attempt 2.
    const target = kernelItemIds[0]!;
    const r = await run({ [target]: { failAttempts: 1, mode: 'SCHEMA' } });
    const slot = r.trace.perSlot.find((s) => s.itemId === target)!;
    expect(slot.attempts[0]!.failureCategory).toBe('COMPOSE');
    expect(slot.attempts[0]!.retryReason).toBe('SCHEMA');
    expect(slot.attempts.length).toBeGreaterThanOrEqual(2);
    expect(slot.finalState).toBe('READY');
  });
});

describe('doc 63 §4 — deterministic last resort', () => {
  it('both models fail a Group A slot → deterministic last-resort completes it', async () => {
    const target = kernelItemIds[0]!;
    const script: FaultScript = { failAttempts: 9, mode: 'KERNEL_DRIFT' };
    const r = await run({ [target]: script }, { [target]: script });
    const slot = r.trace.perSlot.find((s) => s.itemId === target)!;
    expect(slot.lastResortUsed).toBe(true);
    expect(slot.finalState).toBe('READY');
    expect(slot.productionReady).toBe(true);
    expect(r.trace.totals.lastResortCalls).toBeGreaterThanOrEqual(1);
  });

  it('a SEMANTIC_UNKNOWN that never resolves also falls to the last resort, not FAILED', async () => {
    const target = kernelItemIds[0]!;
    const script: FaultScript = { failAttempts: 9, mode: 'SEMANTIC_UNKNOWN' };
    const r = await run({ [target]: script }, { [target]: script });
    const slot = r.trace.perSlot.find((s) => s.itemId === target)!;
    expect(['READY']).toContain(slot.finalState);
    expect(slot.lastResortUsed).toBe(true);
  });
});

describe('doc 68 §3/§4 — Group C without a passing crosscheck is never delivered', () => {
  it('an OPTIONAL reasoning slot with no crosscheck adapter is OMITTED, not shown to the child', async () => {
    if (groupCItemIds.length === 0) return;
    const r = await run({}, {}, {}, 'mock', { crosscheck: 'none' });
    for (const id of groupCItemIds) {
      const slot = r.trace.perSlot.find((s) => s.itemId === id)!;
      // every no-kernel slot in makeSpec is an OPTIONAL_REASONING thinkingChallenge
      expect(slot.criticality).not.toBe('REQUIRED_CORE');
      expect(slot.finalState).toBe('OMITTED');
      expect(slot.omitted).toBe(true);
      expect(slot.reviewQueueId).toBeTruthy(); // tracked for a human reviewer
    }
    // the child worksheet is still delivered — every REQUIRED_CORE slot is READY
    expect(r.worksheetState).toBe('READY_WITH_OPTIONAL_OMISSIONS');
    expect(r.items.every((it) => it)).toBe(true);
    expect(r.omittedSlots).toBe(groupCItemIds.length);
    // NEVER a pending-crosscheck item in the delivered set
    expect(r.pendingCrosscheckSlots).toBe(0);
  });

  it('with a PASS crosscheck the same slot IS delivered (READY)', async () => {
    if (groupCItemIds.length === 0) return;
    const r = await run({});
    for (const id of groupCItemIds) {
      const slot = r.trace.perSlot.find((s) => s.itemId === id)!;
      expect(slot.finalState).toBe('READY');
      expect(slot.crosscheckVerdict).toBe('PASS');
      expect(slot.productionReady).toBe(false); // AI-crosschecked ≠ deterministically verified
    }
  });
});

describe('doc 63 §6 — worksheet assembly', () => {
  it('a failing REQUIRED_CORE slot never discards already-accepted sibling slots', async () => {
    const doomed = kernelItemIds[0]!;
    // doomed fails everywhere AND last-resort + safe-substitute disabled → FAILED,
    // but the rest survive
    const script: FaultScript = { failAttempts: 99, mode: 'KERNEL_DRIFT' };
    const r = await run(
      { [doomed]: script },
      { [doomed]: script },
      { enableLastResort: false, enableSafeSubstitute: false },
    );
    const slot = r.trace.perSlot.find((s) => s.itemId === doomed)!;
    expect(slot.criticality).toBe('REQUIRED_CORE');
    expect(slot.finalState).toBe('FAILED');
    expect(r.worksheetState).toBe('FAILED'); // a REQUIRED_CORE slot failed
    expect(r.items.length).toBe(itemSpecs.length - 1); // every other slot delivered
  });
});

describe('doc 63 §7 — cost guardrail', () => {
  it('hitting the cost ceiling routes eligible Group A slots to the last resort, no overspend', async () => {
    // real pricing; tiny ceiling → a few model calls fit, then last-resort for the rest
    const r = await run({}, {}, { costCeilingUsd: 0.004 }, 'openai');
    expect(r.trace.totals.actualCostUsd).toBeGreaterThan(0);
    expect(r.trace.totals.costCeilingHit).toBe(true);
    expect(r.trace.totals.actualCostUsd).toBeLessThanOrEqual(0.004 + 0.003 + 1e-9);
    // Group A slots still completed via last resort
    const groupAReady = r.trace.perSlot.filter((s) => s.kernelFamily && s.finalState === 'READY');
    expect(groupAReady.length).toBeGreaterThan(0);
    expect(r.trace.totals.lastResortCalls).toBeGreaterThan(0);
  });
});

describe('doc 63 §9 — observability is privacy-safe', () => {
  it('the trace contains no prompt / answer / worked-solution text', async () => {
    const r = await run({ [kernelItemIds[0]!]: { failAttempts: 1, mode: 'SIMILARITY' } });
    const json = JSON.stringify(r.trace);
    expect(json).not.toMatch(/Tính:|Đáp số|Lời giải|workedSolution|prompt/);
    // versions + categories only
    expect(r.trace.perSlot[0]!.attempts[0]).toHaveProperty('failureCategory');
    expect(r.trace).toHaveProperty('totals.modelCalls');
  });
});

describe('doc 63 §11 — product targets under fault injection', () => {
  it('kernel-supported items reach 100% deterministic correctness and the worksheet completes', async () => {
    // inject a realistic mix: one of each retryable + one that needs escalation
    const scripts: Record<string, FaultScript> = {};
    kernelItemIds.forEach((id, i) => {
      const mode = (['SIMILARITY', 'SCHEMA', 'LEAKAGE', 'KERNEL_DRIFT', 'SEMANTIC_UNKNOWN'] as const)[i % 5];
      scripts[id] = { failAttempts: mode === 'KERNEL_DRIFT' ? 3 : 1, mode };
    });
    const r = await run(scripts, {});
    // no FAILED kernel slot; every kernel slot that is READY is productionReady
    const kernelSlots = r.trace.perSlot.filter((s) => s.kernelFamily);
    for (const s of kernelSlots) {
      expect(s.finalState).not.toBe('FAILED');
      if (s.finalState === 'READY') expect(s.productionReady).toBe(true);
      // never a silent SEMANTIC_UNKNOWN acceptance
      expect(s.answerStatus).not.toBe('SEMANTIC_UNKNOWN');
      expect(s.answerStatus).not.toBe('DETERMINISTIC_WRONG');
    }
    expect(r.failedSlots).toBe(0);
    expect(r.worksheetState).not.toBe('FAILED');
    // bounded retries — a kernel-backed safe substitute adds at most one
    // (deterministic last-resort) attempt
    for (const s of r.trace.perSlot) expect(s.attempts.length).toBeLessThanOrEqual(6);
  });

  it('doc 68 §8/§13 — aggregate cohort hits the SAFE DEGRADED product gates', async () => {
    // ~18% of items fail somewhere; escalation-needing (KERNEL_DRIFT deep) is the minority.
    const MODES: FaultScript['mode'][] = ['SIMILARITY', 'SCHEMA', 'LEAKAGE', 'KERNEL_DRIFT', 'SEMANTIC_UNKNOWN', 'DUPLICATE'];
    const results = [];
    let maxAttempts = 0;
    let totalCalls = 0;
    let items = 0;

    for (let seed = 0; seed < 40; seed += 1) {
      const dScripts: Record<string, FaultScript> = {};
      const hScripts: Record<string, FaultScript> = {};
      kernelItemIds.forEach((id, i) => {
        const roll = (seed * 7 + i * 13) % 100;
        if (roll < 18) {
          const mode = MODES[(seed + i) % MODES.length]!;
          const deep = mode === 'KERNEL_DRIFT' && roll < 6;
          dScripts[id] = { failAttempts: deep ? 4 : 1, mode };
          if (deep) hScripts[id] = { failAttempts: 4, mode };
        }
      });
      const r = await run(dScripts, hScripts);
      results.push(r);
      for (const s of r.trace.perSlot) {
        items += 1;
        if (s.kernelFamily && s.finalState === 'READY') {
          expect(s.productionReady).toBe(true); // kernel-supported → deterministically verified
          expect(s.answerStatus).toBe('DETERMINISTIC_CORRECT'); // never a silent unknown/wrong
        }
        maxAttempts = Math.max(maxAttempts, s.attempts.length);
      }
      totalCalls += r.trace.totals.modelCalls + r.trace.totals.lastResortCalls;
    }

    const m = computeWorksheetCohortMetrics(results);
    if (process.env.DUMP_WS_METRICS) console.log(JSON.stringify(m, null, 2));

    // doc 68 §13 hard gates
    expect(m.verifiedDeliveryRate).toBe(1); // 100% — every delivered item is verified
    expect(m.unsafeDeliveryRate).toBe(0); // 0% — no unverified item ever delivered
    expect(m.coreWorksheetDeliveryRate).toBeGreaterThanOrEqual(0.99); // ≥ 99%
    expect(maxAttempts).toBeLessThanOrEqual(6); // bounded retries
    expect(totalCalls / items).toBeLessThan(2.2); // bounded cost
  });
});
