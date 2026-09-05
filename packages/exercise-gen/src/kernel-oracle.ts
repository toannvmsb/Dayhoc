import type { MathKernel } from '@copilot/domain';

/**
 * Independent oracle (doc 58 §2). Verifies `kernel.expectedAnswer` WITHOUT
 * re-running the generator's own computation — it re-establishes the answer
 * through independent invariants (substitution, inverse relations, conservation
 * laws, cross-multiplication). Kernel correctness must be 100% on the
 * deterministic corpus; any mismatch is P0.
 */

export interface OracleResult {
  readonly ok: boolean;
  readonly invariantsChecked: readonly string[];
  readonly failures: readonly string[];
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** exact rational evaluator for a `canonicalVerificationExpression` — a SECOND,
 *  independent implementation (shunting-yard, not the recursive-descent one). */
function evalExact(expr: string): number | null {
  const src = expr.replace(/×|·/g, '*').replace(/[:÷]/g, '/').replace(/\s+/g, '');
  const out: number[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  let i = 0;
  const apply = (): boolean => {
    const op = ops.pop()!;
    const b = out.pop();
    const a = out.pop();
    if (a === undefined || b === undefined) return false;
    if (op === '+') out.push(a + b);
    else if (op === '-') out.push(a - b);
    else if (op === '*') out.push(a * b);
    else {
      if (b === 0) return false;
      out.push(a / b);
    }
    return true;
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j += 1;
      out.push(Number(src.slice(i, j)));
      i = j;
      continue;
    }
    if (ch === '(') {
      ops.push(ch);
      i += 1;
      continue;
    }
    if (ch === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') if (!apply()) return null;
      ops.pop();
      i += 1;
      continue;
    }
    if (ch === '-' && (i === 0 || '(+-*/'.includes(src[i - 1]!))) {
      // unary minus
      out.push(0);
      ops.push('-');
      i += 1;
      continue;
    }
    if (ch in prec) {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]!]! >= prec[ch]!) {
        if (!apply()) return null;
      }
      ops.push(ch);
      i += 1;
      continue;
    }
    return null; // unexpected char
  }
  while (ops.length) if (!apply()) return null;
  return out.length === 1 ? out[0]! : null;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9;

export function verifyKernelWithOracle(k: MathKernel): OracleResult {
  const checked: string[] = [];
  const failures: string[] = [];
  const role = (n: string): number | undefined => k.semantics.operandRoles[n];
  const expNum = k.expectedAnswer.kind === 'numeric' ? k.expectedAnswer.value : null;

  // universal: an independent re-evaluation of the canonical expression
  if (k.canonicalVerificationExpression && expNum !== null) {
    checked.push('independent_expression_eval');
    const v = evalExact(k.canonicalVerificationExpression);
    if (v === null) failures.push(`could not independently evaluate "${k.canonicalVerificationExpression}"`);
    else if (!near(v, expNum)) failures.push(`independent eval ${v} ≠ expected ${expNum}`);
  }

  switch (k.family) {
    case 'INT_ARITH':
    case 'WORD_1STEP':
    case 'DISTRIBUTIVE':
    case 'PERCENT':
      // covered by the independent expression eval above
      break;

    case 'SUM_DIFF': {
      const S = role('S')!;
      const D = role('D')!;
      const big = expNum!;
      const small = k.intermediateValues.small!;
      checked.push('sum_diff_substitution');
      if (!near(big + small, S)) failures.push(`big + small = ${big + small} ≠ S ${S}`);
      if (!near(big - small, D)) failures.push(`big - small = ${big - small} ≠ D ${D}`);
      if (big <= small) failures.push('larger number is not larger');
      break;
    }

    case 'UNIT_RATE': {
      const n1 = role('n1')!;
      const total1 = role('total1')!;
      const n2 = role('n2')!;
      checked.push('unit_rate_proportion');
      // total1 / n1 must equal expected / n2 (equal rate) — cross-multiply to avoid division
      if (!near(total1 * n2, expNum! * n1)) {
        failures.push(`rate not conserved: ${total1}×${n2} ≠ ${expNum}×${n1}`);
      }
      if (total1 % n1 !== 0) failures.push('unit rate is not an integer');
      break;
    }

    case 'FRACTION_ARITH': {
      const [a, b, c, d] = k.requiredNumbersInPrompt;
      const en = k.expectedAnswer.kind === 'fraction' ? k.expectedAnswer.numerator : NaN;
      const ed = k.expectedAnswer.kind === 'fraction' ? k.expectedAnswer.denominator : NaN;
      checked.push('fraction_cross_multiply', 'fraction_reduced');
      const op = /[+\-*]/.exec(k.canonicalVerificationExpression ?? '+')?.[0] ?? '+';
      // unreduced result via independent computation
      let rn: number;
      let rd: number;
      if (op === '*') {
        rn = a! * c!;
        rd = b! * d!;
      } else if (op === '-') {
        rn = a! * d! - c! * b!;
        rd = b! * d!;
      } else {
        rn = a! * d! + c! * b!;
        rd = b! * d!;
      }
      // en/ed == rn/rd  ⇔  en*rd == ed*rn
      if (!near(en * rd, ed * rn)) failures.push(`fraction value wrong: ${en}/${ed} ≠ ${rn}/${rd}`);
      if (gcd(en, ed) !== 1) failures.push(`fraction not reduced: gcd(${en},${ed}) ≠ 1`);
      if (ed === 0) failures.push('zero denominator');
      break;
    }

    case 'RATIO_SHARE': {
      const total = role('total')!;
      const p1 = role('p1')!;
      const p2 = role('p2')!;
      const p3 = role('p3') ?? 0;
      const unit = k.intermediateValues.unit!;
      const parts = [p1 * unit, p2 * unit, ...(p3 ? [p3 * unit] : [])];
      checked.push('ratio_conservation', 'ratio_proportion');
      if (!near(parts.reduce((s, x) => s + x, 0), total)) {
        failures.push(`sum(parts) ${parts.reduce((s, x) => s + x, 0)} ≠ total ${total}`);
      }
      // part1 / p1 == part2 / p2  (cross-multiply)
      if (!near(parts[0]! * p2, parts[1]! * p1)) failures.push('parts not proportional to the ratio');
      if (!near(expNum!, parts[0]!)) failures.push(`expected ${expNum} ≠ first part ${parts[0]}`);
      if (total % (p1 + p2 + p3) !== 0) failures.push('ratio share is not an integer');
      break;
    }

    case 'LINEAR_EQ': {
      const a = role('a')!;
      const b = role('b')!;
      const c = role('c')!;
      checked.push('equation_substitution');
      // substitute x back into the ORIGINAL equation a·x + b = c
      if (!near(a * expNum! + b, c)) failures.push(`substitution fails: ${a}×${expNum} + ${b} ≠ ${c}`);
      if (a === 0) failures.push('coefficient a is zero');
      break;
    }

    case 'ANGLE_SUM': {
      const A = role('A')!;
      const B = role('B')!;
      const C = expNum ?? NaN;
      checked.push('angle_sum_180');
      if (!near(A + B + C, 180)) failures.push(`A + B + C = ${A + B + C} ≠ 180`);
      if (C <= 0 || C >= 180) failures.push('third angle out of (0, 180)');
      break;
    }

    case 'ANGLE_TYPE': {
      const deg = role('deg')!;
      const correct = k.expectedAnswer.kind === 'choice' ? k.expectedAnswer.correct : '';
      checked.push('angle_classification_rule');
      const expectLabel =
        deg < 90 ? 'góc nhọn' : deg === 90 ? 'góc vuông' : deg < 180 ? 'góc tù' : 'góc bẹt';
      if (correct !== expectLabel) failures.push(`${deg}° → "${correct}" but rule says "${expectLabel}"`);
      break;
    }

    case 'UNIT_CONVERSION': {
      const x = role('x')!;
      const factor = k.operationGraph[0]?.match(/× (\d+)/)?.[1];
      checked.push('unit_conversion_reversible');
      if (factor) {
        const f = Number(factor);
        if (!near(x * f, expNum!)) failures.push(`${x} × ${f} ≠ ${expNum}`);
        if (!near(expNum! / f, x)) failures.push(`reverse conversion ${expNum} / ${f} ≠ ${x}`);
      }
      break;
    }

    case 'RECT_GEOMETRY': {
      const L = role('length')!;
      const W = role('width')!;
      checked.push('geometry_formula', 'geometry_inverse');
      if (k.units === 'cm²') {
        if (!near(L * W, expNum!)) failures.push(`area ${L}×${W} ≠ ${expNum}`);
        if (!near(expNum! / L, W)) failures.push(`inverse: ${expNum} / ${L} ≠ ${W}`);
      } else {
        if (!near(2 * L + 2 * W, expNum!)) failures.push(`perimeter 2×${L}+2×${W} ≠ ${expNum}`);
        if (!near(expNum! / 2 - L, W)) failures.push(`inverse: ${expNum}/2 - ${L} ≠ ${W}`);
      }
      break;
    }

    case 'WORD_2STEP': {
      const a = role('a')!;
      const b = role('b')!;
      const c = role('c')!;
      const step1 = k.intermediateValues.step1!;
      checked.push('two_step_intermediates');
      if (!near(a + b, step1)) failures.push(`step1 ${a}+${b} ≠ ${step1}`);
      if (!near(step1 * c, expNum!)) failures.push(`step2 ${step1}×${c} ≠ ${expNum}`);
      if (!near(expNum! / c, step1)) failures.push(`inverse: ${expNum} / ${c} ≠ ${step1}`);
      break;
    }
  }

  // integer-result constraint
  if (k.constraints.integerResult && expNum !== null && !Number.isInteger(expNum)) {
    checked.push('integer_result_constraint');
    failures.push(`integerResult required but expected answer ${expNum} is not an integer`);
  }

  return { ok: failures.length === 0, invariantsChecked: [...new Set(checked)], failures };
}
