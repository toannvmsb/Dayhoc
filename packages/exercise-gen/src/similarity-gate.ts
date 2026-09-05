import { collapseWhitespace, normalizeForSimilarity } from './reference-similarity.js';
import { extractNumbers, extractProperNouns, templateSkeleton } from './problem-dna.js';

/**
 * Deterministic similarity / leakage gate (doc 56 §6). Model-INDEPENDENT: a
 * generated prompt is compared against the reference examples it was grounded
 * on, the other items already accepted in the same worksheet, and (optionally)
 * recently generated items. Multiple signals, conservative thresholds. No
 * tunable knob is exposed to the model or the prompt.
 */

export type SimilarityVerdict = 'PASS' | 'NEAR' | 'COPY';

export interface SimilaritySignal {
  readonly name:
    | 'exact_copy'
    | 'near_copy'
    | 'template_match'
    | 'token_jaccard'
    | 'trigram_dice'
    | 'number_tuple_identical'
    | 'proper_noun_overlap';
  readonly value: number; // 0..1 (1 for the boolean signals when they fire)
  readonly verdict: SimilarityVerdict;
  readonly against: 'reference' | 'worksheet_sibling' | 'recent_item';
  readonly otherRef: string; // an id / short label of the compared text
}

export interface SimilarityReport {
  readonly verdict: SimilarityVerdict;
  readonly signals: readonly SimilaritySignal[];
  /** The single worst signal, for a deterministic regeneration instruction. */
  readonly worst: SimilaritySignal | null;
}

export interface SimilarityComparand {
  readonly id: string;
  readonly prompt: string;
}

export interface SimilarityGateInput {
  readonly prompt: string;
  readonly references: readonly SimilarityComparand[];
  readonly worksheetSiblings: readonly SimilarityComparand[];
  readonly recentItems?: readonly SimilarityComparand[];
  /**
   * Number multisets that must NOT be reproduced exactly (from ProblemDNA
   * `forbiddenSimilarities.numberTuples`). A generated prompt whose sorted
   * number multiset matches one of these is a COPY, not a coincidence.
   */
  readonly prohibitedNumberTuples?: readonly (readonly number[])[];
}

// --- thresholds (conservative; doc 56 §6) --------------------------------
const T_JACCARD_COPY = 0.7;
const T_JACCARD_NEAR = 0.5;
const T_TRIGRAM_COPY = 0.75;
const T_TRIGRAM_NEAR = 0.6;
const T_PROPER_NOUN_NEAR = 0.6;
/** number tuple identical AND this much lexical overlap → COPY (not coincidence). */
const T_JACCARD_WITH_SAME_NUMBERS = 0.45;

function words(s: string): string[] {
  return normalizeForSimilarity(s)
    .split(/\s+/)
    .filter((w) => w.length > 1 && w !== '#');
}

/** Lexical content words below this → treat the prompt as a bare computation. */
export const CONTENT_WORD_FLOOR = 4;

export function isBareComputation(prompt: string): boolean {
  return words(prompt).length < CONTENT_WORD_FLOOR;
}

/**
 * A normalized signature for the "same question" (uniqueness) check:
 *  - a word problem → digits blanked (catches number-only mutations)
 *  - a bare computation → digits KEPT (the numbers ARE the content, so
 *    "Tính: 10 + 8" and "Tính: 17 × 2" are different questions)
 */
export function promptContentSignature(prompt: string): string {
  return isBareComputation(prompt)
    ? collapseWhitespace(prompt.toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    : normalizeForSimilarity(prompt);
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  return inter / (sa.size + sb.size - inter);
}

function trigrams(s: string): Set<string> {
  const t = normalizeForSimilarity(s).replace(/\s+/g, ' ');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i += 1) out.add(t.slice(i, i + 3));
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

function sameNumberMultiset(a: readonly number[], b: readonly number[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

const rank: Record<SimilarityVerdict, number> = { PASS: 0, NEAR: 1, COPY: 2 };

function compareOne(
  prompt: string,
  other: SimilarityComparand,
  against: SimilaritySignal['against'],
): SimilaritySignal[] {
  const signals: SimilaritySignal[] = [];
  const push = (name: SimilaritySignal['name'], value: number, verdict: SimilarityVerdict): void => {
    signals.push({ name, value, verdict, against, otherRef: other.id });
  };

  if (collapseWhitespace(prompt) === collapseWhitespace(other.prompt)) {
    push('exact_copy', 1, 'COPY');
    return signals; // nothing worse to find
  }

  const w1 = words(prompt);
  const w2 = words(other.prompt);
  // Below a lexical-content floor (e.g. a bare "Tính: a + b = ?"), the
  // structural signals are meaningless — a worksheet legitimately has many
  // short computation prompts. Compare content signatures (numbers kept) +
  // number tuples only.
  if (Math.min(w1.length, w2.length) < CONTENT_WORD_FLOOR) {
    if (promptContentSignature(prompt) === promptContentSignature(other.prompt)) push('near_copy', 1, 'COPY');
    else if (sameNumberMultiset(extractNumbers(prompt), extractNumbers(other.prompt))) {
      push('number_tuple_identical', 1, 'COPY');
    }
    return signals;
  }

  if (normalizeForSimilarity(prompt) === normalizeForSimilarity(other.prompt)) push('near_copy', 1, 'COPY');
  if (templateSkeleton(prompt) === templateSkeleton(other.prompt) && templateSkeleton(prompt).length > 0) {
    push('template_match', 1, 'COPY');
  }

  const j = jaccard(w1, w2);
  if (j >= T_JACCARD_COPY) push('token_jaccard', j, 'COPY');
  else if (j >= T_JACCARD_NEAR) push('token_jaccard', j, 'NEAR');

  const d = dice(trigrams(prompt), trigrams(other.prompt));
  if (d >= T_TRIGRAM_COPY) push('trigram_dice', d, 'COPY');
  else if (d >= T_TRIGRAM_NEAR) push('trigram_dice', d, 'NEAR');

  const sameNums = sameNumberMultiset(extractNumbers(prompt), extractNumbers(other.prompt));
  if (sameNums) {
    if (j >= T_JACCARD_WITH_SAME_NUMBERS) push('number_tuple_identical', 1, 'COPY');
    else push('number_tuple_identical', 1, 'NEAR');
  }

  const pn = jaccard(extractProperNouns(prompt), extractProperNouns(other.prompt));
  if (pn >= T_PROPER_NOUN_NEAR) push('proper_noun_overlap', pn, sameNums ? 'COPY' : 'NEAR');

  return signals;
}

export function checkItemSimilarity(input: SimilarityGateInput): SimilarityReport {
  const signals: SimilaritySignal[] = [];

  for (const ref of input.references) signals.push(...compareOne(input.prompt, ref, 'reference'));
  for (const sib of input.worksheetSiblings) signals.push(...compareOne(input.prompt, sib, 'worksheet_sibling'));
  for (const rec of input.recentItems ?? []) signals.push(...compareOne(input.prompt, rec, 'recent_item'));

  // prohibited number tuples from the DNA — a hard COPY regardless of wording
  const promptNums = extractNumbers(input.prompt);
  for (const tuple of input.prohibitedNumberTuples ?? []) {
    if (sameNumberMultiset(promptNums, tuple)) {
      signals.push({
        name: 'number_tuple_identical',
        value: 1,
        verdict: 'COPY',
        against: 'reference',
        otherRef: 'dna:forbidden-number-tuple',
      });
    }
  }

  const worst =
    signals.length > 0
      ? [...signals].sort((a, b) => rank[b.verdict] - rank[a.verdict] || b.value - a.value)[0]!
      : null;

  return {
    verdict: worst?.verdict ?? 'PASS',
    signals,
    worst,
  };
}

/** A deterministic, generator-facing instruction for a failed similarity gate. */
export function similarityRegenerationInstruction(worst: SimilaritySignal | null): string {
  switch (worst?.name) {
    case 'exact_copy':
    case 'near_copy':
    case 'template_match':
      return 'Viết lại với cấu trúc câu và bối cảnh HOÀN TOÀN khác — không được lặp lại khung đề đã có, kể cả khi đổi số.';
    case 'number_tuple_identical':
      return 'Dùng bộ số liệu khác hẳn — không lặp lại đúng các con số đã xuất hiện ở đề tham chiếu hoặc ở câu khác trong phiếu.';
    case 'proper_noun_overlap':
      return 'Đổi nhân vật, địa điểm và bối cảnh sang một tình huống thực tế khác.';
    case 'token_jaccard':
    case 'trigram_dice':
      return 'Diễn đạt lại bằng một tình huống thực tế khác hẳn; tránh dùng lại cùng cụm từ và cùng kiểu câu.';
    default:
      return 'Viết một đề mới, độc lập với mọi đề tham chiếu và mọi câu khác trong phiếu.';
  }
}
