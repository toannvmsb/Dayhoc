import type {
  GeneratedExercise,
  KernelConsistencyCode,
  KernelConsistencyResult,
  KernelOperation,
  MathKernel,
} from '@copilot/domain';

export const KERNEL_VALIDATOR_VERSION = 'kernel-validator.v2';

/**
 * Bounded Vietnamese keyword contract per operation (doc 58 §3). NOT NLP — a
 * small fixed lexicon used only to catch "the numbers are right but the prose
 * means a different operation".
 */
const OP_KEYWORDS: Record<KernelOperation, RegExp> = {
  ADDITION: /(cộng\s*thêm|thêm|nhận thêm|góp|gộp|cả hai (đội|tổ|nhóm)|nhiều hơn .*(là )?bao nhiêu|tổng (của|hai))/i,
  SUBTRACTION: /bớt|còn lại|còn bao nhiêu|trừ|đã (dùng|bán|cho|chuyển)|chuyển đi|ít hơn|lấy ra|xuống bến|hết/i,
  MULTIPLICATION: /mỗi \S+ (có |chứa |đóng |gồm )?\d+|gấp (đôi|ba|\d+)|\d+ (nhóm|hộp|thùng|hàng|túi|tá|chục|lần) (như|,? mỗi)|đóng \d+ (thùng|hộp|gói|túi|két)/i,
  DIVISION: /chia đều|chia cho|chia thành|chia lại|phân phối|mỗi (nhóm|tổ|phần|người|hàng|hộp|xe) (nhận|có|được|cần)|xếp (đều )?thành|cắt thành|đóng đều (vào|thành)/i,
  PROPORTION: /tỉ lệ|tỉ số|theo tỉ|phần với|thành phần thứ|dãy tỉ/i,
  SOLVE_EQUATION: /tìm x|phương trình|biết .*\bx\b/i,
  CONVERT: /đổi .*(ra|sang|thành)|bằng bao nhiêu (cm|mm|dm|m|g|kg|phút|giây|giờ)/i,
  CLASSIFY: /loại (góc|tam giác|nào)|thuộc loại|là góc (gì|nào)/i,
  MIXED: /.^/, // never matches — MIXED is not keyword-checked
};

/** operations whose prose the strict keyword check applies to (single, unambiguous). */
const STRICT_OPS = new Set<KernelOperation>([
  'ADDITION',
  'SUBTRACTION',
  'MULTIPLICATION',
  'DIVISION',
  'PROPORTION',
  'SOLVE_EQUATION',
  'CONVERT',
  'CLASSIFY',
]);

/** what two operands would give under each basic operation (for the drift check). */
function underEachOp(a: number, b: number): Record<'ADDITION' | 'SUBTRACTION' | 'MULTIPLICATION' | 'DIVISION', number> {
  return {
    ADDITION: a + b,
    SUBTRACTION: a - b,
    MULTIPLICATION: a * b,
    DIVISION: b !== 0 ? a / b : NaN,
  };
}

/** All the distinct numbers a text mentions (integers + decimals). */
function numbersIn(text: string): Set<number> {
  const out = new Set<number>();
  for (const m of text.matchAll(/-?\d+(?:[.,]\d+)?/g)) {
    const n = Number(m[0].replace(',', '.'));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

function answersEqual(a: MathKernel['expectedAnswer'], ex: GeneratedExercise): boolean {
  const got = ex.answerSpec;
  switch (a.kind) {
    case 'numeric':
      if (got.kind === 'numeric') return Math.abs(got.value - a.value) <= Math.max(a.tolerance, 1e-9);
      if (got.kind === 'fraction' && got.denominator !== 0) return Math.abs(got.numerator / got.denominator - a.value) <= 1e-9;
      if (got.kind === 'exact') {
        const n = Number(got.value.replace(',', '.').replace(/[^\d.-]/g, ''));
        return Number.isFinite(n) && Math.abs(n - a.value) <= Math.max(a.tolerance, 1e-9);
      }
      return false;
    case 'fraction': {
      const target = a.numerator / a.denominator;
      if (got.kind === 'fraction' && got.denominator !== 0) return Math.abs(got.numerator / got.denominator - target) <= 1e-9;
      if (got.kind === 'numeric') return Math.abs(got.value - target) <= 1e-9;
      return false;
    }
    case 'exact':
      return got.kind === 'exact' && got.value.trim().toLowerCase() === a.value.trim().toLowerCase();
    case 'choice':
      return got.kind === 'choice' && got.correct.trim().toLowerCase() === a.correct.trim().toLowerCase();
    default:
      return false;
  }
}

/**
 * validateAgainstKernel (doc 58 §6) — deterministic. Every mathematically
 * authoritative fact the kernel owns must survive the AI's verbalization. Any
 * contradiction is a HARD FAIL (→ `DETERMINISTIC_WRONG`), regenerate that item.
 */
export function validateAgainstKernel(
  exercise: GeneratedExercise,
  kernel: MathKernel,
): KernelConsistencyResult {
  const codes: KernelConsistencyCode[] = [];
  const details: string[] = [];

  // 1. the returned answer must match the kernel's expected answer
  if (!answersEqual(kernel.expectedAnswer, exercise)) {
    codes.push('ANSWER_MISMATCH');
    details.push(
      `answer ${JSON.stringify(exercise.answerSpec)} ≠ kernel ${JSON.stringify(kernel.expectedAnswer)}`,
    );
  }

  // 2. every GIVEN number must appear in the prompt. A negative operand rendered
  //    as a subtraction ("x − 14" for the required token -14) is NOT a drop.
  const promptNums = numbersIn(exercise.prompt);
  const dropped = kernel.requiredNumbersInPrompt.filter(
    (n) => !promptNums.has(n) && !(n < 0 && promptNums.has(Math.abs(n))),
  );
  if (dropped.length > 0) {
    codes.push('KERNEL_NUMBER_DROPPED');
    details.push(`prompt is missing given number(s): ${dropped.join(', ')}`);
  }

  // 3. units — if the kernel carries an authoritative unit, the prompt/solution
  //    should mention it (a light check — absence of the unit token)
  if (kernel.units && kernel.units !== '°') {
    const hay = `${exercise.prompt} ${exercise.workedSolution}`.toLowerCase();
    if (!hay.includes(kernel.units.toLowerCase())) {
      codes.push('UNIT_INCONSISTENT');
      details.push(`authoritative unit "${kernel.units}" not mentioned`);
    }
  }

  // 4. worked-solution consistency (doc 58 §4) — CONSERVATIVE: only a contradiction
  //    we can be sure of. (a) the correct result must appear SOMEWHERE in the
  //    solution; (b) an EXPLICIT final-answer statement ("Đáp số: X", "Đáp số là
  //    X", "kết luận … X") near the end must not state a different value — and
  //    only when the correct value does not also appear after it (a step, not the
  //    conclusion).
  if (kernel.expectedAnswer.kind === 'numeric' && exercise.workedSolution.trim().length > 0) {
    const sol = exercise.workedSolution;
    const want = kernel.expectedAnswer.value;
    const solNums = numbersIn(sol);
    if (!solNums.has(want)) {
      codes.push('SOLUTION_CONTRADICTS_KERNEL');
      details.push(`worked solution never states the correct result ${want}`);
    } else {
      const m = /(?:đáp\s*số|đáp\s*án|kết\s*luận)\s*(?:là|:|=)?\s*(-?\d+(?:[.,]\d+)?)/i.exec(sol);
      if (m) {
        const claimed = Number(m[1]!.replace(',', '.'));
        const afterStatement = sol.slice(m.index + m[0].length);
        const wantAppearsAfter = numbersIn(afterStatement).has(want);
        if (Number.isFinite(claimed) && Math.abs(claimed - want) > 1e-9 && !wantAppearsAfter) {
          codes.push('SOLUTION_CONTRADICTS_KERNEL');
          details.push(`worked solution's stated đáp số is ${claimed}, kernel answer is ${want}`);
        }
      }
    }
  }

  // 4b. OPERAND_MUTATION — the answer must not be leaked into the prompt as a
  //     "given", and a given number must not appear arithmetically altered.
  if (kernel.expectedAnswer.kind === 'numeric') {
    const given = new Set(kernel.requiredNumbersInPrompt);
    if (
      !given.has(kernel.expectedAnswer.value) &&
      promptNums.has(kernel.expectedAnswer.value) &&
      kernel.semantics.scenarioType !== 'CLOSED_EXPRESSION'
    ) {
      codes.push('OPERAND_MUTATION');
      details.push(`the answer ${kernel.expectedAnswer.value} appears in the prompt as if it were given data`);
    }
  }

  // 5. SEMANTIC_STRUCTURE_MISMATCH (doc 58 §3) — for a single-operation family,
  //    the prose must imply the kernel's operation, not a different one.
  const op = kernel.semantics.operation;
  if (STRICT_OPS.has(op)) {
    const p = exercise.prompt;
    const impliesExpected = OP_KEYWORDS[op].test(p);
    const conflicting: KernelOperation[] = [];
    for (const other of STRICT_OPS) {
      if (other === op) continue;
      if (!OP_KEYWORDS[other].test(p)) continue;
      // only a CONFLICT if applying `other` to the two operands would give a
      // different answer than the kernel's
      if (
        kernel.expectedAnswer.kind === 'numeric' &&
        kernel.requiredNumbersInPrompt.length >= 2 &&
        (other === 'ADDITION' || other === 'SUBTRACTION' || other === 'MULTIPLICATION' || other === 'DIVISION')
      ) {
        const [a, b] = kernel.requiredNumbersInPrompt;
        const alt = underEachOp(a!, b!)[other];
        if (Number.isFinite(alt) && Math.abs(alt - kernel.expectedAnswer.value) > 1e-9) conflicting.push(other);
      } else {
        conflicting.push(other);
      }
    }
    if (conflicting.length > 0 && !impliesExpected) {
      codes.push('SEMANTIC_STRUCTURE_MISMATCH');
      details.push(
        `kernel operation is ${op} but the prose reads as ${conflicting.join('/')} and shows no ${op} language`,
      );
    }
  }

  // 5. a choice item's distractors must not contain the correct answer
  if (exercise.answerSpec.kind === 'choice') {
    const correct = exercise.answerSpec.correct.trim().toLowerCase();
    const dups = exercise.answerSpec.options.filter((o) => o.trim().toLowerCase() === correct).length;
    if (dups !== 1) {
      codes.push('DISTRACTOR_INCLUDES_ANSWER');
      details.push('the correct option appears zero or multiple times among the options');
    }
  }

  // 6. solvability — with every given number present (checked in 2), the kernel
  //    guarantees the problem is solvable. Only fail here if 2 failed AND the
  //    prompt has fewer numbers than the kernel needs.
  if (dropped.length > 0 && promptNums.size < kernel.requiredNumbersInPrompt.length) {
    codes.push('PROMPT_NOT_SOLVABLE');
  }

  return {
    consistent: codes.length === 0,
    codes: [...new Set(codes)],
    detail: details.join(' | ') || 'consistent with the kernel',
  };
}
