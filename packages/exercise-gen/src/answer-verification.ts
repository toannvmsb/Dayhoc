import type { AnswerVerificationLevel, GeneratedExercise, GeneratedExerciseBatch } from '@copilot/domain';
import { verifyMathAnswer, type MathVerification } from './math-verifier.js';

/**
 * Answer verification (doc 14 C5 §9 + C5.1 §1). An AI-provided answer is never
 * assumed correct, and a well-formed answer key is NOT a correct one.
 *
 *   FORMAT_VERIFIED                     — key is well-formed & self-consistent
 *   DETERMINISTIC_CORRECTNESS_VERIFIED  — an independent checker re-derived it
 *   AI_CROSSCHECK_REQUIRED             — no deterministic path (reasoning, or
 *                                        the math verifier couldn't parse it)
 *   HUMAN_GOLDEN_VERIFIED             — a human confirmed this exact item
 *   UNVERIFIED                        — key malformed, OR proven WRONG, OR nothing ran
 *
 * INVARIANT: FORMAT_VERIFIED ≠ DETERMINISTIC_CORRECTNESS_VERIFIED.
 */

export interface ItemAnswerVerification {
  readonly level: AnswerVerificationLevel;
  /** True iff the answer key itself is well-formed (independent of correctness). */
  readonly formatValid: boolean;
  readonly math: MathVerification;
}

export function verifyItemAnswer(item: GeneratedExercise): ItemAnswerVerification {
  const formatValid = isAnswerKeyWellFormed(item);
  const math = verifyMathAnswer(item);

  let level: AnswerVerificationLevel;
  if (!formatValid) {
    level = 'UNVERIFIED';
  } else if (math.verdict === 'CORRECT') {
    level = 'DETERMINISTIC_CORRECTNESS_VERIFIED';
  } else if (math.verdict === 'INCORRECT') {
    level = 'UNVERIFIED'; // proven wrong — a valid shape does not save it
  } else if (item.answerSpec.kind === 'reasoning') {
    level = 'AI_CROSSCHECK_REQUIRED';
  } else {
    // well-formed key, correctness not independently established
    level = 'FORMAT_VERIFIED';
  }
  return { level, formatValid, math };
}

/** @deprecated use `verifyItemAnswer(...).level` — kept for older call sites. */
export function assessItemAnswerVerification(item: GeneratedExercise): AnswerVerificationLevel {
  return verifyItemAnswer(item).level;
}

function isAnswerKeyWellFormed(item: GeneratedExercise): boolean {
  switch (item.answerSpec.kind) {
    case 'reasoning':
      return Boolean(item.rubric && item.rubric.trim().length > 0);
    case 'exact':
      return item.answerSpec.value.trim().length > 0;
    case 'numeric':
      return Number.isFinite(item.answerSpec.value) && item.answerSpec.tolerance >= 0;
    case 'fraction':
      return item.answerSpec.denominator !== 0 && Number.isInteger(item.answerSpec.numerator) && Number.isInteger(item.answerSpec.denominator);
    case 'choice':
      return item.answerSpec.options.length >= 2 && item.answerSpec.options.includes(item.answerSpec.correct);
    default:
      return false;
  }
}

export interface AnswerVerificationSummary {
  readonly total: number;
  readonly byLevel: Readonly<Record<AnswerVerificationLevel, number>>;
  readonly items: Readonly<Record<string, AnswerVerificationLevel>>;
  /** key well-formed (any level except UNVERIFIED-for-malformed). */
  readonly formatValidRate: number;
  /** independently re-derived correct. */
  readonly deterministicCorrectnessVerifiedRate: number;
  /** needs an AI or human crosscheck before it can be trusted (FORMAT_VERIFIED ∪ AI_CROSSCHECK_REQUIRED). */
  readonly crosscheckRequiredRate: number;
  /** malformed OR proven wrong OR nothing ran. */
  readonly unverifiedRate: number;
}

export function summarizeAnswerVerification(batch: GeneratedExerciseBatch): AnswerVerificationSummary {
  const items: Record<string, AnswerVerificationLevel> = {};
  const byLevel: Record<AnswerVerificationLevel, number> = {
    FORMAT_VERIFIED: 0,
    DETERMINISTIC_CORRECTNESS_VERIFIED: 0,
    AI_CROSSCHECK_REQUIRED: 0,
    HUMAN_GOLDEN_VERIFIED: 0,
    UNVERIFIED: 0,
  };
  let formatValid = 0;
  for (const item of batch.items) {
    const v = verifyItemAnswer(item);
    items[item.id] = v.level;
    byLevel[v.level] += 1;
    if (v.formatValid) formatValid += 1;
  }
  const total = batch.items.length;
  const rate = (n: number) => (total > 0 ? n / total : 0);
  return {
    total,
    byLevel,
    items,
    formatValidRate: rate(formatValid),
    deterministicCorrectnessVerifiedRate: rate(byLevel.DETERMINISTIC_CORRECTNESS_VERIFIED + byLevel.HUMAN_GOLDEN_VERIFIED),
    crosscheckRequiredRate: rate(byLevel.FORMAT_VERIFIED + byLevel.AI_CROSSCHECK_REQUIRED),
    unverifiedRate: rate(byLevel.UNVERIFIED),
  };
}
