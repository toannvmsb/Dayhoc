import type { ExerciseGenerationSpec, GeneratedExercise } from '@copilot/domain';
import { KNOWLEDGE_LEVELS, THINKING_LEVELS } from '@copilot/domain';
import { verifyMathAnswer } from './math-verifier.js';

/**
 * Second-pass verification (doc 14 C5 §10). NOT run on every item by default —
 * cost ladder is (1) deterministic verification (`answer-verification.ts`),
 * (2) the contract `GeneratedExerciseValidator`, (3) selective AI verification
 * only when neither of those can resolve the item. For C5 this is an
 * INTERFACE + a pure trigger predicate + a stub — no live second model call is
 * wired in; the shadow benchmark only MEASURES how often verification would be
 * required.
 */
export interface SecondPassVerifier {
  readonly name: string;
  verify(item: GeneratedExercise, spec: ExerciseGenerationSpec): Promise<VerifierOutcome>;
}

export type VerifierOutcome =
  | { readonly verified: true; readonly confidence: number }
  | { readonly verified: false; readonly reason: string };

export type VerificationTrigger =
  | 'reasoning_or_proof_item'
  | 'ambiguous_answer'
  | 'deterministic_verifier_unresolved'
  | 'high_k_t_advanced_item'
  | 'suspicious_solution_inconsistency';

/**
 * Deterministic, pure — decides WHETHER an item is a candidate for second-pass
 * verification. Never itself calls an AI model.
 */
export function wouldRequireVerification(
  item: GeneratedExercise,
  spec: ExerciseGenerationSpec,
): readonly VerificationTrigger[] {
  const triggers: VerificationTrigger[] = [];

  if (item.answerSpec.kind === 'reasoning') triggers.push('reasoning_or_proof_item');

  if (item.answerSpec.kind === 'choice' && new Set(item.answerSpec.options).size !== item.answerSpec.options.length) {
    triggers.push('ambiguous_answer');
  }
  if (item.answerSpec.kind === 'numeric' && item.answerSpec.tolerance <= 0) {
    triggers.push('ambiguous_answer');
  }
  // a non-reasoning item the deterministic math verifier could NOT resolve
  // (couldn't parse a closed expression) still needs a crosscheck (doc 14 C5.1 §2/§10).
  if (item.answerSpec.kind !== 'reasoning' && verifyMathAnswer(item).verdict === 'UNSUPPORTED') {
    triggers.push('deterministic_verifier_unresolved');
  }

  const kIdx = KNOWLEDGE_LEVELS.indexOf(item.knowledgeLevel);
  const tIdx = THINKING_LEVELS.indexOf(item.thinkingLevel);
  if (kIdx >= KNOWLEDGE_LEVELS.indexOf('K4') || tIdx >= THINKING_LEVELS.indexOf('T4')) {
    triggers.push('high_k_t_advanced_item');
  }
  // a stretch item sitting at the very top of the spec's allowed K/T range also
  // deserves a closer look — that is where the generator is most likely to slip.
  if (
    item.bucket === 'advanced' ||
    kIdx === KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMax) ||
    tIdx === THINKING_LEVELS.indexOf(spec.difficulty.tMax)
  ) {
    if (!triggers.includes('high_k_t_advanced_item')) triggers.push('high_k_t_advanced_item');
  }

  // a worked solution that doesn't mention any digit for a numeric-family
  // answer is a cheap "suspicious inconsistency" smell — not a proof, a filter.
  if (
    (item.answerSpec.kind === 'numeric' || item.answerSpec.kind === 'fraction') &&
    !/\d/.test(item.workedSolution)
  ) {
    triggers.push('suspicious_solution_inconsistency');
  }

  return triggers;
}

/**
 * Stub second-pass verifier — deterministic, no network. Reports "unverified"
 * for anything that would need one, so callers never mistake the stub for a
 * real check. Swap for a live verifier (a `SecondPassVerifier` calling an
 * `AIProviderAdapter`) once cost/quality justifies it.
 */
export function createStubSecondPassVerifier(): SecondPassVerifier {
  return {
    name: 'stub-second-pass-verifier',
    verify(): Promise<VerifierOutcome> {
      return Promise.resolve({ verified: false, reason: 'stub verifier — no live second-pass check configured' });
    },
  };
}
