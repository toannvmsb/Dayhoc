import { createHash } from 'node:crypto';
import {
  KNOWLEDGE_LEVELS,
  MATH_KERNEL_GROUP,
  type AnswerKind,
  type ItemGenerationSpec,
  type KernelAnswer,
  type KernelSemantics,
  type MathKernel,
  type MathKernelFamily,
  type MathKernelResult,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

export const MATH_KERNEL_BUILDER_VERSION = 'math-kernel.v1';

// --- deterministic RNG (mulberry32) -------------------------------------
function seedFrom(...parts: string[]): number {
  const h = createHash('sha256').update(parts.join('')).digest();
  return h.readUInt32LE(0);
}
class Rng {
  #s: number;
  constructor(seed: number) {
    this.#s = seed >>> 0;
  }
  next(): number {
    this.#s |= 0;
    this.#s = (this.#s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.#s ^ (this.#s >>> 15), 1 | this.#s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)]!;
  }
}

const kIdx = (k: string): number => KNOWLEDGE_LEVELS.indexOf(k as never);

// --- family resolution -------------------------------------------------

const NAME_ANGLE_SUM = /tổng .*góc .*tam giác|góc trong tam giác/i;
const NAME_ANGLE_TYPE = /góc (nhọn|tù|bẹt|vuông)|nhọn.*tù.*bẹt/i;
const NAME_FRACTION = /phân số|số hữu tỉ|hữu tỉ/i;
const NAME_RATIO = /tỉ số|tỉ lệ|dãy tỉ số/i;
const NAME_LINEAR_EQ = /phương trình|chuyển vế|tìm x/i;
const NAME_DISTRIBUTIVE = /phân phối|nhân một số với (một )?tổng/i;
const NAME_SUM_DIFF = /tổng và hiệu|tổng.*hiệu/i;
const NAME_UNIT_RATE = /rút về đơn vị|đơn vị|tỉ lệ (thuận|nghịch)/i;
const NAME_PERCENT = /phần trăm|%/i;
const NAME_UNIT_CONV = /đổi đơn vị|đơn vị đo/i;
const NAME_RECT = /chu vi|diện tích|hình chữ nhật/i;

/**
 * Which `MathKernelFamily` (if any) covers this deterministic item. Reasoning
 * structures are never kernel-covered. A pure function of the item spec + KB.
 */
export function resolveMathFamily(itemSpec: ItemGenerationSpec, kb: KnowledgeBase): MathKernelFamily | null {
  if (
    itemSpec.problemStructure === 'explain_or_justify' ||
    itemSpec.problemStructure === 'find_the_error' ||
    itemSpec.problemStructure === 'construct_an_example'
  ) {
    return null;
  }
  const skill = kb.skills.get(itemSpec.skillId);
  const name = skill?.name ?? '';
  const ptName =
    (itemSpec.problemTypeId && kb.problemTypes.find((p) => p.id === itemSpec.problemTypeId)?.name) || '';
  const hay = `${name} ${ptName}`;
  const dom = itemSpec.domain;

  if (NAME_ANGLE_SUM.test(hay)) return 'ANGLE_SUM';
  if (NAME_ANGLE_TYPE.test(hay) && itemSpec.answerKind === 'choice') return 'ANGLE_TYPE';
  if (NAME_UNIT_CONV.test(hay) || (dom === 'measurement' && /đổi|chuyển/.test(hay))) return 'UNIT_CONVERSION';
  if (NAME_RECT.test(hay)) return 'RECT_GEOMETRY';
  if (NAME_PERCENT.test(hay)) return 'PERCENT';
  if (NAME_DISTRIBUTIVE.test(hay)) return 'DISTRIBUTIVE';
  if (NAME_SUM_DIFF.test(hay)) return 'SUM_DIFF';
  if (NAME_UNIT_RATE.test(hay)) return 'UNIT_RATE';
  if (NAME_LINEAR_EQ.test(hay) && itemSpec.problemStructure !== 'multi_step_word_problem') return 'LINEAR_EQ';
  if ((NAME_RATIO.test(hay) || dom === 'algebraic_thinking') && /tỉ số|tỉ lệ/.test(hay)) return 'RATIO_SHARE';
  if (itemSpec.answerKind === 'fraction') return 'FRACTION_ARITH';
  if (dom === 'fractions' && NAME_FRACTION.test(hay)) return 'FRACTION_ARITH';

  // fall back by problem structure for plain numeric arithmetic
  if (itemSpec.answerKind === 'numeric') {
    if (itemSpec.problemStructure === 'direct_computation') return 'INT_ARITH';
    if (itemSpec.problemStructure === 'single_step_word_problem') return 'WORD_1STEP';
    if (itemSpec.problemStructure === 'multi_step_word_problem') return 'WORD_2STEP';
    if (itemSpec.problemStructure === 'work_backwards') return 'LINEAR_EQ';
    if (itemSpec.problemStructure === 'compare_and_decide') return 'WORD_1STEP';
  }
  return null;
}

// --- helpers ----------------------------------------------------------

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
function simplify(n: number, d: number): { numerator: number; denominator: number } {
  const g = gcd(n, d);
  const sign = d < 0 ? -1 : 1;
  return { numerator: (sign * n) / g, denominator: (sign * d) / g };
}
function tupleKey(ns: readonly number[]): string {
  return [...ns].sort((a, b) => a - b).join(',');
}
function hashKernel(k: Omit<MathKernel, 'kernelHash'>): string {
  return createHash('sha256').update(JSON.stringify(k)).digest('hex').slice(0, 16);
}

export interface KernelGenContext {
  readonly forbiddenNumberTuples?: readonly (readonly number[])[];
  readonly recentNumberTuples?: readonly (readonly number[])[];
}

interface Built {
  readonly answerKind: AnswerKind;
  readonly operands: MathKernel['operands'];
  readonly operationGraph: readonly string[];
  readonly intermediateValues: Record<string, number>;
  readonly expectedAnswer: KernelAnswer;
  readonly canonicalVerificationExpression: string | null;
  readonly units: string | null;
  readonly requiredNumbersInPrompt: readonly number[];
  readonly integerResult: boolean;
  readonly fractionSimplified: boolean;
  readonly solutionOutline: string;
}

type FamilyGen = (spec: ItemGenerationSpec, rng: Rng) => Built | { unsupported: string };

// --- operation semantics (doc 58 §3) — derived centrally per family ------

const OP_KEYWORD = {
  ADDITION: /\+/,
  SUBTRACTION: /(?<![(])\s-\s|−/,
  MULTIPLICATION: /×|\*/,
  DIVISION: /:|÷|\//,
} as const;

/** operation of a single closed expression (INT_ARITH / WORD_1STEP). */
function operationOfExpr(expr: string): KernelSemantics['operation'] {
  const hasParen = /[()]/.test(expr);
  const ops = [
    OP_KEYWORD.ADDITION.test(expr),
    /\s-\s/.test(expr),
    OP_KEYWORD.MULTIPLICATION.test(expr),
    OP_KEYWORD.DIVISION.test(expr),
  ];
  const count = ops.filter(Boolean).length;
  if (hasParen || count > 1) return 'MIXED';
  if (ops[3]) return 'DIVISION';
  if (ops[2]) return 'MULTIPLICATION';
  if (ops[1]) return 'SUBTRACTION';
  return 'ADDITION';
}

function deriveSemantics(family: MathKernelFamily, b: Built): KernelSemantics {
  const roleFrom = (names: readonly string[]): Record<string, number> =>
    Object.fromEntries(
      b.operands.filter((o) => (names as readonly string[]).includes(o.name)).map((o) => [o.name, o.value]),
    );
  const roles = (m: Record<string, number>): Record<string, number> => m;

  switch (family) {
    case 'INT_ARITH':
    case 'WORD_1STEP': {
      const op = operationOfExpr(b.canonicalVerificationExpression ?? '+');
      const [a, bb] = b.requiredNumbersInPrompt;
      return {
        operation: op,
        scenarioType:
          family === 'INT_ARITH'
            ? 'CLOSED_EXPRESSION'
            : op === 'ADDITION'
              ? 'COMBINE'
              : op === 'SUBTRACTION'
                ? 'REMOVE'
                : 'SCALING',
        operandRoles: roles({ first: a ?? 0, second: bb ?? 0 }),
        askedQuantityRole: 'result',
      };
    }
    case 'DISTRIBUTIVE':
      return {
        operation: 'MIXED',
        scenarioType: 'CLOSED_EXPRESSION',
        operandRoles: roleFrom(['a', 'b', 'c']),
        askedQuantityRole: 'result',
      };
    case 'SUM_DIFF':
      return {
        operation: 'MIXED',
        scenarioType: 'FIND_UNKNOWN',
        operandRoles: roleFrom(['S', 'D']),
        askedQuantityRole: 'largerNumber',
      };
    case 'UNIT_RATE':
      return {
        operation: 'MIXED',
        scenarioType: 'RATE',
        operandRoles: roleFrom(['n1', 'total1', 'n2']),
        askedQuantityRole: 'totalForSecondCount',
      };
    case 'FRACTION_ARITH': {
      // strip `a/b` fraction literals first — their `/` is NOT a division
      // operator, and leaving them in makes every fraction expression look MIXED.
      const bare = (b.canonicalVerificationExpression ?? '+').replace(/\d+\s*\/\s*\d+/g, '#');
      const op = operationOfExpr(bare);
      return {
        operation: op === 'MIXED' ? 'ADDITION' : op,
        scenarioType: 'CLOSED_EXPRESSION',
        operandRoles: roleFrom(['a', 'b', 'c', 'd']),
        askedQuantityRole: 'resultFraction',
      };
    }
    case 'RATIO_SHARE':
      return {
        operation: 'PROPORTION',
        scenarioType: 'EQUAL_SHARING',
        operandRoles: roleFrom(['total', 'p1', 'p2', 'p3']),
        askedQuantityRole: 'firstPart',
      };
    case 'LINEAR_EQ':
      return {
        operation: 'SOLVE_EQUATION',
        scenarioType: 'FIND_UNKNOWN',
        operandRoles: roleFrom(['a', 'b', 'c']),
        askedQuantityRole: 'unknownX',
      };
    case 'ANGLE_SUM':
      return {
        operation: 'SUBTRACTION',
        scenarioType: 'GEOMETRY',
        operandRoles: roleFrom(['A', 'B']),
        askedQuantityRole: 'thirdAngle',
      };
    case 'ANGLE_TYPE':
      return {
        operation: 'CLASSIFY',
        scenarioType: 'CLASSIFY',
        operandRoles: roleFrom(['deg']),
        askedQuantityRole: 'angleCategory',
      };
    case 'PERCENT':
      return {
        operation: 'MIXED',
        scenarioType: 'SCALING',
        operandRoles: roleFrom(['p', 'base']),
        askedQuantityRole: 'percentOfBase',
      };
    case 'UNIT_CONVERSION':
      return {
        operation: 'CONVERT',
        scenarioType: 'CONVERT',
        operandRoles: roleFrom(['x']),
        askedQuantityRole: 'convertedValue',
      };
    case 'RECT_GEOMETRY':
      return {
        operation: 'MIXED',
        scenarioType: 'GEOMETRY',
        operandRoles: roleFrom(['length', 'width']),
        askedQuantityRole: b.units === 'cm²' ? 'area' : 'perimeter',
      };
    case 'WORD_2STEP':
      return {
        operation: 'MIXED',
        scenarioType: 'FIND_UNKNOWN',
        operandRoles: roleFrom(['a', 'b', 'c']),
        askedQuantityRole: 'result',
      };
    default:
      return {
        operation: 'MIXED',
        scenarioType: 'CLOSED_EXPRESSION',
        operandRoles: {},
        askedQuantityRole: 'result',
      };
  }
}

// range by K level (bigger numbers at higher K)
function rangeFor(spec: ItemGenerationSpec): { lo: number; hi: number } {
  const k = kIdx(spec.knowledgeLevel);
  if (k <= 1) return { lo: 2, hi: 20 };
  if (k === 2) return { lo: 3, hi: 100 };
  if (k === 3) return { lo: 5, hi: 500 };
  return { lo: 10, hi: 2000 };
}

const GENERATORS: Record<MathKernelFamily, FamilyGen> = {
  INT_ARITH: (spec, rng) => {
    const { lo, hi } = rangeFor(spec);
    const forms = [
      () => {
        const a = rng.int(lo, hi);
        const b = rng.int(lo, hi);
        return { expr: `${a} + ${b}`, val: a + b, nums: [a, b], graph: [`${a} + ${b} = ${a + b}`] };
      },
      () => {
        const a = rng.int(lo + 10, hi);
        const b = rng.int(lo, Math.max(lo, a - 1));
        return { expr: `${a} - ${b}`, val: a - b, nums: [a, b], graph: [`${a} - ${b} = ${a - b}`] };
      },
      () => {
        const a = rng.int(2, Math.min(20, hi));
        const b = rng.int(2, Math.min(20, hi));
        return { expr: `${a} × ${b}`, val: a * b, nums: [a, b], graph: [`${a} × ${b} = ${a * b}`] };
      },
      () => {
        const b = rng.int(2, 12);
        const q = rng.int(2, Math.min(30, Math.floor(hi / b)));
        return { expr: `${b * q} : ${b}`, val: q, nums: [b * q, b], graph: [`${b * q} : ${b} = ${q}`] };
      },
      () => {
        const a = rng.int(lo, hi);
        const b = rng.int(lo, hi);
        const c = rng.int(2, 9);
        return {
          expr: `( ${a} + ${b} ) × ${c}`,
          val: (a + b) * c,
          nums: [a, b, c],
          graph: [`${a} + ${b} = ${a + b}`, `${a + b} × ${c} = ${(a + b) * c}`],
        };
      },
    ] as const;
    const f = forms[rng.int(0, forms.length - 1)]!();
    return {
      answerKind: 'numeric',
      operands: f.nums.map((v, i) => ({ name: `x${i + 1}`, value: v })),
      operationGraph: f.graph,
      intermediateValues: { result: f.val },
      expectedAnswer: { kind: 'numeric', value: f.val, tolerance: 0 },
      canonicalVerificationExpression: f.expr,
      units: null,
      requiredNumbersInPrompt: f.nums,
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Thực hiện: ${f.graph.join('; ')}.`,
    };
  },

  DISTRIBUTIVE: (spec, rng) => {
    const { hi } = rangeFor(spec);
    const a = rng.int(3, Math.min(25, hi));
    const b = rng.int(5, Math.min(40, hi));
    const c = rng.int(5, Math.min(40, hi));
    const val = a * (b + c);
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'a', value: a },
        { name: 'b', value: b },
        { name: 'c', value: c },
      ],
      operationGraph: [`${a} × (${b} + ${c}) = ${a} × ${b} + ${a} × ${c}`, `= ${a * b} + ${a * c} = ${val}`],
      intermediateValues: { ab: a * b, ac: a * c, result: val },
      expectedAnswer: { kind: 'numeric', value: val, tolerance: 0 },
      canonicalVerificationExpression: `${a} × ( ${b} + ${c} )`,
      units: null,
      requiredNumbersInPrompt: [a, b, c],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Dùng tính chất phân phối: ${a} × (${b} + ${c}) = ${a * b} + ${a * c} = ${val}.`,
    };
  },

  SUM_DIFF: (spec, rng) => {
    const { hi } = rangeFor(spec);
    const big = rng.int(10, Math.min(500, hi));
    const small = rng.int(2, Math.max(3, big - 2));
    const S = big + small;
    const D = big - small;
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'S', value: S },
        { name: 'D', value: D },
      ],
      operationGraph: [`Số lớn = (S + D) : 2 = (${S} + ${D}) : 2 = ${big}`, `Số bé = S - lớn = ${S} - ${big} = ${small}`],
      intermediateValues: { big, small },
      expectedAnswer: { kind: 'numeric', value: big, tolerance: 0 },
      canonicalVerificationExpression: `( ${S} + ${D} ) : 2`,
      units: null,
      requiredNumbersInPrompt: [S, D],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Tổng ${S}, hiệu ${D}. Số lớn = (${S} + ${D}) : 2 = ${big}; số bé = ${small}. Hỏi số lớn.`,
    };
  },

  UNIT_RATE: (_spec, rng) => {
    const rate = rng.int(2, 15);
    const n1 = rng.int(2, 9);
    const n2 = rng.int(3, 12);
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'n1', value: n1 },
        { name: 'total1', value: n1 * rate },
        { name: 'n2', value: n2 },
      ],
      operationGraph: [`1 đơn vị: ${n1 * rate} : ${n1} = ${rate}`, `${n2} đơn vị: ${rate} × ${n2} = ${rate * n2}`],
      intermediateValues: { rate, result: rate * n2 },
      expectedAnswer: { kind: 'numeric', value: rate * n2, tolerance: 0 },
      canonicalVerificationExpression: `${n1 * rate} : ${n1} × ${n2}`,
      units: null,
      requiredNumbersInPrompt: [n1, n1 * rate, n2],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Rút về đơn vị: 1 phần = ${n1 * rate} : ${n1} = ${rate}. ${n2} phần = ${rate * n2}.`,
    };
  },

  FRACTION_ARITH: (_spec, rng) => {
    const ops = ['+', '-', '×'] as const;
    const op = rng.pick(ops);
    const b = rng.int(2, 9);
    const d = rng.int(2, 9);
    const a = rng.int(1, b);
    const c = rng.int(1, d);
    let n: number;
    let den: number;
    if (op === '+') {
      n = a * d + c * b;
      den = b * d;
    } else if (op === '-') {
      n = a * d - c * b;
      den = b * d;
    } else {
      n = a * c;
      den = b * d;
    }
    const s = simplify(n, den);
    return {
      answerKind: 'fraction',
      operands: [
        { name: 'a', value: a },
        { name: 'b', value: b },
        { name: 'c', value: c },
        { name: 'd', value: d },
      ],
      operationGraph: [`${a}/${b} ${op} ${c}/${d} = ${n}/${den} = ${s.numerator}/${s.denominator}`],
      intermediateValues: { numerator: s.numerator, denominator: s.denominator },
      expectedAnswer: { kind: 'fraction', numerator: s.numerator, denominator: s.denominator },
      canonicalVerificationExpression:
        op === '×' ? `${a}/${b} * ${c}/${d}` : `${a}/${b} ${op === '+' ? '+' : '-'} ${c}/${d}`,
      units: null,
      requiredNumbersInPrompt: [a, b, c, d],
      integerResult: false,
      fractionSimplified: true,
      solutionOutline: `Tính ${a}/${b} ${op} ${c}/${d}, quy đồng rồi rút gọn → ${s.numerator}/${s.denominator}.`,
    };
  },

  RATIO_SHARE: (_spec, rng) => {
    const p1 = rng.int(1, 5);
    const p2 = rng.int(1, 5);
    const three = rng.next() < 0.4;
    const p3 = three ? rng.int(1, 5) : 0;
    const unit = rng.int(3, 20);
    const total = unit * (p1 + p2 + p3);
    const parts = [p1 * unit, p2 * unit];
    if (three) parts.push(p3 * unit);
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'total', value: total },
        { name: 'p1', value: p1 },
        { name: 'p2', value: p2 },
        ...(three ? [{ name: 'p3', value: p3 }] : []),
      ],
      operationGraph: [
        `Tổng số phần: ${p1} + ${p2}${three ? ` + ${p3}` : ''} = ${p1 + p2 + p3}`,
        `Giá trị 1 phần: ${total} : ${p1 + p2 + p3} = ${unit}`,
        `Phần thứ nhất: ${unit} × ${p1} = ${p1 * unit}`,
      ],
      intermediateValues: { unit, part1: p1 * unit },
      expectedAnswer: { kind: 'numeric', value: p1 * unit, tolerance: 0 },
      canonicalVerificationExpression: `${total} : ${p1 + p2 + p3} * ${p1}`,
      units: null,
      requiredNumbersInPrompt: [total, p1, p2, ...(three ? [p3] : [])],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Chia ${total} theo tỉ lệ ${p1}:${p2}${three ? `:${p3}` : ''}. 1 phần = ${unit}. Phần thứ nhất = ${p1 * unit}.`,
    };
  },

  LINEAR_EQ: (spec, rng) => {
    const { hi } = rangeFor(spec);
    const a = rng.int(2, 12);
    const x = rng.int(2, Math.min(40, Math.max(3, Math.floor(hi / a))));
    const b = rng.int(-20, 40);
    const c = a * x + b;
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'a', value: a },
        { name: 'b', value: b },
        { name: 'c', value: c },
      ],
      operationGraph: [`${a}x + (${b}) = ${c}`, `${a}x = ${c - b}`, `x = ${c - b} : ${a} = ${x}`],
      intermediateValues: { x },
      expectedAnswer: { kind: 'numeric', value: x, tolerance: 0 },
      canonicalVerificationExpression: `( ${c} - ( ${b} ) ) : ${a}`,
      units: null,
      requiredNumbersInPrompt: [a, b, c],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Giải ${a}x + ${b} = ${c}: chuyển vế, ${a}x = ${c - b}, x = ${x}.`,
    };
  },

  ANGLE_SUM: (_spec, rng) => {
    const a = rng.int(20, 120);
    const b = rng.int(20, Math.max(21, 170 - a));
    const c = 180 - a - b;
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'A', value: a, unit: '°' },
        { name: 'B', value: b, unit: '°' },
      ],
      operationGraph: [`Góc C = 180° - ${a}° - ${b}° = ${c}°`],
      intermediateValues: { c },
      expectedAnswer: { kind: 'numeric', value: c, tolerance: 0 },
      canonicalVerificationExpression: `180 - ${a} - ${b}`,
      units: '°',
      requiredNumbersInPrompt: [a, b],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Tổng ba góc trong tam giác bằng 180°, nên góc còn lại = 180° - ${a}° - ${b}° = ${c}°.`,
    };
  },

  ANGLE_TYPE: (_spec, rng) => {
    const cases = [
      { deg: rng.int(10, 89), label: 'góc nhọn' },
      { deg: 90, label: 'góc vuông' },
      { deg: rng.int(91, 179), label: 'góc tù' },
      { deg: 180, label: 'góc bẹt' },
    ] as const;
    const c = rng.pick(cases);
    const distractors = cases.filter((x) => x.label !== c.label).map((x) => x.label);
    return {
      answerKind: 'choice',
      operands: [{ name: 'deg', value: c.deg, unit: '°' }],
      operationGraph: [`${c.deg}° → ${c.label}`],
      intermediateValues: { deg: c.deg },
      expectedAnswer: { kind: 'choice', correct: c.label, distractors },
      canonicalVerificationExpression: null,
      units: '°',
      requiredNumbersInPrompt: [c.deg],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Góc ${c.deg}° là ${c.label} (nhọn <90°, vuông =90°, tù 90°–180°, bẹt =180°).`,
    };
  },

  PERCENT: (_spec, rng) => {
    const p = rng.pick([10, 20, 25, 40, 50, 75]);
    const base = rng.int(4, 40) * 10;
    const val = (base * p) / 100;
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'p', value: p, unit: '%' },
        { name: 'base', value: base },
      ],
      operationGraph: [`${p}% của ${base} = ${base} × ${p} : 100 = ${val}`],
      intermediateValues: { result: val },
      expectedAnswer: { kind: 'numeric', value: val, tolerance: 0 },
      canonicalVerificationExpression: `${base} * ${p} : 100`,
      units: null,
      requiredNumbersInPrompt: [p, base],
      integerResult: Number.isInteger(val),
      fractionSimplified: false,
      solutionOutline: `${p}% của ${base} = ${base} × ${p} : 100 = ${val}.`,
    };
  },

  UNIT_CONVERSION: (_spec, rng) => {
    const table = [
      { from: 'm', to: 'cm', factor: 100 },
      { from: 'kg', to: 'g', factor: 1000 },
      { from: 'giờ', to: 'phút', factor: 60 },
      { from: 'km', to: 'm', factor: 1000 },
    ] as const;
    const t = rng.pick(table);
    const x = rng.int(2, 25);
    const val = x * t.factor;
    return {
      answerKind: 'numeric',
      operands: [{ name: 'x', value: x, unit: t.from }],
      operationGraph: [`${x} ${t.from} = ${x} × ${t.factor} = ${val} ${t.to}`],
      intermediateValues: { result: val },
      expectedAnswer: { kind: 'numeric', value: val, tolerance: 0 },
      canonicalVerificationExpression: `${x} * ${t.factor}`,
      units: t.to,
      requiredNumbersInPrompt: [x],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Đổi ${x} ${t.from} sang ${t.to}: nhân với ${t.factor} → ${val} ${t.to}.`,
    };
  },

  RECT_GEOMETRY: (_spec, rng) => {
    const L = rng.int(4, 40);
    const W = rng.int(2, Math.max(3, L - 1));
    const wantArea = rng.next() < 0.5;
    const val = wantArea ? L * W : 2 * (L + W);
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'length', value: L, unit: 'cm' },
        { name: 'width', value: W, unit: 'cm' },
      ],
      operationGraph: wantArea ? [`Diện tích = ${L} × ${W} = ${val}`] : [`Chu vi = (${L} + ${W}) × 2 = ${val}`],
      intermediateValues: { result: val },
      expectedAnswer: { kind: 'numeric', value: val, tolerance: 0 },
      canonicalVerificationExpression: wantArea ? `${L} * ${W}` : `( ${L} + ${W} ) * 2`,
      units: wantArea ? 'cm²' : 'cm',
      requiredNumbersInPrompt: [L, W],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: wantArea
        ? `Diện tích hình chữ nhật = dài × rộng = ${L} × ${W} = ${val} cm².`
        : `Chu vi hình chữ nhật = (dài + rộng) × 2 = (${L} + ${W}) × 2 = ${val} cm.`,
    };
  },

  WORD_1STEP: (spec, rng) => {
    // exactly ONE additive/subtractive/multiplicative operation on two given
    // numbers — a scenario fits these cleanly (unlike a 3-operand expression).
    const { lo, hi } = rangeFor(spec);
    const op = rng.pick(['+', '-', '×'] as const);
    let a: number;
    let b: number;
    let val: number;
    if (op === '+') {
      a = rng.int(lo, hi);
      b = rng.int(lo, hi);
      val = a + b;
    } else if (op === '-') {
      a = rng.int(lo + 10, hi);
      b = rng.int(lo, Math.max(lo, a - 1));
      val = a - b;
    } else {
      a = rng.int(2, Math.min(30, Math.max(3, Math.floor(hi / 5))));
      b = rng.int(2, 12);
      val = a * b;
    }
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'a', value: a },
        { name: 'b', value: b },
      ],
      operationGraph: [`${a} ${op} ${b} = ${val}`],
      intermediateValues: { result: val },
      expectedAnswer: { kind: 'numeric', value: val, tolerance: 0 },
      canonicalVerificationExpression: `${a} ${op === '×' ? '*' : op} ${b}`,
      units: null,
      requiredNumbersInPrompt: [a, b],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Bài toán lời văn một bước: ${a} ${op} ${b} = ${val}.`,
    };
  },

  WORD_2STEP: (spec, rng) => {
    const { hi } = rangeFor(spec);
    const a = rng.int(5, Math.min(200, hi));
    const b = rng.int(3, Math.min(100, hi));
    const c = rng.int(2, 9);
    const step1 = a + b;
    const val = step1 * c;
    return {
      answerKind: 'numeric',
      operands: [
        { name: 'a', value: a },
        { name: 'b', value: b },
        { name: 'c', value: c },
      ],
      operationGraph: [`Bước 1: ${a} + ${b} = ${step1}`, `Bước 2: ${step1} × ${c} = ${val}`],
      intermediateValues: { step1, result: val },
      expectedAnswer: { kind: 'numeric', value: val, tolerance: 0 },
      canonicalVerificationExpression: `( ${a} + ${b} ) × ${c}`,
      units: null,
      requiredNumbersInPrompt: [a, b, c],
      integerResult: true,
      fractionSimplified: false,
      solutionOutline: `Hai bước: (${a} + ${b}) = ${step1}, rồi ${step1} × ${c} = ${val}.`,
    };
  },
};

/**
 * generateMathKernel (doc 58 §2/§4) — deterministic. Builds a valid
 * ProblemInstance for the item, or explains why no kernel covers it. Retries
 * internally a few times to dodge a forbidden / recently-used number tuple.
 */
export function generateMathKernel(
  itemSpec: ItemGenerationSpec,
  kb: KnowledgeBase,
  ctx: KernelGenContext = {},
): MathKernelResult {
  const family = resolveMathFamily(itemSpec, kb);
  if (!family) return { ok: false, reason: `no MathKernel family for ${itemSpec.problemStructure}/${itemSpec.domain}` };
  return buildKernelOfFamily(family, itemSpec, ctx);
}

/**
 * Build a kernel of a SPECIFIC family (bypassing `resolveMathFamily`) — used by
 * the integrity gate to exercise every family directly (doc 58 §1).
 */
export function buildKernelOfFamily(
  family: MathKernelFamily,
  itemSpec: ItemGenerationSpec,
  ctx: KernelGenContext = {},
): MathKernelResult {
  const forbidden = new Set((ctx.forbiddenNumberTuples ?? []).map(tupleKey));
  const recent = new Set((ctx.recentNumberTuples ?? []).map(tupleKey));
  const gen = GENERATORS[family];

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rng = new Rng(seedFrom(itemSpec.itemId, family, String(attempt)));
    const built = gen(itemSpec, rng);
    if ('unsupported' in built) return { ok: false, reason: built.unsupported };
    const key = tupleKey(built.requiredNumbersInPrompt);
    if (attempt < 6 && (forbidden.has(key) || recent.has(key))) continue;

    const range = rangeFor(itemSpec);
    const body: Omit<MathKernel, 'kernelHash'> = {
      family,
      problemTypeId: itemSpec.problemTypeId,
      answerKind: built.answerKind,
      operands: built.operands,
      operationGraph: built.operationGraph,
      intermediateValues: built.intermediateValues,
      expectedAnswer: built.expectedAnswer,
      canonicalVerificationExpression: built.canonicalVerificationExpression,
      units: built.units,
      requiredNumbersInPrompt: built.requiredNumbersInPrompt,
      semantics: deriveSemantics(family, built),
      constraints: {
        integerResult: built.integerResult,
        fractionSimplified: built.fractionSimplified,
        numberRange: { min: range.lo, max: range.hi },
      },
      solutionOutline: built.solutionOutline,
    };
    return { ok: true, kernel: { ...body, kernelHash: hashKernel(body) } };
  }
  return { ok: false, reason: 'could not build a kernel avoiding forbidden number tuples' };
}

export { MATH_KERNEL_GROUP };
