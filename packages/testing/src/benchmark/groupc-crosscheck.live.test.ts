import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createOpenAiProviderAdapter, PricingRegistry, type AiCapability, type ProviderCompliance } from '@copilot/ai';
import { createOpenAiAnswerCrosscheck, runGroupCCrosscheck } from '@copilot/exercise-gen';
import { GROUPC_GOLDEN } from './groupc-crosscheck-golden.js';

/**
 * doc 66 §6 — SMALL PAID Group-C crosscheck verification. Runs the real
 * `createOpenAiAnswerCrosscheck` (gpt-4.1-mini) against the ~16-item golden
 * benchmark. Every item has a Claude-drafted GOLDEN verdict.
 *
 * HARD REQUIREMENT: false PASS = 0 (verifier says PASS on a golden-FAIL item).
 *
 * Runs only with `RUN_GROUPC_XCHECK=1` + `OPENAI_API_KEY`. Hard spend cap
 * USD 0.50.
 */
const LIVE = process.env.RUN_GROUPC_XCHECK === '1' && !!process.env.OPENAI_API_KEY;
const CAP_USD = Number(process.env.GROUPC_XCHECK_CAP_USD ?? '0.50');
const MODEL = process.env.CROSSCHECK_MODEL ?? 'gpt-4.1-mini';
const OUT = 'D:/Lap trinh/Claude/Dayhoc/GROUPC_XCHECK.txt';

const COMPLIANCE: Omit<ProviderCompliance, 'provider'> = {
  processingRegion: 'groupc-verify', crossBorder: true, dataCategoriesAllowed: [],
  providerRetention: 'per OpenAI API policy', trainingAllowed: false, dpaStatus: 'not_applicable',
};

describe('doc 66 §6 — paid Group-C crosscheck verification', () => {
  it.skipIf(!LIVE)('16 golden items, false PASS must be 0', { timeout: 30 * 60 * 1000 }, async () => {
    const pricing = new PricingRegistry();
    const adapter = createOpenAiProviderAdapter({
      apiKey: process.env.OPENAI_API_KEY!, model: MODEL,
      capability: 'advanced_verification' as AiCapability, compliance: COMPLIANCE,
    });
    const cc = createOpenAiAnswerCrosscheck(adapter);

    let spentUsd = 0;
    let calls = 0;
    const rows: string[] = [];
    const confusion: Record<string, Record<string, number>> = {};
    let falsePass = 0;
    let uncertain = 0;
    let latSum = 0;

    for (const g of GROUPC_GOLDEN) {
      if (spentUsd > CAP_USD) { rows.push(`STOP: cap $${CAP_USD} reached`); break; }
      const t0 = Date.now();
      const r = await runGroupCCrosscheck(g.exercise, 4, cc);
      latSum += Date.now() - t0;
      calls += r.usages.length;
      for (const u of r.usages) {
        const c = pricing.has(u.model)
          ? (u.inputTokens / 1e6) * pricing.priceAt(u.model, new Date()).inputPerMillion +
            (u.outputTokens / 1e6) * pricing.priceAt(u.model, new Date()).outputPerMillion
          : 0;
        spentUsd += c;
      }
      const verifier = r.verdict;
      (confusion[g.golden] ??= {})[verifier] = ((confusion[g.golden] ??= {})[verifier] ?? 0) + 1;
      if (g.golden === 'FAIL' && verifier === 'PASS') falsePass += 1;
      if (verifier === 'UNCERTAIN') uncertain += 1;
      rows.push(`${g.id}  golden=${g.golden.padEnd(9)} verifier=${verifier.padEnd(9)} ${g.golden === verifier ? 'OK  ' : g.golden === 'FAIL' && verifier === 'PASS' ? 'FALSE-PASS !!' : 'diff'}  ${g.note}`);
    }

    const n = GROUPC_GOLDEN.length;
    const agree = (v: 'PASS' | 'FAIL') =>
      `${confusion[v]?.[v] ?? 0}/${GROUPC_GOLDEN.filter((g) => g.golden === v).length}`;
    writeFileSync(OUT, [
      `DẠYZI — GROUP-C CROSSCHECK VERIFICATION (doc 66 §6)  ${new Date().toISOString()}`,
      `model: ${MODEL}   golden items: ${n}   verifier calls: ${calls}   spend: $${spentUsd.toFixed(4)} / cap $${CAP_USD}`,
      ``,
      `PASS agreement:  ${agree('PASS')}`,
      `FAIL agreement:  ${agree('FAIL')}`,
      `UNCERTAIN rate:  ${uncertain}/${n}  (${((uncertain / n) * 100).toFixed(0)}%)`,
      `FALSE PASS:      ${falsePass}   ${falsePass === 0 ? '(OK)' : '(HARD FAIL)'}`,
      `avg latency:     ${Math.round(latSum / n)} ms/item`,
      `cost / item:     $${(spentUsd / n).toFixed(5)}`,
      ``,
      `confusion (golden → verifier): ${JSON.stringify(confusion)}`,
      ``,
      ...rows.map((r) => `  ${r}`),
    ].join('\n'));

    expect(spentUsd).toBeLessThanOrEqual(CAP_USD + 0.05);
    expect(falsePass, `false PASS must be 0 — a verifier said PASS on a golden-FAIL item`).toBe(0);
  });

  it('no-op unless RUN_GROUPC_XCHECK=1', () => { expect(true).toBe(true); });
});
