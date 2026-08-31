import {
  asProblemTypeId,
  asSkillId,
  type Evidence,
  type Question,
  type ReasoningQuality,
  type Submission,
} from '@copilot/domain';

export interface SubmissionToEvidenceInput {
  readonly submission: Submission;
  readonly question: Question;
  readonly at: string; // ISO — recordedAt
  readonly newId: () => string;
  /** Optional explicit grading of the reasoning text (else inferred crudely). */
  readonly reasoningQuality?: ReasoningQuality;
}

/**
 * Close the learning loop (Math Core §29): a practice submission becomes an
 * append-only Evidence record that feeds the next twin recompute.
 *
 * - `hintDependency` = hintsUsed / maxHints (so heavily-hinted correct answers
 *   raise mastery only a little)
 * - reasoning questions are scored on the explanation, not a single answer
 * - confidence tier is B (app practice) — never "verified"
 */
export function submissionToEvidence(input: SubmissionToEvidenceInput): Evidence {
  const { submission: s, question: q } = input;

  const reasoningQuality: ReasoningQuality | undefined =
    input.reasoningQuality ??
    (s.reasoningText === undefined
      ? undefined
      : s.reasoningText.trim().length >= 60
        ? 'strong'
        : s.reasoningText.trim().length >= 15
          ? 'adequate'
          : 'weak');

  const score =
    q.answerSpec.kind === 'reasoning'
      ? reasoningQuality === 'strong'
        ? 1
        : reasoningQuality === 'adequate'
          ? 0.6
          : 0.2
      : s.score;

  return {
    id: `ev_${input.newId()}` as Evidence['id'],
    childId: s.childId,
    source: 'app_practice',
    occurredAt: s.submittedAt,
    recordedAt: input.at,
    skillId: asSkillId(q.skillId),
    ...(q.problemTypeId ? { problemTypeId: asProblemTypeId(q.problemTypeId) } : {}),
    result: {
      correct: q.answerSpec.kind === 'reasoning' ? (score ?? 0) >= 0.6 : s.correct,
      ...(score !== undefined ? { score } : {}),
    },
    ...(reasoningQuality ? { reasoningQuality } : {}),
    hintDependency: s.maxHints > 0 ? clamp01(s.hintsUsed / s.maxHints) : 0,
    timeSpentSeconds: s.timeSpentSeconds,
    confidenceTier: 'B',
    provenance: 'manual',
  };
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
