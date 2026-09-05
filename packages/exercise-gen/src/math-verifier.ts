import type { AnswerSpec } from '@copilot/domain';

/**
 * A DELIBERATELY NARROW deterministic correctness verifier (doc 14 C5.1 §2).
 * NOT a CAS. It only handles problems whose entire mathematical content is a
 * single closed arithmetic expression it can extract with high confidence:
 *   integer / decimal / fraction arithmetic, `+ - × · * / :` and parentheses.
 * Everything else → `UNSUPPORTED` (→ AI_CROSSCHECK_REQUIRED). It NEVER guesses:
 * an unparseable problem is unsupported, not "assumed correct".
 *
 * All arithmetic is exact (bigint rationals) — no float rounding error.
 */

export type MathVerdict = 'CORRECT' | 'INCORRECT' | 'UNSUPPORTED';

export interface MathVerification {
  readonly verdict: MathVerdict;
  /** The expression the verifier extracted and evaluated, when supported. */
  readonly expression: string | null;
  /** The value the verifier computed, as a decimal string, when supported. */
  readonly computed: string | null;
  readonly detail: string;
}

const UNSUPPORTED = (detail: string): MathVerification => ({ verdict: 'UNSUPPORTED', expression: null, computed: null, detail });

/**
 * Verify one generated item's answer against an independently computed result.
 * `prompt` + `workedSolution` are scanned for the closed expression.
 */
export function verifyMathAnswer(item: { prompt: string; workedSolution: string; answerSpec: AnswerSpec }): MathVerification {
  if (item.answerSpec.kind === 'reasoning') return UNSUPPORTED('reasoning items have no single checkable answer');

  const expr = extractExpression(item.prompt);
  if (!expr) return UNSUPPORTED('no single closed arithmetic expression could be extracted from the prompt');

  const value = safeEvaluate(expr);
  if (value === null) return UNSUPPORTED(`expression "${expr}" is not in the supported grammar`);

  const expected = answerAsRational(item.answerSpec);
  if (expected === null) return UNSUPPORTED('answer kind / value is outside the verifier scope');

  const ok =
    item.answerSpec.kind === 'numeric'
      ? Math.abs(ratToNumber(value) - item.answerSpec.value) <= Math.max(item.answerSpec.tolerance, 0)
      : ratEquals(value, expected);

  // `choice` may carry "closest to" / rounding semantics we can't see — so a
  // choice mismatch is UNSUPPORTED (needs a human/AI look), never INCORRECT.
  if (!ok && item.answerSpec.kind === 'choice') {
    return UNSUPPORTED(`choice answer ${item.answerSpec.correct} != computed ${ratToDecimalString(value)} — could be a "closest to" question; not deciding`);
  }

  return {
    verdict: ok ? 'CORRECT' : 'INCORRECT',
    expression: expr,
    computed: ratToDecimalString(value),
    detail: ok ? 'independently recomputed and matches' : `independently recomputed as ${ratToDecimalString(value)}, answer key says ${describeAnswer(item.answerSpec)}`,
  };
}

// --- expression extraction (DELIBERATELY conservative — doc 14 C5.1 §5) --------

const MATH_CHARS = /[0-9+\-*/×·().\s]/; // note: `:` and `,` handled explicitly below
// `:` is SGK division notation — a valid operator here (safeEvaluate maps it to `/`).
const HAS_OP = /[+\-*/×·:]/;
const HAS_DIGIT = /[0-9]/;
/** Anything estimation-flavoured is NOT an exact computation — never touch it. */
const ESTIMATION_RE = /ước\s*lượng|làm\s*tròn|gần|khoảng|xấp\s*xỉ|chừng|độ\s+lớn|approx/i;
/** A blank / fill-in marker anywhere makes it an equation to solve, not to compute. */
const BLANK_RE = /[?_…]|\.\.\.|\bx\b|\by\b|điền|thích\s+hợp/i;

function preNormalize(prompt: string): string {
  return prompt
    .replace(/[−–—]/g, '-') // U+2212 / en / em dash → ASCII hyphen
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the closed arithmetic expression ONLY when the prompt is essentially
 * just that expression. Any estimation wording, any blank marker, any leftover
 * prose of mathematical consequence → give up (→ UNSUPPORTED, never a guess).
 */
function extractExpression(prompt: string): string | null {
  const normalized = preNormalize(prompt);
  if (ESTIMATION_RE.test(normalized)) return null;

  // strip a single trailing "= ?" / "=" and a trailing period
  const body = normalized.replace(/\s*=\s*\??\s*\.?\s*$/, '').trim();

  // "Tính[:] <expr>" / "Tính giá trị (của) [biểu thức] <expr>" / "Tính nhanh …" /
  // "Thực hiện phép tính …" / "Kết quả của (phép tính) …" — lead phrase, then ONLY the expression.
  const lead =
    /^(?:tính(?:\s+nhanh|\s+nhẩm)?(?:\s+giá\s+trị)?(?:\s+của)?(?:\s+biểu\s+thức)?|thực\s+hiện(?:\s+phép\s+tính)?|kết\s+quả\s+của(?:\s+phép\s+tính)?)\s*:?\s*(.+)$/i.exec(
      body,
    );
  const candidate = (lead ? lead[1]! : body).trim();

  if (BLANK_RE.test(candidate)) return null;
  if (!isCleanRun(candidate)) return null;
  if (!HAS_OP.test(candidate) || !HAS_DIGIT.test(candidate)) return null;
  return candidate;
}

/** The run must be ONLY maths — any letter/word means it's a word problem. */
function isCleanRun(s: string): boolean {
  const t = s.trim();
  if (t.length === 0 || t.length > 80) return false;
  for (const ch of t) {
    if (ch === ':' || ch === ',' || ch === '/') continue; // divide / decimal-comma / fraction slash
    if (!MATH_CHARS.test(ch)) return false;
  }
  return HAS_DIGIT.test(t);
}

// --- exact rational evaluator ----------------------------------------------

interface Rat {
  n: bigint;
  d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}
function norm(n: bigint, d: bigint): Rat {
  if (d === 0n) throw new Error('division by zero');
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a: Rat, b: Rat): Rat => norm(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a: Rat, b: Rat): Rat => norm(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Rat, b: Rat): Rat => norm(a.n * b.n, a.d * b.d);
const div = (a: Rat, b: Rat): Rat => norm(a.n * b.d, a.d * b.n);
function ratEquals(a: Rat, b: Rat): boolean {
  const x = norm(a.n, a.d);
  const y = norm(b.n, b.d);
  return x.n === y.n && x.d === y.d;
}
function ratToNumber(r: Rat): number {
  return Number(r.n) / Number(r.d);
}
function ratToDecimalString(r: Rat): string {
  const x = norm(r.n, r.d);
  if (x.d === 1n) return x.n.toString();
  const neg = x.n < 0n;
  let n = neg ? -x.n : x.n;
  const whole = n / x.d;
  n = (n % x.d) * 10_000_000n;
  const frac = (n / x.d).toString().padStart(7, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

/** Recursive-descent over `+ - * /` with `×·` = *, `:` = /, unary minus, parens. */
function safeEvaluate(raw: string): Rat | null {
  const src = raw.replace(/×|·/g, '*').replace(/:/g, '/').replace(/\s+/g, '');
  let i = 0;

  const peek = (): string => src[i] ?? '';
  const eof = (): boolean => i >= src.length;

  function number(): Rat | null {
    let start = i;
    while (/[0-9]/.test(peek())) i++;
    // decimal — accept `.` or `,` as the point, once
    if (peek() === '.' || peek() === ',') {
      i++;
      while (/[0-9]/.test(peek())) i++;
    }
    if (i === start) return null;
    const lit = src.slice(start, i).replace(',', '.');
    if (lit === '.' || lit === '') return null;
    if (lit.includes('.')) {
      const [w, f = ''] = lit.split('.');
      const denom = 10n ** BigInt(f.length);
      return norm(BigInt(w || '0') * denom + BigInt(f || '0'), denom);
    }
    return norm(BigInt(lit), 1n);
  }

  function factor(): Rat | null {
    if (peek() === '(') {
      i++;
      const e = expr();
      if (peek() !== ')') return null;
      i++;
      return e;
    }
    if (peek() === '-') {
      i++;
      const f = factor();
      return f === null ? null : mul(f, norm(-1n, 1n));
    }
    if (peek() === '+') {
      i++;
      return factor();
    }
    return number();
  }

  function term(): Rat | null {
    let a = factor();
    if (a === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = src[i++]!;
      const b = factor();
      if (b === null) return null;
      try {
        a = op === '*' ? mul(a, b) : div(a, b);
      } catch {
        return null;
      }
    }
    return a;
  }

  function expr(): Rat | null {
    let a = term();
    if (a === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = src[i++]!;
      const b = term();
      if (b === null) return null;
      a = op === '+' ? add(a, b) : sub(a, b);
    }
    return a;
  }

  try {
    const result = expr();
    return result !== null && eof() ? result : null;
  } catch {
    return null;
  }
}

// --- answer parsing --------------------------------------------------------

function answerAsRational(a: AnswerSpec): Rat | null {
  switch (a.kind) {
    case 'numeric':
      return Number.isFinite(a.value) ? decimalToRat(a.value) : null;
    case 'fraction':
      return a.denominator !== 0 ? norm(BigInt(Math.trunc(a.numerator)), BigInt(Math.trunc(a.denominator))) : null;
    case 'exact':
      return stringToRat(a.value);
    case 'choice':
      return a.options.includes(a.correct) ? stringToRat(a.correct) : null;
    default:
      return null;
  }
}

function decimalToRat(x: number): Rat {
  if (Number.isInteger(x)) return norm(BigInt(x), 1n);
  const s = x.toString();
  const [w, f = ''] = s.replace('-', '').split('.');
  const denom = 10n ** BigInt(f.length);
  const n = BigInt(w || '0') * denom + BigInt(f || '0');
  return norm(x < 0 ? -n : n, denom);
}

function stringToRat(s: string): Rat | null {
  const t = s.trim().replace(/\s+/g, '');
  const frac = /^(-?\d+)\/(-?\d+)$/.exec(t);
  if (frac) {
    const d = BigInt(frac[2]!);
    return d === 0n ? null : norm(BigInt(frac[1]!), d);
  }
  if (/^-?\d+([.,]\d+)?$/.test(t)) return decimalToRat(Number(t.replace(',', '.')));
  return null;
}

function describeAnswer(a: AnswerSpec): string {
  switch (a.kind) {
    case 'numeric':
      return String(a.value);
    case 'fraction':
      return `${a.numerator}/${a.denominator}`;
    case 'exact':
      return a.value;
    case 'choice':
      return a.correct;
    default:
      return a.kind;
  }
}
