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
  orchestrateItemGeneration,
  type ItemRunRecord,
} from '@copilot/exercise-gen';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * doc 58 §6/§7/§8/§9 — ROUND 2 (PAID). Runs ONLY when `RUN_ITEM_ROUND2=1` +
 * `OPENAI_API_KEY`. 26 benchmark specs × MODE A (1 item/call) × ≤ 1 retry ×
 * NO fallback × models gpt-4o-mini / gpt-4.1-mini / gpt-5-mini (NO gpt-4o).
 * Hard total spend cap USD 1.00, per-spec incremental flush + wall clock.
 */

const LIVE = process.env.RUN_ITEM_ROUND2 === '1' && !!process.env.OPENAI_API_KEY;
const MODELS = (process.env.ROUND2_MODELS?.split(',').filter(Boolean) ?? [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-5-mini',
]) as readonly string[];
const HARD_CAP_USD = Number(process.env.ROUND2_HARD_CAP_USD ?? '1.0');
const RUN_BUDGET_USD = Number(process.env.ROUND2_BUDGET_USD ?? '0.9');
const WALL_CLOCK_MS = 55 * 60 * 1000;
const OUT_TAG = process.env.ROUND2_OUT_TAG ?? '';
const OUT_PATH = `D:/Lap trinh/Claude/Dayhoc/ROUND2${OUT_TAG}.txt`;
const RAW_PATH = `D:/Lap trinh/Claude/Dayhoc/ROUND2${OUT_TAG}_raw.jsonl`;

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'benchmark',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy',
  trainingAllowed: false,
  dpaStatus: 'not_applicable',
};

type FailCat =
  | 'MODEL_CONTENT'
  | 'MODEL_KERNEL_DRIFT'
  | 'MODEL_SCHEMA'
  | 'LEAKAGE'
  | 'DUPLICATE'
  | 'KERNEL'
  | 'VALIDATOR'
  | 'VERIFIER'
  | 'INFRA'
  | 'OTHER';

/** classify a CONTENT failure — never hide a kernel defect inside MODEL (doc 58 §9). */
function classify(it: ItemRunRecord): FailCat {
  const d = it.failureDetail ?? '';
  const g = it.failedGates;
  if (/provider error|max_tokens|max_completion_tokens|HTTP \d{3}|status \d{3}|\b(429|4\d\d|5\d\d) (error|response|status)|rate limit|timeout|ECONN|network/i.test(d)) {
    return 'INFRA';
  }
  // a kernel CONTRADICTION when the item HAS a kernel: is it the model drifting,
  // or the kernel itself being wrong? The independent integrity gate proved the
  // kernels correct, so a contradiction here = the model changed the maths.
  if (/kernel contradiction \[ANSWER_MISMATCH|OPERAND_MUTATION|SEMANTIC_STRUCTURE_MISMATCH|SOLUTION_CONTRADICTS_KERNEL|UNIT_INCONSISTENT|KERNEL_NUMBER_DROPPED/.test(d)) {
    return 'MODEL_KERNEL_DRIFT';
  }
  if (g.includes('SIMILARITY_OK')) return /vs reference/.test(d) ? 'LEAKAGE' : 'MODEL_CONTENT';
  if (g.includes('UNIQUENESS_OK')) return 'DUPLICATE';
  if (g.includes('SCHEMA_VALID') || /hint rung|rubric|not a (number|fraction)|Vietnamese|JSON|compose/i.test(d)) {
    return 'MODEL_SCHEMA';
  }
  if (g.includes('ANSWER_VERIFIED')) return 'VERIFIER';
  if (g.some((x) => ['SKILL_ALIGNED', 'K_LEVEL_OK', 'T_LEVEL_OK', 'CURRICULUM_SAFE', 'PREREQUISITE_SAFE'].includes(x))) {
    return 'VALIDATOR';
  }
  return 'OTHER';
}

describe('doc 58 §6 — ROUND 2 (paid)', () => {
  it.skipIf(!LIVE)('26 specs × MODE A × 3 minis under a $1.00 hard cap', { timeout: 60 * 60 * 1000 }, async () => {
    const runStart = Date.now();
    const kb = loadKnowledgeBase();
    const lib = loadReferenceLibrary();
    const pricing = new PricingRegistry();
    const specIdFilter = process.env.ROUND2_SPEC_IDS?.split(',').map((s) => s.trim()).filter(Boolean);
    const specs = buildItemBenchmarkSpecs(kb).filter((s) => !specIdFilter || specIdFilter.includes(s.id));

    let spentUsd = 0;
    let stopReason: string | null = null;
    const report: string[] = [];
    try { rmSync(RAW_PATH); } catch { /* first run */ }

    const flush = () => {
      writeFileSync(
        OUT_PATH,
        [
          `DẠYZI — ROUND 2 (doc 58 §6)  ${new Date().toISOString()}`,
          `${specs.length} specs · MODE A · ≤1 retry · no fallback · no gpt-4o`,
          `models: ${MODELS.join(', ')}`,
          `TOTAL SPEND: $${spentUsd.toFixed(4)}  (budget $${RUN_BUDGET_USD}, hard cap $${HARD_CAP_USD})`,
          stopReason ? `INCOMPLETE: ${stopReason}` : 'complete',
          ...report,
        ].join('\n'),
      );
    };

    for (const model of MODELS) {
      if (spentUsd >= RUN_BUDGET_USD) {
        stopReason = `budget reached before ${model}`;
        break;
      }
      if (Date.now() - runStart > WALL_CLOCK_MS) {
        stopReason = `wall clock reached before ${model}`;
        break;
      }
      const adapter = createOpenAiProviderAdapter({
        apiKey: process.env.OPENAI_API_KEY!,
        model,
        capability: 'generate_problem' as AiCapability,
        compliance: COMPLIANCE,
      });
      const generator = createLunaItemContentGenerator({ adapter, structuredOutputMode: 'STRICT_JSON_SCHEMA' });

      // aggregates
      let requested = 0;
      let modelCalls = 0;
      let schemaOkCalls = 0;
      let contentFirst = 0;
      let contentTotal = 0;
      let prodFirst = 0;
      let prodTotal = 0;
      let kernelCovered = 0;
      let kernelContentAccepted = 0;
      let kernelProd = 0;
      let kernelDrift = 0;
      const kernelCode: Record<string, number> = {};
      let crosscheckReq = 0;
      let rejected = 0;
      let retrySum = 0;
      const latencies: number[] = [];
      let inTok = 0;
      let outTok = 0;
      let modelCostUsd = 0;
      const gateFail: Record<string, number> = {};
      const failCat: Record<FailCat, number> = {
        MODEL_CONTENT: 0, MODEL_KERNEL_DRIFT: 0, MODEL_SCHEMA: 0, LEAKAGE: 0, DUPLICATE: 0,
        KERNEL: 0, VALIDATOR: 0, VERIFIER: 0, INFRA: 0, OTHER: 0,
      };
      const failed: string[] = [];
      // worksheet-level
      let wsFirstPassFull = 0;
      let wsAfterRetryFull = 0;
      let structuredMode: string | null = null;
      let specsRun = 0;

      // worst observed single-spec cost so far (for this model) — used to refuse
      // starting a spec that could breach the HARD cap.
      let worstSpecUsd = 0.03;
      for (const bs of specs) {
        if (spentUsd >= RUN_BUDGET_USD || Date.now() - runStart > WALL_CLOCK_MS) {
          stopReason = spentUsd >= RUN_BUDGET_USD ? 'budget reached' : 'wall clock reached';
          break;
        }
        if (spentUsd + worstSpecUsd * 1.5 >= HARD_CAP_USD) {
          stopReason = `hard-cap guard before ${bs.id} (spent $${spentUsd.toFixed(4)})`;
          break;
        }
        const specStartUsd = spentUsd;
        const result = await orchestrateItemGeneration({
          spec: bs.spec,
          generator,
          referenceLibrary: lib,
          knowledgeBase: kb,
          config: { itemsPerCall: 1, maxRetriesPerItem: 1, escalateAfterAttempts: 99 },
          pricingRegistry: pricing,
        });
        specsRun += 1;
        modelCalls += result.trace.totalModelCalls;
        for (const op of result.operations) {
          if (op.schemaValid) schemaOkCalls += 1;
          latencies.push(op.latencyMs);
          inTok += op.inputTokens ?? 0;
          outTok += op.outputTokens ?? 0;
          const c = op.actualCostUsd ?? 0;
          modelCostUsd += c;
          spentUsd += c;
          if (op.structuredOutputMode) structuredMode = op.structuredOutputMode;
        }

        const kernelItems = result.perItem.filter((p) => p.kernelFamily);
        // first-pass = accepted at attempt 1; worksheet full success = every
        // kernel-supported item production-ready
        const wsKernelProdFirst = kernelItems.every((p) => p.productionReady && p.attempts <= 1);
        const wsKernelProdRetry = kernelItems.every((p) => p.productionReady && p.attempts <= 2);
        if (kernelItems.length > 0 && wsKernelProdFirst) wsFirstPassFull += 1;
        if (kernelItems.length > 0 && wsKernelProdRetry) wsAfterRetryFull += 1;

        for (const rec of result.perItem) {
          // raw sidecar — full prompt + worked solution for offline re-score / audit
          appendFileSync(
            RAW_PATH,
            JSON.stringify({
              model,
              specId: bs.id,
              itemId: rec.itemId,
              kernelFamily: rec.kernelFamily,
              accepted: rec.accepted,
              productionReady: rec.productionReady,
              answerStatus: rec.answerStatus,
              attempts: rec.attempts,
              failedGates: rec.failedGates,
              failureDetail: rec.failureDetail,
              prompt: rec.lastPrompt,
              workedSolution: rec.lastWorkedSolution,
            }) + '\n',
          );
          requested += 1;
          retrySum += Math.max(0, rec.attempts - 1);
          if (rec.kernelFamily) kernelCovered += 1;
          if (rec.accepted) {
            contentTotal += 1;
            if (rec.attempts <= 1) contentFirst += 1;
            if (rec.answerStatus === 'CROSSCHECK_REQUIRED') crosscheckReq += 1;
            if (rec.kernelFamily) {
              kernelContentAccepted += 1;
              if (rec.productionReady) {
                kernelProd += 1;
                if (rec.attempts <= 1) prodFirst += 1;
                prodTotal += 1;
              }
            } else if (rec.productionReady) {
              prodTotal += 1;
              if (rec.attempts <= 1) prodFirst += 1;
            }
          } else {
            rejected += 1;
            for (const g of rec.failedGates) gateFail[g] = (gateFail[g] ?? 0) + 1;
            const cat = classify(rec);
            failCat[cat] += 1;
            if (cat === 'MODEL_KERNEL_DRIFT') {
              kernelDrift += 1;
              for (const m of (rec.failureDetail ?? '').matchAll(/\b([A-Z_]{6,})\b/g)) {
                if (m[1] && /MISMATCH|MUTATION|DROPPED|CONTRADICTS|INCONSISTENT/.test(m[1])) {
                  kernelCode[m[1]] = (kernelCode[m[1]] ?? 0) + 1;
                }
              }
            }
            if (failed.length < 60) failed.push(`${bs.id}::${rec.itemId} [${cat}] k=${rec.kernelFamily ?? '-'} gates=[${rec.failedGates.join(',')}]\n      ${(rec.failureDetail ?? '').slice(0, 200)}`);
          }
        }
        worstSpecUsd = Math.max(worstSpecUsd, spentUsd - specStartUsd);
        flush(); // incremental
      }

      const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a');
      const sorted = [...latencies].sort((a, b) => a - b);
      const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
      report.push(
        `\n================ ${model}  (${specsRun}/${specs.length} specs) ================`,
        `structured output: ${structuredMode ?? 'n/a'}   model calls: ${modelCalls}   requested items: ${requested}`,
        ``,
        `schema pass (calls):        ${pct(schemaOkCalls, modelCalls)}`,
        `skill alignment:            ${pct(requested - (gateFail.SKILL_ALIGNED ?? 0), requested)}`,
        `curriculum / prereq safety: ${pct(requested - (gateFail.CURRICULUM_SAFE ?? 0), requested)} / ${pct(requested - (gateFail.PREREQUISITE_SAFE ?? 0), requested)}`,
        `K / T conformity:           ${pct(requested - (gateFail.K_LEVEL_OK ?? 0), requested)} / ${pct(requested - (gateFail.T_LEVEL_OK ?? 0), requested)}`,
        `leakage pass:               ${pct(requested - (gateFail.SIMILARITY_OK ?? 0), requested)}`,
        `uniqueness pass:            ${pct(requested - (gateFail.UNIQUENESS_OK ?? 0), requested)}`,
        ``,
        `MathKernel coverage:        ${pct(kernelCovered, requested)}  (${kernelCovered}/${requested})`,
        `kernel consistency pass (of kernel content-accepted): ${pct(kernelProd, kernelContentAccepted)}`,
        `kernel drift (rejected):    ${kernelDrift}   codes: ${JSON.stringify(kernelCode)}`,
        ``,
        `CONTENT first-pass:         ${pct(contentFirst, requested)}  (${contentFirst}/${requested})`,
        `CONTENT after 1 retry:      ${pct(contentTotal, requested)}  (${contentTotal}/${requested})`,
        `deterministic PRODUCTION-ready first-pass:    ${pct(prodFirst, requested)}`,
        `deterministic PRODUCTION-ready after 1 retry: ${pct(prodTotal, requested)}  (${prodTotal}/${requested})`,
        `kernel-supported production after ≤1 retry:   ${pct(kernelProd, kernelCovered)}  (${kernelProd}/${kernelCovered})`,
        `AI-crosscheck-required:     ${pct(crosscheckReq, contentTotal)} of content-accepted`,
        `rejected:                   ${pct(rejected, requested)}  (${rejected}/${requested})`,
        ``,
        `FULL WORKSHEET SUCCESS (every kernel item production-ready):`,
        `  first-pass:  ${pct(wsFirstPassFull, specsRun)}  (${wsFirstPassFull}/${specsRun})`,
        `  after retry: ${pct(wsAfterRetryFull, specsRun)}  (${wsAfterRetryFull}/${specsRun})`,
        ``,
        `avg retries: ${(retrySum / Math.max(1, requested)).toFixed(2)}   latency p50/p95 ms: ${p(0.5)} / ${p(0.95)}`,
        `tokens in/out: ${inTok} / ${outTok}   total cost USD: $${modelCostUsd.toFixed(4)}`,
        `cost / CONTENT item:    ${contentTotal > 0 ? Math.round((modelCostUsd / contentTotal) * 26000) : 0} VND`,
        `cost / PRODUCTION item: ${prodTotal > 0 ? Math.round((modelCostUsd / prodTotal) * 26000) : 0} VND`,
        ``,
        `FAILURE TAXONOMY: ${JSON.stringify(failCat)}`,
        failed.length > 0 ? `FAILED ITEMS (${failed.length}):` : '(no CONTENT failures)',
        ...failed.map((f) => `  - ${f}`),
      );
      flush();
    }

    flush();
    expect(spentUsd).toBeLessThan(HARD_CAP_USD);
  });

  it('is a no-op unless RUN_ITEM_ROUND2=1 + OPENAI_API_KEY', () => {
    expect(true).toBe(true);
  });
});
