import { describe, expect, it, vi } from 'vitest';
import type { AiUsageEvent } from '@copilot/ai';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { makeSpec } from './_spec-fixture.js';
import { buildItemGenerationSpecs } from './item-spec.js';
import { reconstructKernels } from './item-orchestrator.js';
import { createFaultInjectingGenerator, type FaultScript } from './fault-injecting-generator.js';
import { createMockAnswerCrosscheck, createStubAnswerCrosscheck, resolveCrosscheckAdapter } from './answer-crosscheck.js';
import { createInMemoryReviewQueue } from './review-queue.js';
import { orchestrateWorksheet } from './worksheet-orchestrator.js';
import { toWorksheetRecords, InMemoryWorksheetGenerationStore } from './worksheet-persistence.js';
import { worksheetTraceToUsageEvents } from './worksheet-telemetry.js';
import { runWorksheetShadow, InMemoryWorksheetShadowQueue } from './worksheet-shadow.js';

/** doc 65 §6/§7/§8/§11/§12 — staging integration, all offline. */

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const SPEC = makeSpec();
const itemSpecs = buildItemGenerationSpecs(SPEC, kb);
const kernels = reconstructKernels(SPEC, kb, lib);
const groupCIds = itemSpecs.filter((s) => !kernels.get(s.itemId)).map((s) => s.itemId);

function gens(dScripts: Record<string, FaultScript> = {}, hScripts: Record<string, FaultScript> = {}) {
  return {
    default: createFaultInjectingGenerator({ name: 'd', model: 'gpt-4.1-mini', role: 'default', scripts: dScripts, provider: 'openai', usage: { inputTokens: 700, outputTokens: 250 } }),
    highComplexity: createFaultInjectingGenerator({ name: 'h', model: 'gpt-5-mini', role: 'high', scripts: hScripts, provider: 'openai', usage: { inputTokens: 800, outputTokens: 500 } }),
  };
}

describe('doc 65 §7 — paid-crosscheck config gate', () => {
  it('stays disabled unless AI_CROSSCHECK_MODE=LIVE + key', () => {
    expect(resolveCrosscheckAdapter({}).paidEnabled).toBe(false);
    expect(resolveCrosscheckAdapter({ AI_CROSSCHECK_MODE: 'SHADOW', OPENAI_API_KEY: 'k' }).paidEnabled).toBe(false);
    const paid = resolveCrosscheckAdapter({ AI_CROSSCHECK_MODE: 'LIVE', OPENAI_API_KEY: 'k' }, () => createStubAnswerCrosscheck());
    expect(paid.paidEnabled).toBe(true);
  });
});

describe('doc 65 §6 — Group C crosscheck flow (mock verifier)', () => {
  it('PASS → READY (but NOT production-ready — AI-verified, not deterministic)', async () => {
    if (groupCIds.length === 0) return;
    const r = await orchestrateWorksheet({
      spec: SPEC, knowledgeBase: kb, referenceLibrary: lib, generators: gens(),
      crosscheckAdapter: createMockAnswerCrosscheck(() => 'PASS'),
    });
    for (const id of groupCIds) {
      const slot = r.trace.perSlot.find((s) => s.itemId === id)!;
      expect(slot.finalState).toBe('READY');
      expect(slot.crosscheckVerdict).toBe('PASS');
      expect(slot.productionReady).toBe(false);
    }
    expect(r.worksheetState).not.toBe('FAILED');
  });

  it('FAIL → regenerate (feeds the retry chain)', async () => {
    if (groupCIds.length === 0) return;
    let calls = 0;
    const r = await orchestrateWorksheet({
      spec: SPEC, knowledgeBase: kb, referenceLibrary: lib, generators: gens(),
      crosscheckAdapter: createMockAnswerCrosscheck(() => (++calls <= 1 ? 'FAIL' : 'PASS')),
    });
    const slot = r.trace.perSlot.find((s) => s.itemId === groupCIds[0])!;
    expect(slot.attempts.length).toBeGreaterThanOrEqual(2);
    expect(slot.attempts.some((a) => a.failureCategory === 'CROSSCHECK_FAIL')).toBe(true);
  });

  it('UNCERTAIN → PENDING_CROSSCHECK + a review-queue row', async () => {
    if (groupCIds.length === 0) return;
    const rq = createInMemoryReviewQueue();
    const r = await orchestrateWorksheet({
      spec: SPEC, knowledgeBase: kb, referenceLibrary: lib, generators: gens(),
      crosscheckAdapter: createMockAnswerCrosscheck(() => 'UNCERTAIN'),
      reviewQueue: rq, childRef: 'child_ref_pseudo',
    });
    const slot = r.trace.perSlot.find((s) => s.itemId === groupCIds[0])!;
    expect(slot.finalState).toBe('PENDING_CROSSCHECK');
    expect(slot.reviewQueueId).toBeTruthy();
    const pending = await rq.listPending();
    expect(pending.some((p) => p.reason === 'CROSSCHECK_UNCERTAIN' && p.childRef === 'child_ref_pseudo')).toBe(true);
    // review-queue row carries NO name/school — pseudonymous ref only
    expect(JSON.stringify(pending)).not.toMatch(/school|tên|họ và tên/i);
  });

  it('no adapter → PENDING_CROSSCHECK, never marked production-verified', async () => {
    if (groupCIds.length === 0) return;
    const r = await orchestrateWorksheet({ spec: SPEC, knowledgeBase: kb, referenceLibrary: lib, generators: gens() });
    const slot = r.trace.perSlot.find((s) => s.itemId === groupCIds[0])!;
    expect(slot.finalState).toBe('PENDING_CROSSCHECK');
    expect(slot.productionReady).toBe(false);
    expect(slot.crosscheckVerdict).toBeNull();
  });
});

describe('doc 65 §8 — review queue', () => {
  it('create → listPending → resolve once', async () => {
    const rq = createInMemoryReviewQueue();
    const item = await rq.create({ generationSpecId: 'g', itemId: 'i1', reason: 'BOTH_MODELS_FAILED', detail: 'x' });
    expect(item.state).toBe('PENDING');
    expect((await rq.listPending()).length).toBe(1);
    const resolved = await rq.resolve(item.id, 'REGENERATE_REQUESTED', 'reviewer_pseudo');
    expect(resolved.state).toBe('REGENERATE_REQUESTED');
    expect((await rq.listPending()).length).toBe(0);
    await expect(rq.resolve(item.id, 'APPROVED', 'r2')).rejects.toThrow();
  });

  it('a genuinely FAILED slot raises a review-queue row', async () => {
    const rq = createInMemoryReviewQueue();
    const doomed = itemSpecs.find((s) => kernels.get(s.itemId))!.itemId;
    const script: FaultScript = { failAttempts: 99, mode: 'KERNEL_DRIFT' };
    const r = await orchestrateWorksheet({
      spec: SPEC, knowledgeBase: kb, referenceLibrary: lib, generators: gens({ [doomed]: script }, { [doomed]: script }),
      config: { enableLastResort: false }, reviewQueue: rq,
    });
    expect(r.failedSlots).toBe(1);
    const pending = await rq.listPending();
    expect(pending.some((p) => p.reason === 'BOTH_MODELS_FAILED')).toBe(true);
  });
});

describe('doc 65 §3 — persistence mapping (no PII, append-only)', () => {
  it('toWorksheetRecords maps run + slots + attempts with only operational data', async () => {
    const r = await orchestrateWorksheet({
      spec: SPEC, knowledgeBase: kb, referenceLibrary: lib,
      generators: gens({ [itemSpecs[2]!.itemId]: { failAttempts: 1, mode: 'SIMILARITY' } }),
    });
    const bundle = toWorksheetRecords(SPEC, r, { runId: 'run1', childRef: 'cref', mode: 'SHADOW' });
    expect(bundle.run.generationSpecId).toBe(SPEC.generationSpecId);
    expect(bundle.slots.length).toBe(itemSpecs.length);
    expect(bundle.attempts.length).toBeGreaterThanOrEqual(itemSpecs.length);
    // NO prompt/answer/solution text anywhere
    const json = JSON.stringify(bundle);
    expect(json).not.toMatch(/Tính|Đáp số|workedSolution|prompt|Bạn |quả táo/);
    expect(json).not.toMatch(/school|họ và tên/i);

    const store = new InMemoryWorksheetGenerationStore();
    await store.putRun(bundle);
    await expect(store.putRun(bundle)).rejects.toThrow(/append-only/);
    expect((await store.listSlots('run1')).length).toBe(itemSpecs.length);
  });
});

describe('doc 65 §4 — cost telemetry (plan-independent)', () => {
  it('trace → one AiUsageEvent per model, plan recorded but not gating', async () => {
    const r = await orchestrateWorksheet({
      spec: SPEC, knowledgeBase: kb, referenceLibrary: lib,
      generators: gens({ [itemSpecs.find((s) => s.targetRole !== 'FRONTIER' && kernels.get(s.itemId))!.itemId]: { failAttempts: 5, mode: 'KERNEL_DRIFT', role: 'default' } }),
      pricingRegistry: undefined,
    });
    const free = worksheetTraceToUsageEvents(r.trace, { userRef: 'u', childRef: 'c', plan: 'free' });
    const pro = worksheetTraceToUsageEvents(r.trace, { userRef: 'u', childRef: 'c', plan: 'pro' });
    // same calls / cost regardless of plan
    expect(free.map((e) => e.model).sort()).toEqual(pro.map((e) => e.model).sort());
    expect(free.reduce((a, e) => a + (e.actualCostUsd ?? 0), 0)).toBe(pro.reduce((a, e) => a + (e.actualCostUsd ?? 0), 0));
    for (const e of free) {
      expect(e.operationType).toBe('worksheet_batch_generation');
      expect(e.generationSpecId).toBe(SPEC.generationSpecId);
      expect(e.actualCostUsd).toBeGreaterThan(0); // real pricing for gpt-4.1-mini
    }
    // escalation recorded
    expect(free.some((e) => e.escalatedFrom !== null || e.retryCount > 0)).toBe(true);
  });
});

describe('doc 65 §1/§11 — SHADOW wrapper', () => {
  const shadowJob = (over: Partial<Parameters<typeof runWorksheetShadow>[1]> = {}) => ({
    spec: SPEC, generators: gens(), referenceLibrary: lib, knowledgeBase: kb,
    ...over,
  });

  it('OFF → does not run, no model calls', async () => {
    const g = gens();
    const spy = vi.spyOn(g.default, 'generate');
    const out = await runWorksheetShadow('OFF', shadowJob({ generators: g }));
    expect(out.ran).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('LIVE → reserved, treated as OFF (never serves)', async () => {
    const out = await runWorksheetShadow('LIVE', shadowJob());
    expect(out.ran).toBe(false);
    if (!out.ran) expect(out.reason).toMatch(/LIVE reserved/);
  });

  it('SHADOW → runs, persists, records telemetry, produces a comparison', async () => {
    const store = new InMemoryWorksheetGenerationStore();
    const sink: AiUsageEvent[] = [];
    const out = await runWorksheetShadow('SHADOW', shadowJob({
      store, usageSink: (e) => sink.push(e),
      usageContext: { userRef: 'u', childRef: 'cref', plan: 'plus' },
      childRef: 'cref',
      legacyMetrics: { path: 'legacy', completedItems: 6, totalItems: 8, pendingCrosscheck: 1, failed: 1, modelCalls: 8, retries: 0, fallbackCalls: 0, lastResortCalls: 0, actualCostUsd: 0.02, latencyMs: 4000 },
    }));
    expect(out.ran).toBe(true);
    if (!out.ran) return;
    expect(out.persisted).toBe(true);
    expect(sink.length).toBeGreaterThan(0);
    expect(out.comparison.legacy?.path).toBe('legacy');
    expect(out.comparison.next.totalItems).toBe(itemSpecs.length);
    const runs = await store.listRuns(SPEC.generationSpecId);
    expect(runs.length).toBe(1);
    expect(runs[0]!.mode).toBe('SHADOW');
  });

  it('queue.drain awaits the SHADOW job; onOutcome fires; result never served', async () => {
    const outcomes: unknown[] = [];
    const q = new InMemoryWorksheetShadowQueue({ onOutcome: (_j, o) => outcomes.push(o) });
    q.enqueue('SHADOW', shadowJob());
    await q.drain();
    expect(outcomes.length).toBe(1);
  });
});
