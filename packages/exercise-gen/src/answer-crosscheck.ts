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

/**
 * Mock scripted cross-checker for tests (doc 65 §7). `verdictFor(itemId)` returns
 * the verdict; unknown ids → UNCERTAIN. NO network.
 */
export function createMockAnswerCrosscheck(
  verdictFor: (prompt: string) => CrosscheckVerdict,
): AnswerCrosscheckAdapter {
  return {
    name: 'mock-answer-crosscheck',
    crosscheck(request: AnswerCrosscheckRequest): Promise<AnswerCrosscheckOutcome> {
      const verdict = verdictFor(request.prompt);
      return Promise.resolve({
        verdict,
        confidence: verdict === 'UNCERTAIN' ? 0.3 : 0.9,
        detail: `mock crosscheck → ${verdict}`,
      });
    },
  };
}

/** State a Group C slot ends in after the crosscheck flow (doc 65 §6). */
export const GROUP_C_STATES = ['READY', 'REGENERATE', 'REVIEW_QUEUE'] as const;
export type GroupCState = (typeof GROUP_C_STATES)[number];

export interface GroupCCrosscheckResult {
  readonly state: GroupCState;
  readonly verdict: CrosscheckVerdict;
  readonly detail: string;
}

/**
 * Group C flow: generated content → (already content-validated) → crosscheck.
 *   PASS      → READY
 *   FAIL      → REGENERATE (feed back into the normal retry chain)
 *   UNCERTAIN → REVIEW_QUEUE (never silently marked verified)
 */
export async function runGroupCCrosscheck(
  exercise: GeneratedExercise,
  schoolGrade: number,
  adapter: AnswerCrosscheckAdapter,
): Promise<GroupCCrosscheckResult> {
  const outcome = await adapter.crosscheck(toCrosscheckRequest(exercise, schoolGrade));
  const state: GroupCState =
    outcome.verdict === 'PASS' ? 'READY' : outcome.verdict === 'FAIL' ? 'REGENERATE' : 'REVIEW_QUEUE';
  return { state, verdict: outcome.verdict, detail: outcome.detail };
}

/**
 * Config gate for a PAID crosscheck adapter (doc 65 §7). A paid adapter is used
 * ONLY when `AI_CROSSCHECK_MODE === 'LIVE'` AND a key is present. Anything else
 * (unset / 'OFF' / 'SHADOW') → the stub. Paid crosscheck stays disabled until
 * explicitly approved.
 */
export function resolveCrosscheckAdapter(
  env: Record<string, string | undefined>,
  buildPaid?: () => AnswerCrosscheckAdapter,
): { adapter: AnswerCrosscheckAdapter; paidEnabled: boolean } {
  const mode = env.AI_CROSSCHECK_MODE ?? 'OFF';
  if (mode === 'LIVE' && buildPaid && env.OPENAI_API_KEY) {
    return { adapter: buildPaid(), paidEnabled: true };
  }
  return { adapter: createStubAnswerCrosscheck(), paidEnabled: false };
}
