import type { CrosscheckVerdict, GeneratedExercise } from '@copilot/domain';

/**
 * AnswerCrosscheckAdapter (doc 58 §8) — a FALLBACK, never the default path. It
 * only ever handles items NOT covered by a `MathKernel` / deterministic
 * verification. It receives the MINIMUM problem data (prompt + answer + short
 * solution), and returns `PASS` / `FAIL` / `UNCERTAIN`:
 *   FAIL      → reject the item, regenerate
 *   UNCERTAIN → regenerate, or route to a stronger verification path
 *   PASS      → the item may be marked cross-checked
 * It NEVER silently accepts. No paid call is wired here yet.
 */
export interface AnswerCrosscheckRequest {
  readonly prompt: string;
  readonly answer: string; // the answer as displayed to a solver
  readonly workedSolutionSummary: string;
  readonly answerKind: string;
  /** grade context only — no child data, no skill graph, no twin. */
  readonly schoolGrade: number;
}

export interface AnswerCrosscheckOutcome {
  readonly verdict: CrosscheckVerdict;
  readonly confidence: number; // 0..1
  readonly detail: string;
}

export interface AnswerCrosscheckAdapter {
  readonly name: string;
  crosscheck(request: AnswerCrosscheckRequest): Promise<AnswerCrosscheckOutcome>;
}

/** Reduce a generated exercise to the minimum a cross-checker needs (doc 58 §8). */
export function toCrosscheckRequest(exercise: GeneratedExercise, schoolGrade: number): AnswerCrosscheckRequest {
  const a = exercise.answerSpec;
  const answer =
    a.kind === 'numeric'
      ? String(a.value)
      : a.kind === 'fraction'
        ? `${a.numerator}/${a.denominator}`
        : a.kind === 'exact'
          ? a.value
          : a.kind === 'choice'
            ? a.correct
            : '(reasoning — graded by rubric)';
  return {
    prompt: exercise.prompt,
    answer,
    workedSolutionSummary: exercise.workedSolution.slice(0, 600),
    answerKind: a.kind,
    schoolGrade,
  };
}

/**
 * Stub cross-checker — deterministic, no network. Always `UNCERTAIN` so a
 * caller never mistakes it for a real check. Swap for an
 * `AIProviderAdapter`-backed implementation once cost/quality justify it.
 */
export function createStubAnswerCrosscheck(): AnswerCrosscheckAdapter {
  return {
    name: 'stub-answer-crosscheck',
    crosscheck(): Promise<AnswerCrosscheckOutcome> {
      return Promise.resolve({
        verdict: 'UNCERTAIN',
        confidence: 0,
        detail: 'stub cross-checker — no live verification configured (doc 58 §8)',
      });
    },
  };
}
