#!/usr/bin/env node
/**
 * Run the document-vision benchmark harness (P4) against whatever real cases
 * exist in packages/testing/vision-benchmark-data/ (manifest.json +
 * expected/*.json + images/*.jpg — the last one gitignored, see that
 * directory's README.md).
 *
 * Defaults to `MockDocumentVisionAdapter` — proves the harness runs
 * end-to-end (file reads, scoring, report) at ZERO cost. This is NOT a real
 * accuracy result: the mock adapter never looks at the actual pixels, so its
 * scores here are meaningless as OCR quality — only useful to confirm the
 * pipeline itself works before ever pointing it at a paid provider.
 *
 * Usage:
 *   node scripts/run-vision-benchmark.mjs            # mock adapter (free)
 *
 * A real adapter (once one exists) would be wired in here behind an env
 * flag, exactly like the rest of this codebase's OFF-by-default pattern —
 * intentionally not present yet.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'packages/testing/vision-benchmark-data');
const toUrl = (p) => pathToFileURL(p).href;

const { runVisionBenchmark, formatVisionBenchmarkReport } = await import(
  toUrl(path.join(ROOT, 'packages/testing/dist/benchmark/vision-benchmark.js'))
);
const { MockDocumentVisionAdapter } = await import(
  toUrl(path.join(ROOT, 'packages/uploads/dist/index.js'))
);
const { loadKnowledgeBase } = await import(
  toUrl(path.join(ROOT, 'packages/math-data/dist/index.js'))
);

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function main() {
  const manifest = await readJson(path.join(DATA_DIR, 'manifest.json'));
  const kb = loadKnowledgeBase();
  const knownSkillIdsByGrade = new Map();
  for (const [id, skill] of kb.skills) {
    const g = skill.gradeContext;
    if (!knownSkillIdsByGrade.has(g)) knownSkillIdsByGrade.set(g, []);
    knownSkillIdsByGrade.get(g).push(String(id));
  }

  const cases = [];
  for (const m of manifest) {
    const expected = await readJson(path.join(DATA_DIR, 'expected', `${m.id}.json`));
    cases.push({
      id: m.id,
      imagePath: path.join(DATA_DIR, 'images', m.imageFile),
      mimeType: m.mimeType,
      childGrade: m.childGrade,
      kindHint: m.kindHint,
      knownSkillIds: knownSkillIdsByGrade.get(m.childGrade) ?? [],
      expected,
    });
  }

  const live = process.argv.includes('--live');
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxImages = maxArg ? Number(maxArg.slice('--max='.length)) : 3;
  const usage = [];
  let failedCalls = 0;
  let adapter = new MockDocumentVisionAdapter();

  if (live) {
    // Real, PAID calls. Opt-in on three counts: the flag, DZ_LIVE_VISION=1 and a key in the environment.
    if (process.env.DZ_LIVE_VISION !== '1' || !process.env.OPENAI_API_KEY) {
      console.error('--live needs DZ_LIVE_VISION=1 and OPENAI_API_KEY in the environment. Nothing was sent.');
      process.exit(2);
    }
    if (!Number.isInteger(maxImages) || maxImages < 1 || maxImages > 20) {
      console.error('--max must be an integer from 1 to 20 (a deliberate spending cap). Nothing was sent.');
      process.exit(2);
    }
    const { resolveDocumentVisionAdapter } = await import(toUrl(path.join(ROOT, 'packages/uploads/dist/index.js')));
    const inner = resolveDocumentVisionAdapter(process.env, { onUsage: (u) => usage.push(u) }).adapter;
    let calls = 0;
    adapter = {
      name: inner.name,
      provider: inner.provider,
      model: inner.model,
      extractionVersion: inner.extractionVersion,
      analyze: async (input) => {
        calls += 1;
        try {
          return await inner.analyze(input);
        } catch (err) {
          // a rejected answer is a measured outcome, not a crash — and it was still billed
          failedCalls += 1;
          console.error(`  call ${calls} rejected: ${err instanceof Error ? err.message : String(err)}`);
          return { documentType: 'UNKNOWN', observedOn: null, items: [], teacherNote: null, overallConfidence: 0 };
        }
      },
    };
    cases.splice(maxImages); // hard cap on how many images are sent
    console.log(`LIVE run: ${cases.length} image(s) will be sent to ${inner.provider}/${inner.model} (cap --max=${maxImages}).`);
  }

  const report = await runVisionBenchmark({
    adapter,
    cases,
    readImageBytes: async (p) => {
      try {
        return new Uint8Array(await readFile(p));
      } catch {
        return null; // not present locally — the harness reports this as skipped, not failed
      }
    },
  });

  console.log(formatVisionBenchmarkReport(report));
  if (!live) {
    console.log('\n(mock adapter — this is a WIRING smoke test, not an OCR accuracy result)');
    return;
  }

  // ---- cost per image (tokens x the effective-dated price in @copilot/ai) ----
  const { PricingRegistry, tokenCostUsd } = await import(toUrl(path.join(ROOT, 'packages/ai/dist/index.js')));
  const registry = new PricingRegistry();
  let total = 0;
  let unpriced = 0;
  console.log('\nCost per image:');
  usage.forEach((u, i) => {
    if (!registry.has(u.model)) {
      unpriced += 1;
      console.log(`  #${i + 1}  ${u.inputTokens} in / ${u.outputTokens} out tokens, ${u.latencyMs} ms  — model "${u.model}" has NO registered price`);
      return;
    }
    const entry = registry.priceAt(u.model, new Date());
    const usd = tokenCostUsd(entry, { inputTokens: u.inputTokens, outputTokens: u.outputTokens });
    total += usd;
    console.log(
      `  #${i + 1}  ${u.inputTokens} in / ${u.outputTokens} out tokens, ${u.latencyMs} ms  = $${usd.toFixed(5)}  (${u.schemaValid ? 'valid' : 'REJECTED'}; price ${entry.effectiveDate})`,
    );
  });
  const n = usage.length;
  console.log(`\n${n} call(s), ${failedCalls} rejected by validation, ${unpriced} unpriced.`);
  if (n > 0 && unpriced === 0) {
    const avg = total / n;
    const vnd = (x) => Math.round(x * 26_000).toLocaleString('vi-VN');
    console.log(`Total $${total.toFixed(4)}  |  average $${avg.toFixed(5)} per image (~${vnd(avg)} VND).`);
    for (const perDay of [1, 3, 5]) {
      console.log(`  at ${perDay} image(s)/child/day x 30 days: $${(avg * perDay * 30).toFixed(3)} per child per month (~${vnd(avg * perDay * 30)} VND)`);
    }
    console.log('Check the price against platform.openai.com/pricing before relying on these numbers (see OPENAI_BENCHMARK_PRICES).');
  }
  console.log('\nAccuracy numbers above compare against expected/*.json, which is an UNREVIEWED draft — read the diffs by eye.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
