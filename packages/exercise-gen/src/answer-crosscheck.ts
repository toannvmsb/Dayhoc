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
  /** skill ids only (already non-sensitive) — for verifier-model routing. */
  readonly skillId: string;
  readonly requiredSkillIds: readonly string[];
}

/**
 * The geometry / theorem-criteria / proof verification slice (doc 66 §4). These
 * items need a stronger verifier — gpt-4.1-mini has real misconceptions here
 * (e.g. "equal co-interior angles ⇒ parallel"). Skill-id match only.
 */
const GEOMETRY_PROOF_SKILL_RE = /\.(GEO|PROOF|TRI)\.|\b(GEO|PROOF)\b|PARALLEL|PERPENDIC|ANGLE|THEOREM|CONGRU|SIMILAR/i;

export function isGeometryProofVerifierSlice(skillIds: readonly string[]): boolean {
  return skillIds.some((s) => GEOMETRY_PROOF_SKILL_RE.test(s));
}

/**
 * Verifier-model router (doc 66 §4, PRE-APPROVED). Normal Group-C reasoning →
 * `base` (gpt-4.1-mini). Geometry / theorem-criteria / proof → `geometryProof`
 * (gpt-5-mini). Changes the VERIFIER only — never the generator routing.
 */
export function createRoutedAnswerCrosscheck(adapters: {
  base: AnswerCrosscheckAdapter;
  geometryProof: AnswerCrosscheckAdapter;
}): AnswerCrosscheckAdapter {
  return {
    name: `routed(${adapters.base.name} | geo:${adapters.geometryProof.name})`,
    crosscheck(request: AnswerCrosscheckRequest): Promise<AnswerCrosscheckOutcome> {
      const geo = isGeometryProofVerifierSlice([request.skillId, ...request.requiredSkillIds]);
      return (geo ? adapters.geometryProof : adapters.base).crosscheck(request);
    },
  };
}

export interface AnswerCrosscheckOutcome {
  readonly verdict: CrosscheckVerdict;
  readonly confidence: number; // 0..1
  readonly detail: string;
  /** present when a PAID verifier ran — for cost telemetry (doc 66 §5). */
  readonly usage?: {
    readonly model: string;
    readonly provider: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
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
    skillId: exercise.skillId,
    requiredSkillIds: exercise.requiredSkillIds ?? [],
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
  /** every verifier call's usage (for cost telemetry) — 1 or 2 entries. */
  readonly usages: readonly NonNullable<AnswerCrosscheckOutcome['usage']>[];
}

/**
 * Group C flow: generated content → (already content-validated) → crosscheck.
 *   PASS      → READY
 *   FAIL      → REGENERATE (feed back into the normal retry chain)
 *   UNCERTAIN → retry the verifier once; still UNCERTAIN → REVIEW_QUEUE
 *              (never silently marked verified).
 */
export async function runGroupCCrosscheck(
  exercise: GeneratedExercise,
  schoolGrade: number,
  adapter: AnswerCrosscheckAdapter,
  opts: { retryOnUncertain?: boolean } = {},
): Promise<GroupCCrosscheckResult> {
  const req = toCrosscheckRequest(exercise, schoolGrade);
  const usages: NonNullable<AnswerCrosscheckOutcome['usage']>[] = [];

  let outcome = await adapter.crosscheck(req);
  if (outcome.usage) usages.push(outcome.usage);
  if (outcome.verdict === 'UNCERTAIN' && opts.retryOnUncertain !== false) {
    outcome = await adapter.crosscheck(req);
    if (outcome.usage) usages.push(outcome.usage);
  }

  const state: GroupCState =
    outcome.verdict === 'PASS' ? 'READY' : outcome.verdict === 'FAIL' ? 'REGENERATE' : 'REVIEW_QUEUE';
  return { state, verdict: outcome.verdict, detail: outcome.detail, usages };
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
): { adapter: AnswerCrosscheckAdapter; paidEnabled: boolean; mode: string } {
  const mode = env.AI_CROSSCHECK_MODE ?? 'OFF';
  if (mode === 'LIVE' && buildPaid && env.OPENAI_API_KEY) {
    return { adapter: buildPaid(), paidEnabled: true, mode };
  }
  return { adapter: createStubAnswerCrosscheck(), paidEnabled: false, mode };
}
