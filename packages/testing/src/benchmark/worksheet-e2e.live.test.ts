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
  orchestrateWorksheet,
  type WorksheetResult,
} from '@copilot/exercise-gen';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * doc 63 §K — SMALL PAID END-TO-END verification of the production recovery
 * orchestrator. Runs ONLY when `RUN_WORKSHEET_E2E=1` + `OPENAI_API_KEY`.
 *
 * 6 representative specs × real `orchestrateWorksheet` × gpt-4.1-mini default +
 * gpt-5-mini high-complexity/fallback × maxRetriesPerModel 1 × last-resort ON ×
 * NO gpt-4o(-mini). Hard total spend cap USD 0.50 (per-worksheet ceiling + a
 * run-level guard). Immutable raw sidecar, no child PII.
 */

const LIVE = process.env.RUN_WORKSHEET_E2E === '1' && !!process.env.OPENAI_API_KEY;
const RUN_CAP_USD = Number(process.env.WS_E2E_CAP_USD ?? '0.50');
const PER_WORKSHEET_CEILING_USD = 0.09;
const WALL_CLOCK_MS = 40 * 60 * 1000;
const OUT_PATH = 'D:/Lap trinh/Claude/Dayhoc/WS_E2E.txt';
const RAW_PATH = 'D:/Lap trinh/Claude/Dayhoc/WS_E2E_raw.jsonl';
const SPEC_IDS = ['BENCH-LT-G4-01', 'BENCH-LT-G4-06', 'HC04', 'BENCH-LT-G7-03', 'BENCH-LT-G7-06', 'HC06'];

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'benchmark',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy',
  trainingAllowed: false,
  dpaStatus: 'not_applicable',
};

function pctl(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

describe('doc 63 §K — paid worksheet E2E', () => {
  it.skipIf(!LIVE)('6 worksheets under a $0.50 hard cap', { timeout: 60 * 60 * 1000 }, async () => {
    const runStart = Date.now();
    const kb = loadKnowledgeBase();
    const lib = loadReferenceLibrary();
    const pricing = new PricingRegistry();
    const specs = buildItemBenchmarkSpecs(kb).filter((s) => SPEC_IDS.includes(s.id));
    try { rmSync(RAW_PATH); } catch { /* first run */ }

    const mkGen = (model: string) =>
      createLunaItemContentGenerator({
        adapter: createOpenAiProviderAdapter({
          apiKey: process.env.OPENAI_API_KEY!,
          model,
          capability: 'generate_problem' as AiCapability,
          compliance: COMPLIANCE,
        }),
        structuredOutputMode: 'STRICT_JSON_SCHEMA',
      });
    const generators = { default: mkGen('gpt-4.1-mini'), highComplexity: mkGen('gpt-5-mini') };

    // aggregates
    let worksheets = 0;
    let fullWorksheets = 0;
    let items = 0;
    let ready = 0;
    let pendingCrosscheck = 0;
    let failed = 0;
    let kernelItems = 0;
    let kernelReady = 0;
    let kernelProdReady = 0;
    let kernelWrong = 0;
    let semanticUnknownAccepted = 0;
    let defaultCalls = 0;
    let highCalls = 0;
    let retries = 0;
    let fallbackCalls = 0;
    let lastResortCalls = 0;
    let costCeilingEvents = 0;
    let maxAttempts = 0;
    let spentUsd = 0;
    const slotLatencies: number[] = [];
    const worksheetLatencies: number[] = [];
    const perWorksheet: string[] = [];
    let stopReason: string | null = null;

    for (const bs of specs) {
      if (spentUsd + PER_WORKSHEET_CEILING_USD > RUN_CAP_USD) {
        stopReason = `run cap guard before ${bs.id} (spent $${spentUsd.toFixed(4)})`;
        break;
      }
      if (Date.now() - runStart > WALL_CLOCK_MS) {
        stopReason = `wall clock before ${bs.id}`;
        break;
      }

      let result: WorksheetResult;
      try {
        result = await orchestrateWorksheet({
          spec: bs.spec,
          knowledgeBase: kb,
          referenceLibrary: lib,
          generators,
          config: {
            maxRetriesPerModel: 1,
            enableLastResort: true,
            costCeilingUsd: PER_WORKSHEET_CEILING_USD,
            concurrency: { default: 3, highComplexity: 2 },
            captureRaw: true,
          },
          pricingRegistry: pricing,
          fxVndPerUsd: 26000,
        });
      } catch (e) {
        perWorksheet.push(`${bs.id}: ORCHESTRATOR THREW — ${(e as Error).message}`);
        continue;
      }

      worksheets += 1;
      spentUsd += result.trace.totals.actualCostUsd;
      if (result.trace.totals.costCeilingHit) costCeilingEvents += 1;
      if (result.failedSlots === 0) fullWorksheets += 1;
      ready += result.readySlots;
      pendingCrosscheck += result.pendingCrosscheckSlots;
      failed += result.failedSlots;
      worksheetLatencies.push(result.trace.worksheetLatencyMs);

      for (const s of result.trace.perSlot) {
        items += 1;
        maxAttempts = Math.max(maxAttempts, s.attempts.length);
        slotLatencies.push(s.slotLatencyMs);
        if (s.attempts.some((a) => a.role === 'DEFAULT' && a.step !== 'last_resort')) {
          defaultCalls += s.attempts.filter((a) => a.role === 'DEFAULT' && a.step !== 'last_resort').length;
        }
        if (s.attempts.some((a) => a.role === 'HIGH_COMPLEXITY' && a.step !== 'last_resort')) {
          highCalls += s.attempts.filter((a) => a.role === 'HIGH_COMPLEXITY' && a.step !== 'last_resort').length;
        }
        if (s.kernelFamily) {
          kernelItems += 1;
          if (s.finalState === 'READY') {
            kernelReady += 1;
            if (s.productionReady) kernelProdReady += 1;
          }
          if (s.answerStatus === 'DETERMINISTIC_WRONG') kernelWrong += 1;
        }
        if ((s.finalState === 'READY' || s.finalState === 'PENDING_CROSSCHECK') && s.answerStatus === 'SEMANTIC_UNKNOWN') {
          semanticUnknownAccepted += 1;
        }
      }
      retries += result.trace.totals.retries;
      fallbackCalls += result.trace.totals.fallbackCalls;
      lastResortCalls += result.trace.totals.lastResortCalls;

      // immutable raw sidecar — no PII (benchmark specs use synthetic ids)
      for (const rs of result.rawSlots ?? []) {
        appendFileSync(RAW_PATH, JSON.stringify({ specId: bs.id, ...rs }) + '\n');
      }
      perWorksheet.push(
        `${bs.id}: state=${result.worksheetState} ready=${result.readySlots} pending=${result.pendingCrosscheckSlots} failed=${result.failedSlots} ` +
          `cost=$${result.trace.totals.actualCostUsd.toFixed(4)} calls=${result.trace.totals.modelCalls} retries=${result.trace.totals.retries} ` +
          `fallback=${result.trace.totals.fallbackCalls} lastResort=${result.trace.totals.lastResortCalls} ceilingHit=${result.trace.totals.costCeilingHit} lat=${result.trace.worksheetLatencyMs}ms`,
      );
      writeReport();
    }

    function writeReport() {
      const totalModelCalls = defaultCalls + highCalls;
      const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a');
      writeFileSync(
        OUT_PATH,
        [
          `DẠYZI — WORKSHEET E2E (doc 63 §K)  ${new Date().toISOString()}`,
          `specs: ${SPEC_IDS.join(', ')}`,
          `TOTAL SPEND: $${spentUsd.toFixed(4)}  (run cap $${RUN_CAP_USD}, per-worksheet ceiling $${PER_WORKSHEET_CEILING_USD})`,
          stopReason ? `INCOMPLETE: ${stopReason}` : 'complete',
          ``,
          `1.  full worksheet completion:        ${pct(fullWorksheets, worksheets)}  (${fullWorksheets}/${worksheets})`,
          `2.  valid-item completion:            ${pct(ready + pendingCrosscheck, items)}  (${ready + pendingCrosscheck}/${items})`,
          `3.  kernel deterministic correctness: ${pct(kernelProdReady, kernelReady)}  (${kernelProdReady}/${kernelReady} of kernel READY)   kernel wrong: ${kernelWrong}`,
          `4.  production-ready deterministic:   ${pct(kernelProdReady, items)}  (${kernelProdReady}/${items})`,
          `5.  PENDING_CROSSCHECK:               ${pct(pendingCrosscheck, items)}  (${pendingCrosscheck}/${items})`,
          `6.  gpt-4.1-mini call share:          ${pct(defaultCalls, totalModelCalls)}  (${defaultCalls})`,
          `7.  gpt-5-mini call share:            ${pct(highCalls, totalModelCalls)}  (${highCalls})`,
          `8.  retry rate:                       ${(retries / Math.max(1, items)).toFixed(2)} / item  (${retries})`,
          `9.  last-resort usage:                ${lastResortCalls}  (${pct(lastResortCalls, items)} of items)`,
          `10. unresolved / FAILED slots:        ${failed}  (${pct(failed, items)})`,
          `11. cost / item:                      $${(spentUsd / Math.max(1, items)).toFixed(5)}  (~${Math.round((spentUsd / Math.max(1, items)) * 26000)} VND)`,
          `12. cost / completed worksheet:       $${(spentUsd / Math.max(1, fullWorksheets)).toFixed(4)}  (~${Math.round((spentUsd / Math.max(1, fullWorksheets)) * 26000)} VND)`,
          `13. slot latency p50/p95:             ${pctl(slotLatencies, 0.5)} / ${pctl(slotLatencies, 0.95)} ms`,
          `14. worksheet latency p50/p95:        ${pctl(worksheetLatencies, 0.5)} / ${pctl(worksheetLatencies, 0.95)} ms`,
          `15. validator false positives:        (manual review of WS_E2E_raw.jsonl — see analysis)`,
          `16. silent semantic contradiction:    ${semanticUnknownAccepted === 0 && kernelWrong === 0 ? 'NONE' : `!! semanticUnknownAccepted=${semanticUnknownAccepted} kernelWrong=${kernelWrong}`}`,
          `17. cost-ceiling events:              ${costCeilingEvents}`,
          ``,
          `avg attempts max/slot: ${maxAttempts}`,
          ``,
          ...perWorksheet.map((w) => `  - ${w}`),
        ].join('\n'),
      );
    }
    writeReport();

    // hard acceptance conditions (doc 63 §K)
    expect(spentUsd).toBeLessThanOrEqual(RUN_CAP_USD + 1e-6);
    expect(kernelWrong).toBe(0); // kernel deterministic correctness = 100%
    expect(semanticUnknownAccepted).toBe(0); // no silent SEMANTIC_UNKNOWN acceptance
    expect(maxAttempts).toBeLessThanOrEqual(6); // no unbounded retries
    // kernel READY items must all be production-ready
    expect(kernelReady === 0 || kernelProdReady === kernelReady).toBe(true);
  });

  it('is a no-op unless RUN_WORKSHEET_E2E=1 + OPENAI_API_KEY', () => {
    expect(true).toBe(true);
  });
});
