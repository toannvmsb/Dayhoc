import type { AnswerVerificationLevel, GeneratedExercise, GeneratedExerciseBatch } from '@copilot/domain';

/**
 * Answer verification (doc 14 C5 §9). An AI-provided answer is never assumed
 * correct. This module classifies, per item, how sure we are — separate from
 * `ItemValidationOutcome`, which only checks contract SHAPE (schema, ids,
 * K/T range, etc.), not whether the answer key is actually right.
 *
 * Scope (honest, not overclaimed): for `exact` / `numeric` / `fraction` /
 * `choice`, "deterministic verification" here means the answer key is
 * internally well-formed and self-consistent (options contain the correct
 * choice, denominator ≠ 0, value finite, etc. — the same shape the validator
 * already enforces via `ANSWER_INCONSISTENT`/`ANSWER_UNVERIFIABLE`, so an item
 * that reached this stage already passed that gate). It does NOT re-derive the
 * answer from the word-problem prompt (that needs a symbolic math solver —
 * out of scope for C5; the second-pass verifier trigger in `verifier.ts`
 * exists precisely for the ambiguous/suspicious cases this can't catch).
 * `reasoning` items have no deterministic checker at all — they are always
 * `AI_CROSSCHECK_REQUIRED` until a human or a second-pass AI verifier confirms
 * them; **no exercise with an unverified factual/numeric answer may become
 * production-deliverable** (doc 14 C5 §9) — this module is what a future LIVE
 * gate would read to enforce that.
 */
export function assessItemAnswerVerification(item: GeneratedExercise): AnswerVerificationLevel {
  switch (item.answerSpec.kind) {
    case 'reasoning':
      return 'AI_CROSSCHECK_REQUIRED';
    case 'exact':
      return item.answerSpec.value.trim().length > 0 ? 'DETERMINISTIC_VERIFIED' : 'UNVERIFIED';
    case 'numeric':
      return Number.isFinite(item.answerSpec.value) && item.answerSpec.tolerance >= 0
        ? 'DETERMINISTIC_VERIFIED'
        : 'UNVERIFIED';
    case 'fraction':
      return item.answerSpec.denominator !== 0 ? 'DETERMINISTIC_VERIFIED' : 'UNVERIFIED';
    case 'choice':
      return item.answerSpec.options.includes(item.answerSpec.correct) && item.answerSpec.options.length >= 2
        ? 'DETERMINISTIC_VERIFIED'
        : 'UNVERIFIED';
    default:
      return 'UNVERIFIED';
  }
}

export interface AnswerVerificationSummary {
  readonly total: number;
  readonly byLevel: Readonly<Record<AnswerVerificationLevel, number>>;
  readonly items: Readonly<Record<string, AnswerVerificationLevel>>;
  /** Share of items that are DETERMINISTIC_VERIFIED or HUMAN_GOLDEN_VERIFIED. */
  readonly verifiedRate: number;
  readonly unverifiedRate: number;
}

export function summarizeAnswerVerification(batch: GeneratedExerciseBatch): AnswerVerificationSummary {
  const items: Record<string, AnswerVerificationLevel> = {};
  const byLevel: Record<AnswerVerificationLevel, number> = {
    DETERMINISTIC_VERIFIED: 0,
    AI_CROSSCHECK_REQUIRED: 0,
    HUMAN_GOLDEN_VERIFIED: 0,
    UNVERIFIED: 0,
  };
  for (const item of batch.items) {
    const level = assessItemAnswerVerification(item);
    items[item.id] = level;
    byLevel[level] += 1;
  }
  const total = batch.items.length;
  const verified = byLevel.DETERMINISTIC_VERIFIED + byLevel.HUMAN_GOLDEN_VERIFIED;
  return {
    total,
    byLevel,
    items,
    verifiedRate: total > 0 ? verified / total : 0,
    unverifiedRate: total > 0 ? byLevel.UNVERIFIED / total : 0,
  };
}
