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
  orchestrateItemGeneration,
} from '@copilot/exercise-gen';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { buildItemBenchmarkSpecs } from './item-generation-benchmark.js';

/**
 * doc 56 §2 — ROUND 1 architecture smoke. PAID. Runs ONLY when
 * `RUN_ITEM_ROUND1=1` and `OPENAI_API_KEY` are set. 6 representative specs,
 * MODE A (1 item/call), 3 mini models, `maxRetriesPerItem: 1`, NO fallback, NO
 * gpt-4o. Hard spend cap enforced per-call.
 */

const LIVE = process.env.RUN_ITEM_ROUND1 === '1' && !!process.env.OPENAI_API_KEY;

const ROUND1_SPEC_IDS = [
  'BENCH-LT-G4-02', // G4 basic / current curriculum
  'BENCH-LT-G4-03', // G4 application (application + variation + light gap repair)
  'HC01', // G4 thinking — strong thinking, K stays grade-level, T4/T5
  'BENCH-LT-G7-06', // G7 application (current + variation + application + 1 prereq)
  'HC05', // G7 gap / frontier safety — Parallel Gap Repair
  'HC10', // G7 advanced / HSG — legitimate K5 frontier
] as const;

const MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5-mini'] as const;
const HARD_CAP_USD = 0.5;
const RUN_BUDGET_USD = 0.45; // stop new calls before this; leaves headroom under the cap

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'benchmark',
  crossBorder: true,
  dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy',
  trainingAllowed: false,
  dpaStatus: 'not_applicable',
};

describe('doc 56 §2 — ROUND 1 (paid smoke)', () => {
  it.skipIf(!LIVE)(
    'runs 6 specs × MODE A × 3 mini models under a $0.50 hard cap',
    { timeout: 900_000 },
    async () => {
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
      const perModel: Record<string, unknown>[] = [];

      for (const model of MODELS) {
        const adapter = createOpenAiProviderAdapter({
          apiKey: process.env.OPENAI_API_KEY!,
          model,
          capability: 'generate_problem' as AiCapability,
          compliance: COMPLIANCE,
        });
        const generator = createLunaItemContentGenerator({ adapter, structuredOutputMode: 'STRICT_JSON_SCHEMA' });

        let requested = 0;
        let firstPassAccepted = 0;
        let acceptedAfterRetry = 0;
        let totalAccepted = 0;
        let modelCalls = 0;
        let schemaOkCalls = 0;
        let retrySum = 0;
        const latencies: number[] = [];
        let inTok = 0;
        let outTok = 0;
        let modelCostUsd = 0;
        const gateFails: Record<string, number> = {};
        const failedItems: string[] = [];
        let structuredModeUsed: string | null = null;

        for (const bs of specs) {
          if (spentUsd >= RUN_BUDGET_USD) {
            report.push(`  [BUDGET STOP] before ${model}/${bs.id} — spent $${spentUsd.toFixed(4)}`);
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
              continue;
            }
            const refs = lib.filter((l) => l.skillId === is.skillId).map((l) => ({ id: l.id, prompt: l.prompt }));
            let itemAccepted = false;
            let attempt = 0;
            let lastReason = '';
            let lastGates: string[] = [];
            const maxAttempts = 2; // first pass + 1 retry
            let retryInstr: string[] = [];

            while (attempt < maxAttempts && !itemAccepted) {
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
                const c = pricing.has(model)
                  ? (() => {
                      const e = pricing.priceAt(model);
                      return (
                        (out.usage.inputTokens / 1e6) * (e.inputPerMillionUsd ?? 0) +
                        (out.usage.outputTokens / 1e6) * (e.outputPerMillionUsd ?? 0)
                      );
                    })()
                  : 0;
                modelCostUsd += c;
                spentUsd += c;
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
              if (acc.accepted) {
                itemAccepted = true;
                accepted.push({ id: comp.exercise.id, prompt: comp.exercise.prompt });
                if (attempt === 1) firstPassAccepted += 1;
                else acceptedAfterRetry += 1;
              } else {
                lastGates = [...acc.failedGates];
                lastReason = acc.gates
                  .filter((g) => !g.pass)
                  .map((g) => `${g.gate}: ${g.detail}`)
                  .join(' | ');
                retryInstr = acc.gates
                  .filter((g) => !g.pass && g.regenerationInstruction)
                  .map((g) => g.regenerationInstruction!);
              }
            }

            retrySum += attempt - 1;
            if (itemAccepted) {
              totalAccepted += 1;
            } else {
              for (const g of lastGates) gateFails[g] = (gateFails[g] ?? 0) + 1;
              const modelRelated =
                lastGates.some((g) => ['SCHEMA_VALID', 'ANSWER_VERIFIED', 'SIMILARITY_OK', 'UNIQUENESS_OK'].includes(g)) ||
                lastReason.includes('generator inability') ||
                lastReason.includes('compose');
              failedItems.push(
                `${bs.id} :: ${is.itemId}\n      gate(s): [${lastGates.join(',')}]  attempts: ${attempt}\n      reason: ${lastReason}\n      classification: ${modelRelated ? 'MODEL-RELATED' : 'VALIDATOR/SPEC-RELATED'}`,
              );
            }
          }
        }

        const pct = (n: number, d: number) => (d > 0 ? ((n / d) * 100).toFixed(1) + '%' : 'n/a');
        const sorted = [...latencies].sort((a, b) => a - b);
        const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
        perModel.push({ model, requested, totalAccepted, firstPassAccepted, acceptedAfterRetry, modelCostUsd });
        report.push(
          `\n================ ${model} ================`,
          `structured output mode used: ${structuredModeUsed ?? 'n/a'}`,
          `requested items:            ${requested}`,
          `1. schema pass (calls):     ${pct(schemaOkCalls, modelCalls)}  (${schemaOkCalls}/${modelCalls})`,
          `2. skill alignment:         ${pct(requested - (gateFails.SKILL_ALIGNED ?? 0), requested)}`,
          `3. answer verification:     ${pct(requested - (gateFails.ANSWER_VERIFIED ?? 0), requested)}`,
          `4. leakage pass:            ${pct(requested - (gateFails.SIMILARITY_OK ?? 0), requested)}`,
          `5. uniqueness:              ${pct(requested - (gateFails.UNIQUENESS_OK ?? 0), requested)}`,
          `6. curriculum / prereq:     ${pct(requested - (gateFails.CURRICULUM_SAFE ?? 0), requested)} / ${pct(requested - (gateFails.PREREQUISITE_SAFE ?? 0), requested)}`,
          `7. K / T conformity:        ${pct(requested - (gateFails.K_LEVEL_OK ?? 0), requested)} / ${pct(requested - (gateFails.T_LEVEL_OK ?? 0), requested)}`,
          `8. first-pass acceptance:   ${pct(firstPassAccepted, requested)}  (${firstPassAccepted}/${requested})`,
          `9. accepted after retry:    +${acceptedAfterRetry}  → total ${pct(totalAccepted, requested)}  (${totalAccepted}/${requested})`,
          `10. retries (total/avg):    ${retrySum} / ${(retrySum / Math.max(1, requested)).toFixed(2)}`,
          `11. latency p50/p95 ms:     ${p(0.5)} / ${p(0.95)}   (avg ${(sorted.reduce((s, x) => s + x, 0) / Math.max(1, sorted.length)).toFixed(0)})`,
          `12. tokens in / out:        ${inTok} / ${outTok}`,
          `13. total cost USD:         $${modelCostUsd.toFixed(4)}`,
          `14. cost per accepted item: $${(totalAccepted > 0 ? modelCostUsd / totalAccepted : 0).toFixed(5)}  (${totalAccepted > 0 ? Math.round((modelCostUsd / totalAccepted) * 26000) : 0} VND)`,
          failedItems.length > 0 ? `\n  FAILED ITEMS (${failedItems.length}):` : '\n  (no failed items)',
          ...failedItems.map((f) => `    - ${f}`),
        );
      }

      const header = [
        `DẠYZI — ROUND 1 (doc 56 §2)  ${new Date().toISOString()}`,
        `specs: ${ROUND1_SPEC_IDS.join(', ')}`,
        `models: ${MODELS.join(', ')}   MODE A (1 item/call)   maxRetriesPerItem: 1   no fallback   no gpt-4o`,
        `TOTAL SPEND: $${spentUsd.toFixed(4)}   (run budget $${RUN_BUDGET_USD}, hard cap $${HARD_CAP_USD})`,
      ];
      writeFileSync('D:/Lap trinh/Claude/Dayhoc/ROUND1.txt', [...header, ...report].join('\n'));

      expect(spentUsd).toBeLessThan(HARD_CAP_USD);
    },
  );

  it('is a no-op unless RUN_ITEM_ROUND1=1 + OPENAI_API_KEY', () => {
    expect(true).toBe(true);
  });
});
