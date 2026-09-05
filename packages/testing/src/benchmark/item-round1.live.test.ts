import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import {
  createOpenAiProviderAdapter,
  PricingRegistry,
  type AiCapability,
  type ProviderCompliance,
} from '@copilot/ai';
import {
  acceptItem,
  buildItemGenerationSpecs,
  buildProblemDNA,
  composeExercise,
  createLunaItemContentGenerator,
} from '@copilot/exercise-gen';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * doc 56 §2 — ROUND 1 architecture smoke (RE-RUN). PAID. Runs ONLY when
 * `RUN_ITEM_ROUND1=1` and `OPENAI_API_KEY` are set. 6 representative specs,
 * MODE A (1 item/call), 3 mini models, 1 retry, NO fallback, NO gpt-4o.
 * Two-tier acceptance: CONTENT vs PRODUCTION-READY (doc 56 §ANSWER
 * VERIFICATION POLICY). Hard spend cap enforced per-call.
 */

const LIVE = process.env.RUN_ITEM_ROUND1 === '1' && !!process.env.OPENAI_API_KEY;

const ROUND1_SPEC_IDS = [
  'BENCH-LT-G4-02', // G4 basic / current curriculum
  'BENCH-LT-G4-03', // G4 application
  'HC01', // G4 thinking — strong thinking, K grade-level, T4/T5
  'BENCH-LT-G7-06', // G7 application
  'HC05', // G7 gap / frontier safety — Parallel Gap Repair
  'HC10', // G7 advanced / HSG — legitimate K5 frontier
] as const;

const MODELS = (process.env.ROUND1_MODELS?.split(',').filter(Boolean) ?? [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-5-mini',
]) as readonly string[];
const HARD_CAP_USD = 0.5;
const RUN_BUDGET_USD = 0.45;
const WALL_CLOCK_MS = 40 * 60 * 1000; // flush + stop cleanly before the vitest timeout
const OUT_PATH = 'D:/Lap trinh/Claude/Dayhoc/ROUND1.txt';

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'benchmark',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy',
  trainingAllowed: false,
  dpaStatus: 'not_applicable',
};

type FailCategory = 'MODEL' | 'VALIDATOR' | 'VERIFIER_LIMITATION' | 'INFRA' | 'LEAKAGE' | 'OTHER';

function classify(gates: readonly string[], reason: string, simAgainst: string | null): FailCategory {
  if (/provider error|max_tokens|max_completion_tokens|4\d\d:|rate limit/i.test(reason)) return 'INFRA';
  if (gates.includes('SIMILARITY_OK')) return simAgainst === 'reference' ? 'LEAKAGE' : 'MODEL';
  if (gates.includes('ANSWER_VERIFIED') && /deterministic check:/.test(reason)) return 'MODEL'; // proven wrong
  if (/could not rule|PENDING_CROSSCHECK/.test(reason)) return 'VERIFIER_LIMITATION';
  if (
    gates.includes('SCHEMA_VALID') ||
    /hint rung|rubric|answer .* is not|not a number|not a fraction|Vietnamese|JSON/.test(reason)
  ) {
    return 'MODEL';
  }
  if (
    gates.some((g) =>
      ['SKILL_ALIGNED', 'K_LEVEL_OK', 'T_LEVEL_OK', 'CURRICULUM_SAFE', 'PREREQUISITE_SAFE'].includes(g),
    )
  ) {
    return 'VALIDATOR'; // post-compose these are deterministic — a hit means a spec/validator issue
  }
  return 'OTHER';
}

describe('doc 56 §2 — ROUND 1 RE-RUN (paid smoke)', () => {
  it.skipIf(!LIVE)(
    'runs 6 specs × MODE A × 3 mini models under a $0.50 hard cap',
    { timeout: 45 * 60 * 1000 },
    async () => {
      const runStart = Date.now();
      const kb = loadKnowledgeBase();
      const lib = loadReferenceLibrary();
      const pricing = new PricingRegistry();
      const all = buildItemBenchmarkSpecs(kb);
      const specs = ROUND1_SPEC_IDS.map((id) => {
        const s = all.find((x) => x.id === id);
        if (!s) throw new Error(`spec ${id} not found`);
        return s;
      });

      let spentUsd = 0;
      const report: string[] = [];
      let stopReason: string | null = null;

      const flush = () => {
        const header = [
          `DẠYZI — ROUND 1 RE-RUN (doc 56 §2)  ${new Date().toISOString()}`,
          `specs: ${ROUND1_SPEC_IDS.join(', ')}`,
          `models: ${MODELS.join(', ')}   MODE A   1 retry   no fallback   no gpt-4o`,
          `TWO-TIER: CONTENT acceptance vs PRODUCTION-ready (deterministic-verified answer); rest = PENDING_CROSSCHECK`,
          `TOTAL SPEND: $${spentUsd.toFixed(4)}   (run budget $${RUN_BUDGET_USD}, hard cap $${HARD_CAP_USD})`,
          stopReason ? `INCOMPLETE: ${stopReason}` : `complete`,
        ];
        writeFileSync(OUT_PATH, [...header, ...report].join('\n'));
      };

      for (const model of MODELS) {
        if (Date.now() - runStart > WALL_CLOCK_MS) {
          stopReason = `wall-clock ${(WALL_CLOCK_MS / 60000).toFixed(0)}min reached before ${model}`;
          break;
        }
        if (spentUsd >= RUN_BUDGET_USD) {
          stopReason = `run budget $${RUN_BUDGET_USD} reached before ${model}`;
          break;
        }
        const adapter = createOpenAiProviderAdapter({
          apiKey: process.env.OPENAI_API_KEY!,
          model,
          capability: 'generate_problem' as AiCapability,
          compliance: COMPLIANCE,
        });
        const generator = createLunaItemContentGenerator({ adapter, structuredOutputMode: 'STRICT_JSON_SCHEMA' });

        let requested = 0;
        let contentFirstPass = 0;
        let contentAfterRetry = 0;
        let contentTotal = 0;
        let prodFirstPass = 0;
        let prodTotal = 0;
        let modelCalls = 0;
        let schemaOkCalls = 0;
        let retrySum = 0;
        const latencies: number[] = [];
        let inTok = 0;
        let outTok = 0;
        let modelCostUsd = 0;
        // answer verification tallies
        let verifierRuled = 0; // among non-reasoning content-accepted: verifier returned a verdict
        let verifierCorrect = 0;
        let provenWrongAllAttempts = 0;
        let crosscheckRequired = 0; // content-accepted, PENDING_CROSSCHECK
        let nonReasoningContentAccepted = 0;
        const gateFails: Record<string, number> = {};
        const failCats: Record<FailCategory, number> = { MODEL: 0, VALIDATOR: 0, VERIFIER_LIMITATION: 0, INFRA: 0, LEAKAGE: 0, OTHER: 0 };
        const failedItems: string[] = [];
        let structuredModeUsed: string | null = null;
        let specsRun = 0;
        const progressLine = () => `  [in progress: ${model} — ${specsRun}/${specs.length} specs, ${requested} items, $${spentUsd.toFixed(4)}]`;

        for (const bs of specs) {
          if (spentUsd >= RUN_BUDGET_USD || Date.now() - runStart > WALL_CLOCK_MS) {
            stopReason = spentUsd >= RUN_BUDGET_USD ? 'run budget reached' : 'wall-clock reached';
            report.push(`  [STOP ${model}/${bs.id}: ${stopReason} — $${spentUsd.toFixed(4)}]`);
            break;
          }
          const spec = bs.spec;
          const itemSpecs = buildItemGenerationSpecs(spec, kb);
          const dnaFor = new Map(itemSpecs.map((is) => [is.itemId, buildProblemDNA(is, kb, lib)]));
          const accepted: { id: string; prompt: string }[] = [];

          for (const is of itemSpecs) {
            requested += 1;
            if (spentUsd >= RUN_BUDGET_USD) {
              failedItems.push(`${bs.id} ${is.itemId} — BUDGET STOP (not attempted)`);
              failCats.OTHER += 1;
              continue;
            }
            const refs = lib.filter((l) => l.skillId === is.skillId).map((l) => ({ id: l.id, prompt: l.prompt }));
            let contentOk = false;
            let prodReady = false;
            let attempt = 0;
            let lastReason = '';
            let lastGates: string[] = [];
            let lastSimAgainst: string | null = null;
            let retryInstr: string[] = [];

            while (attempt < 2 && !contentOk) {
              attempt += 1;
              const started = Date.now();
              const out = await generator.generate({
                problemDNAs: [dnaFor.get(is.itemId)!],
                ...(retryInstr.length > 0 ? { retryInstructions: { [is.itemId]: retryInstr } } : {}),
              });
              latencies.push(Date.now() - started);
              modelCalls += 1;
              if (out.usage) {
                inTok += out.usage.inputTokens;
                outTok += out.usage.outputTokens;
                if (pricing.has(model)) {
                  const e = pricing.priceAt(model);
                  const c =
                    (out.usage.inputTokens / 1e6) * (e.inputPerMillionUsd ?? 0) +
                    (out.usage.outputTokens / 1e6) * (e.outputPerMillionUsd ?? 0);
                  modelCostUsd += c;
                  spentUsd += c;
                }
              }
              if (out.providerMeta?.structuredOutputMode) structuredModeUsed = out.providerMeta.structuredOutputMode;

              if (!out.ok) {
                lastReason = `generator inability: ${out.inability}`;
                lastGates = ['SCHEMA_VALID'];
                retryInstr = ['Trả về đúng JSON theo cấu trúc yêu cầu.'];
                continue;
              }
              schemaOkCalls += 1;
              const content = out.contents.find((c) => c.itemId === is.itemId) ?? out.contents[0];
              if (!content) {
                lastReason = 'no content for itemId';
                lastGates = ['SCHEMA_VALID'];
                continue;
              }
              const comp = composeExercise(is, content);
              if (!comp.ok) {
                lastReason = `compose: ${comp.reason}`;
                lastGates = ['SCHEMA_VALID'];
                retryInstr = [comp.regenerationInstruction];
                continue;
              }
              const acc = acceptItem(comp.exercise, is, spec, kb, {
                references: refs,
                acceptedSiblings: accepted,
                forbiddenNumberTuples: dnaFor.get(is.itemId)!.forbiddenSimilarities.numberTuples,
              });
              if (acc.answerStatus === 'DETERMINISTIC_WRONG') provenWrongAllAttempts += 1;

              if (acc.accepted) {
                contentOk = true;
                prodReady = acc.productionReady;
                accepted.push({ id: comp.exercise.id, prompt: comp.exercise.prompt });
                if (is.answerKind !== 'reasoning') {
                  nonReasoningContentAccepted += 1;
                  if (acc.answerStatus === 'DETERMINISTIC_CORRECT') {
                    verifierRuled += 1;
                    verifierCorrect += 1;
                  }
                }
                if (acc.answerStatus === 'CROSSCHECK_REQUIRED') crosscheckRequired += 1;
                if (attempt === 1) contentFirstPass += 1;
                else contentAfterRetry += 1;
                if (prodReady && attempt === 1) prodFirstPass += 1;
              } else {
                lastGates = [...acc.failedGates];
                lastReason = acc.gates
                  .filter((g) => !g.pass)
                  .map((g) => `${g.gate}: ${g.detail}`)
                  .join(' | ');
                const sim = acc.gates.find((g) => g.gate === 'SIMILARITY_OK' && !g.pass);
                lastSimAgainst = sim ? (/vs reference/.test(sim.detail) ? 'reference' : 'sibling') : null;
                retryInstr = acc.gates
                  .filter((g) => !g.pass && g.regenerationInstruction)
                  .map((g) => g.regenerationInstruction!);
              }
            }

            retrySum += attempt - 1;
            if (contentOk) {
              contentTotal += 1;
              if (prodReady) prodTotal += 1;
            } else {
              for (const g of lastGates) gateFails[g] = (gateFails[g] ?? 0) + 1;
              const cat = classify(lastGates, lastReason, lastSimAgainst);
              failCats[cat] += 1;
              failedItems.push(
                `${bs.id} :: ${is.itemId}  [${cat}]  gates:[${lastGates.join(',')}]  attempts:${attempt}\n        ${lastReason}`,
              );
            }
            if (Date.now() - runStart > WALL_CLOCK_MS) break;
          }
          specsRun += 1;
          // incremental progress flush so a kill mid-model still leaves data
          report.push(progressLine(), `    failCats: ${JSON.stringify(failCats)}`);
          flush();
          report.pop();
          report.pop();
        }

        const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a');
        const sorted = [...latencies].sort((a, b) => a - b);
        const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
        report.push(
          `\n================ ${model} ================`,
          `structured output mode used: ${structuredModeUsed ?? 'n/a'}`,
          `requested items: ${requested}   model calls: ${modelCalls}`,
          ``,
          `schema pass (calls):        ${pct(schemaOkCalls, modelCalls)}  (${schemaOkCalls}/${modelCalls})`,
          `skill alignment:            ${pct(requested - (gateFails.SKILL_ALIGNED ?? 0), requested)}`,
          `curriculum / prereq safety: ${pct(requested - (gateFails.CURRICULUM_SAFE ?? 0), requested)} / ${pct(requested - (gateFails.PREREQUISITE_SAFE ?? 0), requested)}`,
          `K / T conformity:           ${pct(requested - (gateFails.K_LEVEL_OK ?? 0), requested)} / ${pct(requested - (gateFails.T_LEVEL_OK ?? 0), requested)}`,
          `leakage pass:               ${pct(requested - (gateFails.SIMILARITY_OK ?? 0), requested)}`,
          `uniqueness pass:            ${pct(requested - (gateFails.UNIQUENESS_OK ?? 0), requested)}`,
          ``,
          `deterministic-verifier coverage: ${pct(verifierRuled, nonReasoningContentAccepted)}  (${verifierRuled}/${nonReasoningContentAccepted} non-reasoning content-accepted)`,
          `deterministic-correct (of ruled): ${pct(verifierCorrect, verifierRuled)}`,
          `deterministic-wrong (of all attempts): ${pct(provenWrongAllAttempts, modelCalls)}  (${provenWrongAllAttempts})`,
          `crosscheck-required (of content-accepted): ${pct(crosscheckRequired, contentTotal)}  (${crosscheckRequired}/${contentTotal})`,
          ``,
          `CONTENT first-pass acceptance:     ${pct(contentFirstPass, requested)}  (${contentFirstPass}/${requested})`,
          `CONTENT after-1-retry acceptance:  ${pct(contentTotal, requested)}  (+${contentAfterRetry} → ${contentTotal}/${requested})`,
          `PRODUCTION-ready first-pass:       ${pct(prodFirstPass, requested)}  (${prodFirstPass}/${requested})`,
          `PRODUCTION-ready after-1-retry:    ${pct(prodTotal, requested)}  (${prodTotal}/${requested})  [rest = PENDING_CROSSCHECK]`,
          ``,
          `retries total/avg:  ${retrySum} / ${(retrySum / Math.max(1, requested)).toFixed(2)}`,
          `latency p50/p95 ms: ${p(0.5)} / ${p(0.95)}   avg ${(sorted.reduce((s, x) => s + x, 0) / Math.max(1, sorted.length)).toFixed(0)}`,
          `tokens in/out:      ${inTok} / ${outTok}`,
          `total cost USD:     $${modelCostUsd.toFixed(4)}`,
          `cost / CONTENT accepted item:    $${(contentTotal > 0 ? modelCostUsd / contentTotal : 0).toFixed(5)}  (${contentTotal > 0 ? Math.round((modelCostUsd / contentTotal) * 26000) : 0} VND)`,
          `cost / PRODUCTION-ready item:     $${(prodTotal > 0 ? modelCostUsd / prodTotal : 0).toFixed(5)}  (${prodTotal > 0 ? Math.round((modelCostUsd / prodTotal) * 26000) : 0} VND)`,
          ``,
          `failed items by category: ${JSON.stringify(failCats)}`,
          failedItems.length > 0 ? `FAILED ITEMS (${failedItems.length}):` : '(no CONTENT failures)',
          ...failedItems.map((f) => `  - ${f}`),
        );
        flush(); // incremental — a later timeout still leaves this model's data
      }

      flush();
      expect(spentUsd).toBeLessThan(HARD_CAP_USD);
    },
  );

  it('is a no-op unless RUN_ITEM_ROUND1=1 + OPENAI_API_KEY', () => {
    expect(true).toBe(true);
  });
});
