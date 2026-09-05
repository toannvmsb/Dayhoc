import type {
  GeneratedExercise,
  KernelConsistencyCode,
  KernelConsistencyResult,
  MathKernel,
} from '@copilot/domain';

export const KERNEL_VALIDATOR_VERSION = 'kernel-validator.v1';

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

  // 2. every GIVEN number must appear in the prompt
  const promptNums = numbersIn(exercise.prompt);
  const dropped = kernel.requiredNumbersInPrompt.filter((n) => !promptNums.has(n));
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

  // 4. the worked solution must not conclude a DIFFERENT final value
  if (kernel.expectedAnswer.kind === 'numeric') {
    const solNums = numbersIn(exercise.workedSolution);
    if (!solNums.has(kernel.expectedAnswer.value) && exercise.workedSolution.trim().length > 0) {
      codes.push('SOLUTION_CONTRADICTS_KERNEL');
      details.push(`worked solution never states the correct result ${kernel.expectedAnswer.value}`);
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
