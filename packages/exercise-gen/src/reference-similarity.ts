/**
 * Reference-example copy detection (doc 14 C5 §7 / C5.2 §D).
 *
 * DETERMINISTIC, no fuzzy score / tunable threshold:
 *
 *   EXACT — `collapseWhitespace(prompt) === collapseWhitespace(example)`
 *           (byte-identical after trimming + collapsing internal whitespace).
 *           This rate is a HARD GATE — it must be 0.
 *
 *   NEAR  — not EXACT, but `normalize(prompt) === normalize(example)`, where
 *           `normalize` lowercases, replaces every run of digits with `#`, and
 *           replaces every run of non-(letter|digit|`#`) characters with a
 *           single space, then trims. Catches number-only mutations and
 *           casing/punctuation changes of the SAME template. Still exact
 *           equality — on a normalized form — not a similarity heuristic.
 *
 *   NONE  — neither.
 *
 * A short, heavily-templated legitimate question COULD in principle normalize to
 * the same string as a reference example (a real, if low, false-positive risk —
 * see the C5.2 report). The mitigation is that both are compared against the
 * SPECIFIC few examples the generator was shown for this batch, not the whole
 * library.
 */

export type ReferenceCopyKind = 'EXACT' | 'NEAR' | 'NONE';

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export function normalizeForSimilarity(s: string): string {
  return s
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim();
}

export function classifyReferenceCopy(
  prompt: string,
  referenceExamples: readonly { readonly prompt: string }[],
): ReferenceCopyKind {
  const raw = collapseWhitespace(prompt);
  const norm = normalizeForSimilarity(prompt);
  let near = false;
  for (const ex of referenceExamples) {
    if (collapseWhitespace(ex.prompt) === raw) return 'EXACT';
    if (normalizeForSimilarity(ex.prompt) === norm && norm.length > 0) near = true;
  }
  return near ? 'NEAR' : 'NONE';
}
