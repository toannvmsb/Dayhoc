import type {
  GeneratedExercise,
  KernelConsistencyCode,
  KernelConsistencyResult,
  KernelOperation,
  MathKernel,
  SemanticVerdict,
} from '@copilot/domain';
import {
  reconcileEquationForm,
  reconcileNumberDrop,
  reconcileOperandCollision,
} from './semantic-normalizer.js';

export const KERNEL_VALIDATOR_VERSION = 'kernel-validator.v3';

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
  SOLVE_EQUATION:
    /tìm\s+[a-zà-ỹ]|tìm\s+số|số\s+(cần|phải|chưa)\s+(tìm|biết)|số\s+nào|phương\s*trình|chuyển\s*vế|ẩn\s+số|giá\s+trị\s+của\s+[a-z]\b|biết\s*(rằng)?\s*[:,]?\s*[a-z]\b|[a-zA-Z]\s*[-+×·*/:]\s*\d[\d\s.,]*=|=\s*[-+]?\d[\d\s.,]*$/im,
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

/** codes that are ALWAYS a hard contradiction — never reconcilable. */
const HARD_CODES = new Set<KernelConsistencyCode>([
  'ANSWER_MISMATCH',
  'SOLUTION_CONTRADICTS_KERNEL',
  'DISTRACTOR_INCLUDES_ANSWER',
  'UNIT_INCONSISTENT',
  'PROMPT_NOT_SOLVABLE',
]);

/**
 * validateAgainstKernel (doc 58 §6, doc 62 reconciliation layer). Deterministic.
 *
 * Hard codes (answer / worked-solution / units) are always a contradiction.
 * "Prose-preservation" codes (KERNEL_NUMBER_DROPPED, SEMANTIC_STRUCTURE_MISMATCH,
 * OPERAND_MUTATION) are first passed through the bounded Vietnamese normalizer:
 *   normalizer PASS    → the code is dropped (valid alternative phrasing)
 *   normalizer FAIL    → the code stays as a hard contradiction
 *   normalizer UNKNOWN → the code stays, `semanticVerdict='UNKNOWN'` — the item
 *                        is NOT accepted but is retry/escalation eligible, NOT
 *                        marked DETERMINISTIC_WRONG.
 */
export function validateAgainstKernel(
  exercise: GeneratedExercise,
  kernel: MathKernel,
): KernelConsistencyResult {
  const hard: KernelConsistencyCode[] = [];
  const unknown: KernelConsistencyCode[] = [];
  const reconciled: string[] = [];
  const details: string[] = [];

  // 1. the returned answer must match the kernel's expected answer  (HARD)
  if (!answersEqual(kernel.expectedAnswer, exercise)) {
    hard.push('ANSWER_MISMATCH');
    details.push(
      `answer ${JSON.stringify(exercise.answerSpec)} ≠ kernel ${JSON.stringify(kernel.expectedAnswer)}`,
    );
  }

  const promptNums = numbersIn(exercise.prompt);

  // 2. every GIVEN number must appear in the prompt — RECONCILABLE. Raw digit
  //    check first, then the normalizer (number words, "gấp N", signed language).
  const rawMissing = kernel.requiredNumbersInPrompt.filter((n) => {
    if (n === 0) return false;
    if (promptNums.has(n)) return false;
    if (kernel.family === 'LINEAR_EQ' && n < 0 && promptNums.has(-n)) return false;
    return true;
  });
  if (rawMissing.length > 0) {
    const rec = reconcileNumberDrop(rawMissing, exercise.prompt, '');
    if (rec.resolved.length > 0) reconciled.push(`KERNEL_NUMBER_DROPPED: ${rec.resolved.join(',')} present as words/signed language`);
    if (rec.stillMissing.length > 0) {
      hard.push('KERNEL_NUMBER_DROPPED');
      details.push(`prompt is missing given number(s): ${rec.stillMissing.join(', ')}`);
    }
  }

  // 3. units — HARD (light absence check).
  if (kernel.units && kernel.units !== '°') {
    const hay = `${exercise.prompt} ${exercise.workedSolution}`.toLowerCase();
    if (!hay.includes(kernel.units.toLowerCase())) {
      hard.push('UNIT_INCONSISTENT');
      details.push(`authoritative unit "${kernel.units}" not mentioned`);
    }
  }

  // 4. worked-solution consistency — HARD, conservative (doc 59 P0).
  if (kernel.expectedAnswer.kind === 'numeric' && exercise.workedSolution.trim().length > 0) {
    const sol = exercise.workedSolution;
    const want = kernel.expectedAnswer.value;
    const solNums = numbersIn(sol);
    if (!solNums.has(want)) {
      hard.push('SOLUTION_CONTRADICTS_KERNEL');
      details.push(`worked solution never states the correct result ${want}`);
    } else {
      const m = /(?:đáp\s*số|đáp\s*án|kết\s*luận)\s*(?:là|:|=)?\s*(-?\d+(?:[.,]\d+)?)/i.exec(sol);
      if (m) {
        const claimed = Number(m[1]!.replace(',', '.'));
        const afterStatement = sol.slice(m.index + m[0].length);
        const wantAppearsAfter = numbersIn(afterStatement).has(want);
        if (Number.isFinite(claimed) && Math.abs(claimed - want) > 1e-9 && !wantAppearsAfter) {
          hard.push('SOLUTION_CONTRADICTS_KERNEL');
          details.push(`worked solution's stated đáp số is ${claimed}, kernel answer is ${want}`);
        }
      }
    }
  }

  // 4b. OPERAND_MUTATION — RECONCILABLE (a value collision with a structural count
  //     is not leaked answer data).
  if (kernel.expectedAnswer.kind === 'numeric') {
    const given = new Set(kernel.requiredNumbersInPrompt);
    if (
      !given.has(kernel.expectedAnswer.value) &&
      promptNums.has(kernel.expectedAnswer.value) &&
      kernel.semantics.scenarioType !== 'CLOSED_EXPRESSION'
    ) {
      const verdict = reconcileOperandCollision(kernel.expectedAnswer.value, exercise.prompt);
      if (verdict === 'PASS') {
        reconciled.push(`OPERAND_MUTATION: ${kernel.expectedAnswer.value} is a structural count in the prompt, not leaked`);
      } else {
        hard.push('OPERAND_MUTATION');
        details.push(`the answer ${kernel.expectedAnswer.value} appears in the prompt as if it were given data`);
      }
    }
  }

  // 5. SEMANTIC_STRUCTURE_MISMATCH.
  const op = kernel.semantics.operation;
  const p = exercise.prompt;
  if (op === 'SOLVE_EQUATION') {
    // RECONCILABLE: a word problem is a valid realization of a LINEAR_EQ kernel.
    // Accept when the prompt has an equation shape OR the worked solution sets up
    // an equation consistent with the kernel / reaches the kernel's x.
    const hasEquationShape =
      /[a-zA-Z]\s*[-+×·*/:]?\s*\d[\d\s.,]*=\s*[-+]?\d/.test(p) ||
      /=\s*[-+]?\d[\d\s.,]*[.);]?\s*$/im.test(p) ||
      OP_KEYWORDS.SOLVE_EQUATION.test(p);
    if (!hasEquationShape) {
      const verdict: SemanticVerdict = reconcileEquationForm(exercise.workedSolution, kernel);
      if (verdict === 'PASS') {
        reconciled.push('SEMANTIC_STRUCTURE_MISMATCH: word problem, worked solution sets up the kernel equation');
      } else if (verdict === 'FAIL') {
        hard.push('SEMANTIC_STRUCTURE_MISMATCH');
        details.push('word problem whose worked solution sets up a DIFFERENT equation than the kernel');
      } else {
        unknown.push('SEMANTIC_STRUCTURE_MISMATCH');
        details.push('SOLVE_EQUATION kernel realized as prose; could not prove the setup matches the kernel');
      }
    }
  } else if (STRICT_OPS.has(op)) {
    // HARD: a conflicting arithmetic reading whose result differs from the kernel.
    const impliesExpected = OP_KEYWORDS[op].test(p);
    const conflicting: KernelOperation[] = [];
    for (const other of STRICT_OPS) {
      if (other === op || other === 'SOLVE_EQUATION') continue;
      if (!OP_KEYWORDS[other].test(p)) continue;
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
      hard.push('SEMANTIC_STRUCTURE_MISMATCH');
      details.push(
        `kernel operation is ${op} but the prose reads as ${conflicting.join('/')} and shows no ${op} language`,
      );
    }
  }

  // 6. a choice item's distractors must not contain the correct answer  (HARD)
  if (exercise.answerSpec.kind === 'choice') {
    const correct = exercise.answerSpec.correct.trim().toLowerCase();
    const dups = exercise.answerSpec.options.filter((o) => o.trim().toLowerCase() === correct).length;
    if (dups !== 1) {
      hard.push('DISTRACTOR_INCLUDES_ANSWER');
      details.push('the correct option appears zero or multiple times among the options');
    }
  }

  // 7. solvability — HARD, only when a real drop AND too few numbers.
  const realDrop = hard.includes('KERNEL_NUMBER_DROPPED');
  if (realDrop && promptNums.size < kernel.requiredNumbersInPrompt.length - 1) {
    hard.push('PROMPT_NOT_SOLVABLE');
  }

  const hardDedup = [...new Set(hard)].filter((c) => HARD_CODES.has(c) || c === 'KERNEL_NUMBER_DROPPED' || c === 'OPERAND_MUTATION' || c === 'SEMANTIC_STRUCTURE_MISMATCH');
  const semanticVerdict: SemanticVerdict =
    hardDedup.length > 0 ? 'FAIL' : unknown.length > 0 ? 'UNKNOWN' : 'PASS';

  return {
    consistent: hardDedup.length === 0 && unknown.length === 0,
    codes: [...new Set([...hardDedup, ...unknown])],
    detail: details.join(' | ') || 'consistent with the kernel',
    semanticVerdict,
    reconciled,
  };
}
