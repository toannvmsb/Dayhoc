/**
 * Document-vision benchmark harness (P4 — productionization phase).
 *
 * Purpose: evaluate a REAL `DocumentVisionAdapter` (once one exists — today
 * only `MockDocumentVisionAdapter`/a non-functional `OpenAiVisionAdapter`
 * stub exist in `@copilot/uploads`) against a small, curated set of real
 * homework/test photos, BEFORE ever turning paid OCR on for a real family.
 *
 * This module deliberately contains NO accuracy numbers and NO sample
 * images. Fabricating "benchmark results" from invented data would be
 * scientifically meaningless and actively misleading for a decision this
 * consequential (whether to spend money calling a vision API against real
 * children's handwriting). What's here is the HARNESS: a case format, five
 * separately-scored metrics (never one blended "accuracy"), an orchestrator,
 * and a report formatter — ready to run the moment 20-30 real,
 * anh-supplied homework/test images exist locally (never committed to git —
 * see `packages/testing/vision-benchmark-data/README.md`).
 *
 * Known schema gap this harness surfaces rather than hides: `ExtractedItem`
 * (`@copilot/domain` uploads.ts) has one `prompt` string per item — there is
 * no dedicated raw-OCR-text field separate from a normalized math
 * expression. `scoreTextExtraction` / `scoreMathExtraction` below both read
 * `prompt` as a best-effort proxy for now; splitting them into two real
 * fields is a follow-up once a live OCR provider actually returns both.
 */
import type { DocumentExtraction, DocumentType } from '@copilot/domain';
import type { DocumentVisionAdapter, VisionAnalyzeInput } from '@copilot/uploads';

// --- case format -------------------------------------------------------

export interface VisionBenchmarkExpected {
  readonly documentType: DocumentType;
  /** Ground-truth problem count (segmentation target). */
  readonly problemCount: number;
  /** Ground-truth transcribed prompt text per item, index-aligned to the
   * expected item ordering (NOT the adapter's — see `scoreProblemExtraction`
   * for how the two orderings get matched). */
  readonly itemTexts: readonly string[];
  /** Ground-truth normalized math expression per item, `null` where the item
   * has no math notation to extract (e.g. a word-only reasoning prompt). */
  readonly itemMathExpressions: readonly (string | null)[];
  /** Ground-truth correct skill id per item, `null` where no confident
   * curriculum mapping is possible even for a human reviewer. */
  readonly itemSkillIds: readonly (string | null)[];
}

export interface VisionBenchmarkCase {
  readonly id: string;
  /** Absolute or cwd-relative path to the real image file. The harness reads
   * this lazily — a case whose file doesn't exist locally is skipped, not
   * treated as a failure (most contributors won't have the real dataset). */
  readonly imagePath: string;
  readonly mimeType: string;
  readonly childGrade: number;
  readonly kindHint: VisionAnalyzeInput['kindHint'];
  readonly knownSkillIds: readonly string[];
  readonly expected: VisionBenchmarkExpected;
}

// --- string/number similarity primitives (pure, no deps) ---------------

/** Normalized Levenshtein similarity in [0,1] — 1 = identical, 0 = completely
 * different. Case/diacritic-insensitive-ish via a light fold; Vietnamese text
 * comparison in a real benchmark should also review diffs by eye, this is a
 * coarse automatic signal, not a certification. */
export function textSimilarity(a: string, b: string): number {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  const dp: number[] = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= y.length; j += 1) {
      const tmp = dp[j]!;
      dp[j] = x[i - 1] === y[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  const dist = dp[y.length]!;
  return 1 - dist / Math.max(x.length, y.length);
}

/** Math-expression comparison: strip all whitespace before comparing, so
 * "3/4 + 1/2" and "3/4+1/2" count as the same extraction — layout spacing
 * from OCR is not a real error, a wrong digit or operator is. */
export function mathExpressionSimilarity(a: string | null, b: string | null): number {
  if (a === null && b === null) return 1;
  if (a === null || b === null) return 0;
  return textSimilarity(a.replace(/\s+/g, ''), b.replace(/\s+/g, ''));
}

// --- per-category metrics -----------------------------------------------

export interface VisionMetricScore {
  readonly score: number; // 0..1, higher is better
  readonly sampleCount: number;
}

function avg(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Problem segmentation: did the adapter find the right NUMBER of problems?
 * Scored per-case as 1 - |actual-expected|/expected (floored at 0), not just
 * a boolean match, so "found 4 of 5" scores better than "found 1 of 5". */
export function scoreProblemExtraction(cases: readonly { actual: DocumentExtraction; expected: VisionBenchmarkExpected }[]): VisionMetricScore {
  const perCase = cases.map((c) => {
    const expectedN = c.expected.problemCount;
    if (expectedN === 0) return c.actual.items.length === 0 ? 1 : 0;
    const diff = Math.abs(c.actual.items.length - expectedN);
    return Math.max(0, 1 - diff / expectedN);
  });
  return { score: avg(perCase), sampleCount: cases.length };
}

/** Text extraction: best-effort greedy alignment of actual items to expected
 * texts (by position — real datasets should keep item order top-to-bottom on
 * the page so index alignment is meaningful), averaged over the SHORTER of
 * the two lists (extra/missing items are already penalized by segmentation). */
export function scoreTextExtraction(cases: readonly { actual: DocumentExtraction; expected: VisionBenchmarkExpected }[]): VisionMetricScore {
  const perItem: number[] = [];
  for (const c of cases) {
    const n = Math.min(c.actual.items.length, c.expected.itemTexts.length);
    for (let i = 0; i < n; i += 1) {
      perItem.push(textSimilarity(c.actual.items[i]!.prompt, c.expected.itemTexts[i]!));
    }
  }
  return { score: avg(perItem), sampleCount: perItem.length };
}

/** Math extraction — same alignment as text, scored with math-aware
 * whitespace-insensitive comparison. See the module doc comment: this reads
 * the same `prompt` field as text extraction until a dedicated math-notation
 * field exists on `ExtractedItem`. */
export function scoreMathExtraction(cases: readonly { actual: DocumentExtraction; expected: VisionBenchmarkExpected }[]): VisionMetricScore {
  const perItem: number[] = [];
  for (const c of cases) {
    const n = Math.min(c.actual.items.length, c.expected.itemMathExpressions.length);
    for (let i = 0; i < n; i += 1) {
      const expectedMath = c.expected.itemMathExpressions[i]!;
      if (expectedMath === null) continue; // nothing to extract for this item
      perItem.push(mathExpressionSimilarity(c.actual.items[i]!.prompt, expectedMath));
    }
  }
  return { score: avg(perItem), sampleCount: perItem.length };
}

/** Curriculum mapping: did the adapter's TOP skill candidate match the
 * expected skill id? Items with no expected mapping are excluded (there is
 * no "right answer" to score them against). */
export function scoreCurriculumMapping(cases: readonly { actual: DocumentExtraction; expected: VisionBenchmarkExpected }[]): VisionMetricScore {
  const perItem: number[] = [];
  for (const c of cases) {
    const n = Math.min(c.actual.items.length, c.expected.itemSkillIds.length);
    for (let i = 0; i < n; i += 1) {
      const expectedSkill = c.expected.itemSkillIds[i]!;
      if (expectedSkill === null) continue;
      const top = c.actual.items[i]!.skillCandidates[0]?.skillId ?? null;
      perItem.push(top === expectedSkill ? 1 : 0);
    }
  }
  return { score: avg(perItem), sampleCount: perItem.length };
}

/**
 * Confidence calibration: NOT accuracy — whether stated confidence tracks
 * REALIZED correctness. Buckets every scored curriculum-mapping item by its
 * adapter-stated confidence (round to nearest 0.1) and compares the bucket's
 * mean stated confidence against its actual top-1 hit rate. Returns
 * 1 - mean-absolute-calibration-error (1 = perfectly calibrated). A model
 * that is accurate but always claims 0.99 confidence when it's actually
 * right only 70% of the time should score POORLY here even though its
 * curriculum-mapping score is fine — overconfidence is its own failure mode
 * (silently converting a wrong low-confidence guess into "VERIFIED" evidence
 * is exactly what P4's directive says never to do).
 */
export function scoreConfidenceCalibration(cases: readonly { actual: DocumentExtraction; expected: VisionBenchmarkExpected }[]): VisionMetricScore {
  const buckets = new Map<number, { statedSum: number; correctSum: number; n: number }>();
  for (const c of cases) {
    const n = Math.min(c.actual.items.length, c.expected.itemSkillIds.length);
    for (let i = 0; i < n; i += 1) {
      const expectedSkill = c.expected.itemSkillIds[i]!;
      if (expectedSkill === null) continue;
      const top = c.actual.items[i]!.skillCandidates[0];
      if (!top) continue;
      const bucketKey = Math.round(top.confidence * 10) / 10;
      const b = buckets.get(bucketKey) ?? { statedSum: 0, correctSum: 0, n: 0 };
      b.statedSum += top.confidence;
      b.correctSum += top.skillId === expectedSkill ? 1 : 0;
      b.n += 1;
      buckets.set(bucketKey, b);
    }
  }
  if (buckets.size === 0) return { score: 0, sampleCount: 0 };
  const errors = [...buckets.values()].map((b) => Math.abs(b.statedSum / b.n - b.correctSum / b.n));
  const totalN = [...buckets.values()].reduce((s, b) => s + b.n, 0);
  return { score: 1 - avg(errors), sampleCount: totalN };
}

// --- orchestrator --------------------------------------------------------

export interface VisionBenchmarkReport {
  readonly benchmarkVersion: string;
  readonly timestamp: string;
  readonly adapter: { readonly name: string; readonly provider: string; readonly model: string; readonly extractionVersion: string };
  readonly requestedCaseCount: number;
  readonly skippedMissingImage: readonly string[];
  readonly ranCaseCount: number;
  readonly metrics: {
    readonly textExtraction: VisionMetricScore;
    readonly mathExtraction: VisionMetricScore;
    readonly problemExtraction: VisionMetricScore;
    readonly curriculumMapping: VisionMetricScore;
    readonly confidenceCalibration: VisionMetricScore;
  };
  readonly perCase: readonly { readonly id: string; readonly overallConfidence: number; readonly itemCount: number }[];
}

export const VISION_BENCHMARK_VERSION = 'document-vision-benchmark.v1';

export interface RunVisionBenchmarkInput {
  readonly adapter: DocumentVisionAdapter;
  readonly cases: readonly VisionBenchmarkCase[];
  /** Injected so this stays pure/testable without real disk images — pass
   * `readFileBytes` from Node's fs in a real run (see the CLI usage note in
   * `packages/testing/vision-benchmark-data/README.md`). */
  readonly readImageBytes: (path: string) => Promise<Uint8Array | null>;
}

export async function runVisionBenchmark(input: RunVisionBenchmarkInput): Promise<VisionBenchmarkReport> {
  const skipped: string[] = [];
  const scored: { actual: DocumentExtraction; expected: VisionBenchmarkExpected }[] = [];
  const perCase: VisionBenchmarkReport['perCase'][number][] = [];

  for (const c of input.cases) {
    const bytes = await input.readImageBytes(c.imagePath);
    if (!bytes) {
      skipped.push(c.id);
      continue;
    }
    const actual = await input.adapter.analyze({
      bytes,
      mimeType: c.mimeType,
      childGrade: c.childGrade,
      kindHint: c.kindHint,
      knownSkillIds: c.knownSkillIds,
    });
    scored.push({ actual, expected: c.expected });
    perCase.push({ id: c.id, overallConfidence: actual.overallConfidence, itemCount: actual.items.length });
  }

  return {
    benchmarkVersion: VISION_BENCHMARK_VERSION,
    timestamp: new Date().toISOString(),
    adapter: {
      name: input.adapter.name,
      provider: input.adapter.provider,
      model: input.adapter.model,
      extractionVersion: input.adapter.extractionVersion,
    },
    requestedCaseCount: input.cases.length,
    skippedMissingImage: skipped,
    ranCaseCount: scored.length,
    metrics: {
      textExtraction: scoreTextExtraction(scored),
      mathExtraction: scoreMathExtraction(scored),
      problemExtraction: scoreProblemExtraction(scored),
      curriculumMapping: scoreCurriculumMapping(scored),
      confidenceCalibration: scoreConfidenceCalibration(scored),
    },
    perCase,
  };
}

export function formatVisionBenchmarkReport(r: VisionBenchmarkReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const line = (label: string, m: VisionMetricScore) => `  ${label.padEnd(24)} ${pct(m.score)}  (n=${m.sampleCount})`;
  return [
    `Document-vision benchmark ${r.benchmarkVersion} — ${r.timestamp}`,
    `  adapter: ${r.adapter.name}/${r.adapter.provider}/${r.adapter.model} (${r.adapter.extractionVersion})`,
    `  cases requested/ran: ${r.requestedCaseCount}/${r.ranCaseCount}`,
    r.skippedMissingImage.length > 0
      ? `  SKIPPED (image not found locally): ${r.skippedMissingImage.join(', ')}`
      : '  skipped: none',
    r.ranCaseCount === 0
      ? '  NO CASES RAN — this is not a 0% accuracy result, it means no dataset images were found. See packages/testing/vision-benchmark-data/README.md.'
      : '',
    'metrics (scored separately — never blended into one "accuracy"):',
    line('text extraction', r.metrics.textExtraction),
    line('math extraction', r.metrics.mathExtraction),
    line('problem extraction', r.metrics.problemExtraction),
    line('curriculum mapping', r.metrics.curriculumMapping),
    line('confidence calibration', r.metrics.confidenceCalibration),
  ]
    .filter((l) => l !== '')
    .join('\n');
}
