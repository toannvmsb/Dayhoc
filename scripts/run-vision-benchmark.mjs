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

  const report = await runVisionBenchmark({
    adapter: new MockDocumentVisionAdapter(),
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
  console.log('\n(mock adapter — this is a WIRING smoke test, not an OCR accuracy result)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
