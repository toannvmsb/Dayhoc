import type { MathKernel, SemanticVerdict } from '@copilot/domain';

/**
 * Bounded, deterministic Vietnamese semantic normalization (doc 62 §2).
 *
 * NOT NLP. A small fixed set of equivalences used to reconcile a kernel fact
 * with valid prose that expresses it differently — number words, "gấp N lần",
 * signed language, word-problem equation forms. Every pattern here is covered by
 * an explicit test. When a pattern does not apply the answer is UNKNOWN, never a
 * silent PASS.
 */

export const SEMANTIC_NORMALIZER_VERSION = 'semantic-normalizer.v1';

/** một … hai mươi (enough for pilot grade-4/7 coefficients & counts). */
export const VIET_NUMBER_WORDS: Record<string, number> = {
  'một': 1, 'mốt': 1,
  'hai': 2,
  'ba': 3,
  'bốn': 4, 'tư': 4,
  'năm': 5, 'lăm': 5,
  'sáu': 6,
  'bảy': 7, 'bẩy': 7,
  'tám': 8,
  'chín': 9,
  'mười': 10,
  'mười một': 11, 'mười hai': 12, 'mười ba': 13, 'mười bốn': 14, 'mười lăm': 15,
  'mười sáu': 16, 'mười bảy': 17, 'mười tám': 18, 'mười chín': 19,
  'hai mươi': 20,
};

/** multiplicative phrases: "gấp đôi" → 2, "gấp ba" → 3, "gấp 5 lần" → 5, "gấp năm lần" → 5 */
export function multiplierPhrases(text: string): number[] {
  const t = text.toLowerCase();
  const out: number[] = [];
  if (/gấp\s+đôi/.test(t)) out.push(2);
  if (/gấp\s+ba/.test(t)) out.push(3);
  for (const m of t.matchAll(/gấp\s+(\d+)\s*lần/g)) out.push(Number(m[1]));
  for (const m of t.matchAll(/gấp\s+([a-zà-ỹ]+)\s*lần/g)) {
    const v = VIET_NUMBER_WORDS[m[1]!];
    if (v) out.push(v);
  }
  return out;
}

/** "một nửa" → ÷2, "một phần ba" → ÷3, … (division-by phrases) */
export function fractionPhraseDivisors(text: string): number[] {
  const t = text.toLowerCase();
  const out: number[] = [];
  if (/một\s+nửa|1\/2/.test(t)) out.push(2);
  for (const m of t.matchAll(/một\s+phần\s+([a-zà-ỹ]+)/g)) {
    const v = VIET_NUMBER_WORDS[m[1]!];
    if (v && v >= 2) out.push(v);
  }
  return out;
}

/** every distinct number a text states as DIGITS (ints + decimals, keeps sign). */
function digitNumbers(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/-?\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(',', '.'));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

/** every small integer a text states as a NUMBER WORD ("hai" → 2). */
export function wordNumbers(text: string): Set<number> {
  const out = new Set<number>();
  const t = ` ${text.toLowerCase()} `;
  // multi-word first (longest match), then single
  for (const [w, v] of Object.entries(VIET_NUMBER_WORDS)) {
    const re = new RegExp(`(?<![a-zà-ỹ])${w.replace(/\s+/g, '\\s+')}(?![a-zà-ỹ])`, 'i');
    if (re.test(t)) out.add(v);
  }
  return out;
}

const SIGNED_DOWN_RE = /giảm|bớt|ít hơn|trừ đi|trừ|hụt|thiếu|loại bỏ|loại đi|hỏng|lỗi/i;

/**
 * Is the kernel's required number `n` recoverable from the prose by a bounded
 * equivalence? Digits, number words, signed-down language for a negative, a
 * multiplier phrase for a small coefficient.
 */
export function numberPresent(n: number, prompt: string, solution = ''): boolean {
  const hay = `${prompt}\n${solution}`;
  const digits = digitNumbers(hay);
  if (digits.has(n)) return true;

  const abs = Math.abs(n);
  const words = wordNumbers(hay);

  // number word (e.g. kernel needs 2, prose says "Hai hộp")
  if (words.has(abs)) return true;
  if (digits.has(abs) && n < 0 && SIGNED_DOWN_RE.test(hay)) return true; // "-14" ↔ "giảm 14"
  if (words.has(abs) && n < 0 && SIGNED_DOWN_RE.test(hay)) return true;

  // small coefficient expressed multiplicatively ("gấp đôi" ⇒ 2, "gấp 3 lần" ⇒ 3)
  if (abs >= 2 && abs <= 20 && multiplierPhrases(hay).includes(abs)) return true;
  if (abs >= 2 && abs <= 20 && fractionPhraseDivisors(hay).includes(abs)) return true;

  return false;
}

/**
 * Reconcile a KERNEL_NUMBER_DROPPED finding. `missing` are the numbers the raw
 * digit check could not find. Returns which are actually recoverable.
 */
export function reconcileNumberDrop(
  missing: readonly number[],
  prompt: string,
  solution: string,
): { resolved: number[]; stillMissing: number[] } {
  const resolved: number[] = [];
  const stillMissing: number[] = [];
  for (const n of missing) {
    if (numberPresent(n, prompt, solution)) resolved.push(n);
    else stillMissing.push(n);
  }
  return { resolved, stillMissing };
}

/** parse `<a>x <±> <b> = <c>` style equations out of a worked solution. */
function equationsIn(text: string): Array<{ a: number; b: number; c: number }> {
  const out: Array<{ a: number; b: number; c: number }> = [];
  const t = text.replace(/−/g, '-').replace(/\s+/g, ' ');
  // a x + b = c   |   a x - b = c   |   x + b = c (a=1)   |   a(x - b) = c
  for (const m of t.matchAll(/(\d*)\s*[.*·]?\s*x\s*([+-])\s*\(?\s*(\d+)\s*\)?\s*=\s*(-?\d+)/g)) {
    const a = m[1] ? Number(m[1]) : 1;
    const sign = m[2] === '-' ? -1 : 1;
    out.push({ a, b: sign * Number(m[3]), c: Number(m[4]) });
  }
  for (const m of t.matchAll(/(\d+)\s*\(\s*x\s*([+-])\s*(\d+)\s*\)\s*=\s*(-?\d+)/g)) {
    const a = Number(m[1]);
    const sign = m[2] === '-' ? -1 : 1;
    // a(x + k) = c  ⇒  a·x + a·k = c
    out.push({ a, b: sign * a * Number(m[3]), c: Number(m[4]) });
  }
  return out;
}

/** the final "x = <v>" the solution concludes, if any. */
export function statedUnknown(solution: string): number | null {
  const t = solution.replace(/−/g, '-');
  const all = [...t.matchAll(/x\s*=\s*(-?\d+(?:[.,]\d+)?)/g)];
  const last = all.at(-1)?.[1];
  if (last == null) return null;
  const v = Number(last.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/**
 * Reconcile a SEMANTIC_STRUCTURE_MISMATCH on a SOLVE_EQUATION kernel realized as
 * a word problem. PASS when the worked solution sets up an equation equivalent to
 * the kernel (or reaches the kernel's x). FAIL when it sets up a *different*
 * equation that yields a different x. UNKNOWN otherwise.
 */
export function reconcileEquationForm(solution: string, kernel: MathKernel): SemanticVerdict {
  if (kernel.expectedAnswer.kind !== 'numeric') return 'UNKNOWN';
  const wantX = kernel.expectedAnswer.value;
  const a = kernel.semantics.operandRoles.a;
  const b = kernel.semantics.operandRoles.b;
  const c = kernel.semantics.operandRoles.c;

  const eqs = equationsIn(solution);
  if (eqs.length > 0 && a != null && b != null && c != null) {
    for (const e of eqs) {
      // same equation (allow the constant to be written on either side / sign)
      const sameCoeff = e.a === a;
      const solvesTo = e.a !== 0 ? (e.c - e.b) / e.a : NaN;
      if (sameCoeff && Number.isFinite(solvesTo) && Math.abs(solvesTo - wantX) < 1e-9) return 'PASS';
    }
    // an equation is present but none matches and at least one solves elsewhere
    const anyConflicting = eqs.some((e) => {
      const s = e.a !== 0 ? (e.c - e.b) / e.a : NaN;
      return Number.isFinite(s) && Math.abs(s - wantX) > 1e-9;
    });
    if (anyConflicting) return 'FAIL';
  }

  // no parseable equation — did the solution at least reach the kernel's x?
  const got = statedUnknown(solution);
  if (got != null && Math.abs(got - wantX) < 1e-9) return 'PASS';
  if (got != null && Math.abs(got - wantX) > 1e-9) return 'FAIL';
  return 'UNKNOWN';
}

const STRUCTURAL_COUNT_RE = /(\d+)\s*(phần|nhóm|đội|tổ|hàng|cột|đoạn|khúc|phần bằng nhau|nhóm bằng nhau)/gi;

/**
 * Reconcile an OPERAND_MUTATION finding. PASS when the answer value coincides
 * with a STRUCTURAL count already in the prompt (number of parts / groups), i.e.
 * it is not leaked answer data. FAIL when the value has no such explanation.
 */
export function reconcileOperandCollision(answerValue: number, prompt: string): SemanticVerdict {
  for (const m of prompt.matchAll(STRUCTURAL_COUNT_RE)) {
    if (Number(m[1]) === answerValue) return 'PASS';
  }
  // number words too ("chia thành ba phần")
  const wt = prompt.toLowerCase();
  for (const [w, v] of Object.entries(VIET_NUMBER_WORDS)) {
    if (v === answerValue && new RegExp(`${w.replace(/\s+/g, '\\s+')}\\s+(phần|nhóm|đội|tổ)`).test(wt)) return 'PASS';
  }
  return 'FAIL';
}
