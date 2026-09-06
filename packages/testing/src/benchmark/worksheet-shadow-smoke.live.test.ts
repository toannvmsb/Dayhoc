import { describe, expect, it } from 'vitest';
import { writeFileSync, appendFileSync, rmSync } from 'node:fs';
import {
  createOpenAiProviderAdapter,
  PricingRegistry,
  type AiCapability,
  type ProviderCompliance,
} from '@copilot/ai';
import {
  createLunaItemContentGenerator,
  DailyCostGuard,
  orchestrateWorksheet,
  type WorksheetResult,
} from '@copilot/exercise-gen';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * doc 66 §3 — INTERNAL SHADOW SMOKE. Real `orchestrateWorksheet` × gpt-4.1-mini
 * default + gpt-5-mini fallback × last-resort ON × NO gpt-4o(-mini) × crosscheck
 * OFF. ~20–30 synthetic benchmark specs (G4/G7, basic/application/gap-repair/
 * frontier/reasoning/high-complexity).
 *
 * Caps: per-worksheet USD 0.05, cumulative daily USD 2.00. Runs only with
 * `RUN_WS_SMOKE=1` + `OPENAI_API_KEY`.
 *
 * STOP CONDITION: any kernel item accepted with a wrong answer, or any silent
 * SEMANTIC_UNKNOWN acceptance → the test fails and the report says P0/P1.
 */

const LIVE = process.env.RUN_WS_SMOKE === '1' && !!process.env.OPENAI_API_KEY;
const PER_WS_CAP = Number(process.env.WS_SMOKE_PER_WS_USD ?? '0.05');
const DAILY_CAP = Number(process.env.WS_SMOKE_DAILY_USD ?? '2.00');
const WALL_CLOCK_MS = 50 * 60 * 1000;
const OUT = 'D:/Lap trinh/Claude/Dayhoc/WS_SMOKE.txt';
const RAW = 'D:/Lap trinh/Claude/Dayhoc/WS_SMOKE_raw.jsonl';

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'internal-smoke', crossBorder: true, dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy', trainingAllowed: false, dpaStatus: 'not_applicable',
};

const pctl = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};

describe('doc 66 §3 — internal shadow smoke', () => {
  it.skipIf(!LIVE)('~26 synthetic worksheets under a $2.00 daily cap', { timeout: 60 * 60 * 1000 }, async () => {
    const runStart = Date.now();
    const kb = loadKnowledgeBase();
    const lib = loadReferenceLibrary();
    const pricing = new PricingRegistry();
    const specs = buildItemBenchmarkSpecs(kb);
    try { rmSync(RAW); } catch { /* first run */ }

    const mkGen = (model: string) =>
      createLunaItemContentGenerator({
        adapter: createOpenAiProviderAdapter({
          apiKey: process.env.OPENAI_API_KEY!, model,
          capability: 'generate_problem' as AiCapability, compliance: COMPLIANCE,
        }),
        structuredOutputMode: 'STRICT_JSON_SCHEMA',
      });
    const generators = { default: mkGen('gpt-4.1-mini'), highComplexity: mkGen('gpt-5-mini') };
    const guard = new DailyCostGuard({ perWorksheetUsd: PER_WS_CAP, perDayUsd: DAILY_CAP });

    let worksheets = 0, fullWorksheets = 0, items = 0, ready = 0, pending = 0, failed = 0;
    let kernelItems = 0, kernelReady = 0, kernelProdReady = 0, kernelWrong = 0, semUnknownAccepted = 0;
    let defaultCalls = 0, highCalls = 0, retries = 0, fallbackCalls = 0, lastResortCalls = 0, ceilingEvents = 0;
    let maxAttempts = 0;
    const slotLat: number[] = []; const wsLat: number[] = [];
    const perWs: string[] = [];
    let stopReason: string | null = null;
    const p0: string[] = [];

    for (const bs of specs) {
      if (!guard.canRun().ok) { stopReason = `daily cap reached ($${guard.spentTodayUsd.toFixed(4)})`; break; }
      if (Date.now() - runStart > WALL_CLOCK_MS) { stopReason = 'wall clock'; break; }

      let r: WorksheetResult;
      try {
        r = await orchestrateWorksheet({
          spec: bs.spec, knowledgeBase: kb, referenceLibrary: lib, generators,
          config: { maxRetriesPerModel: 1, enableLastResort: true, costCeilingUsd: PER_WS_CAP, concurrency: { default: 3, highComplexity: 2 }, captureRaw: true },
          pricingRegistry: pricing, fxVndPerUsd: 26000,
        });
      } catch (e) { perWs.push(`${bs.id}: THREW ${(e as Error).message}`); continue; }

      guard.record(r.trace.totals.actualCostUsd);
      worksheets += 1;
      if (r.trace.totals.costCeilingHit) ceilingEvents += 1;
      if (r.failedSlots === 0) fullWorksheets += 1;
      ready += r.readySlots; pending += r.pendingCrosscheckSlots; failed += r.failedSlots;
      wsLat.push(r.trace.worksheetLatencyMs);
      retries += r.trace.totals.retries; fallbackCalls += r.trace.totals.fallbackCalls; lastResortCalls += r.trace.totals.lastResortCalls;
      for (const m of r.trace.totals.byModel) {
        if (m.model === 'gpt-4.1-mini') defaultCalls += m.calls;
        else if (m.model === 'gpt-5-mini') highCalls += m.calls;
      }
      for (const s of r.trace.perSlot) {
        items += 1;
        maxAttempts = Math.max(maxAttempts, s.attempts.length);
        slotLat.push(s.slotLatencyMs);
        if (s.kernelFamily) {
          kernelItems += 1;
          if (s.finalState === 'READY') { kernelReady += 1; if (s.productionReady) kernelProdReady += 1; }
          if (s.answerStatus === 'DETERMINISTIC_WRONG') { kernelWrong += 1; p0.push(`${bs.id}::${s.itemId} kernel DETERMINISTIC_WRONG`); }
        }
        if ((s.finalState === 'READY' || s.finalState === 'PENDING_CROSSCHECK') && s.answerStatus === 'SEMANTIC_UNKNOWN') {
          semUnknownAccepted += 1; p0.push(`${bs.id}::${s.itemId} silent SEMANTIC_UNKNOWN`);
        }
      }
      for (const rs of r.rawSlots ?? []) appendFileSync(RAW, JSON.stringify({ specId: bs.id, ...rs }) + '\n');
      perWs.push(`${bs.id}: ${r.worksheetState} ready=${r.readySlots} pend=${r.pendingCrosscheckSlots} fail=${r.failedSlots} cost=$${r.trace.totals.actualCostUsd.toFixed(4)} calls=${r.trace.totals.modelCalls} retries=${r.trace.totals.retries} fb=${r.trace.totals.fallbackCalls} lr=${r.trace.totals.lastResortCalls} ceil=${r.trace.totals.costCeilingHit} lat=${r.trace.worksheetLatencyMs}ms`);
      flush();
    }

    function flush() {
      const totalModelCalls = defaultCalls + highCalls;
      const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a');
      writeFileSync(OUT, [
        `DẠYZI — WORKSHEET SHADOW SMOKE (doc 66 §3)  ${new Date().toISOString()}`,
        `caps: per-worksheet $${PER_WS_CAP}  daily $${DAILY_CAP}`,
        `TOTAL SPEND: $${guard.spentTodayUsd.toFixed(4)}`,
        stopReason ? `INCOMPLETE: ${stopReason}` : 'complete',
        ``,
        `worksheets run:                 ${worksheets}`,
        `full worksheet completion:      ${pct(fullWorksheets, worksheets)}  (${fullWorksheets}/${worksheets})`,
        `valid-item completion:          ${pct(ready + pending, items)}  (${ready + pending}/${items})`,
        `kernel deterministic correctness: ${pct(kernelProdReady, kernelReady)}  (${kernelProdReady}/${kernelReady})   kernel wrong: ${kernelWrong}`,
        `production-ready deterministic:  ${pct(kernelProdReady, items)}`,
        `PENDING_CROSSCHECK:              ${pct(pending, items)}  (${pending}/${items})`,
        `FAILED slots:                   ${failed}  (${pct(failed, items)})`,
        `gpt-4.1-mini / gpt-5-mini share: ${pct(defaultCalls, totalModelCalls)} / ${pct(highCalls, totalModelCalls)}`,
        `retry rate:                     ${(retries / Math.max(1, items)).toFixed(2)}/item   fallback ${fallbackCalls}   last-resort ${lastResortCalls}`,
        `cost-ceiling events:            ${ceilingEvents}`,
        `max attempts/slot:              ${maxAttempts}`,
        `silent semantic contradiction:  ${semUnknownAccepted === 0 && kernelWrong === 0 ? 'NONE' : `!! P0/P1: ${p0.join(' ; ')}`}`,
        `cost / item:                    $${(guard.spentTodayUsd / Math.max(1, items)).toFixed(5)} (~${Math.round((guard.spentTodayUsd / Math.max(1, items)) * 26000)} VND)`,
        `cost / completed worksheet:     $${(guard.spentTodayUsd / Math.max(1, fullWorksheets)).toFixed(4)}`,
        `slot latency p50/p95:           ${pctl(slotLat, 0.5)} / ${pctl(slotLat, 0.95)} ms`,
        `worksheet latency p50/p95:      ${pctl(wsLat, 0.5)} / ${pctl(wsLat, 0.95)} ms`,
        ``,
        ...perWs.map((w) => `  - ${w}`),
      ].join('\n'));
    }
    flush();

    expect(guard.spentTodayUsd).toBeLessThanOrEqual(DAILY_CAP + PER_WS_CAP);
    expect(kernelWrong, `P0: kernel item accepted with a wrong answer — ${p0.join('; ')}`).toBe(0);
    expect(semUnknownAccepted, `P1: silent SEMANTIC_UNKNOWN acceptance — ${p0.join('; ')}`).toBe(0);
    expect(maxAttempts).toBeLessThanOrEqual(6);
  });

  it('no-op unless RUN_WS_SMOKE=1 + OPENAI_API_KEY', () => { expect(true).toBe(true); });
});
