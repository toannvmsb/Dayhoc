import type { ExerciseFinding, ExerciseValidationReasonCode } from '@copilot/domain';
import type { SlotRequest } from './generator.js';
import type { GenerationGrounding } from './grounding.js';

/**
 * Repair / regeneration policy (doc 14 C4 §K). Validator reason codes map to
 * DETERMINISTIC instructions — the validator's free-text `detail` is NEVER piped
 * straight to the generator.
 */
const INSTRUCTION: Record<ExerciseValidationReasonCode, string> = {
  SCHEMA_INVALID: 'Return an item that matches the generatedExerciseBatch.v1 schema exactly.',
  MISSING_ANSWER: 'Provide a complete, checkable answerSpec.',
  MISSING_SOLUTION: 'Provide a full worked solution.',
  MISSING_RUBRIC: 'Add a grading rubric for the reasoning answer (how to award partial credit).',
  HINT_LADDER_MALFORMED: 'Provide exactly 6 non-empty hint rungs; the last rung is the full solution.',
  UNKNOWN_SKILL_ID: 'Use only skillId values from the grounding target skills.',
  UNKNOWN_REQUIRED_SKILL_ID: 'requiredSkillIds must be real skill ids from the grounding (target skills or their listed prerequisites).',
  SKILL_NOT_IN_SPEC: 'Regenerate for a skill that is in the grounding target skills.',
  UNKNOWN_PROBLEM_TYPE: 'Drop problemTypeId, or use one listed under the skill in the grounding.',
  PROBLEM_TYPE_SKILL_MISMATCH: 'Use a problemTypeId listed under this exact skill, or drop it.',
  OUTSIDE_K_RANGE: 'Regenerate with knowledgeLevel inside the grounding K range.',
  OUTSIDE_T_RANGE: 'Regenerate with thinkingLevel inside the grounding T range.',
  CHALLENGE_EXCEEDS_SPEC: 'Prerequisite-repair items must stay at or below K2.',
  UNLEARNED_REQUIRED_KNOWLEDGE:
    'Regenerate so the item does not require a forbidden prerequisite: keep it at K1 concept-intro level or narrow requiredSkillIds.',
  ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED: 'Do not use a skill whose knowledge originates above the school grade.',
  ANSWER_UNVERIFIABLE: 'Provide an answerSpec that can be checked deterministically.',
  ANSWER_INCONSISTENT: 'Make the answer key consistent with the prompt and options.',
  DUPLICATE_VARIANT: 'Regenerate a structurally different variant (different numbers AND surface story).',
  REFERENCE_EXAMPLE_COPY: 'Regenerate an original item — do not reuse a grounding reference example, even with different numbers.',
  UNSAFE_CONTENT: 'Regenerate with age-appropriate, neutral context.',
  NOT_AGE_APPROPRIATE: 'Regenerate with age-appropriate context for a lower-secondary pupil.',
  LANGUAGE_MISMATCH: 'Write the prompt and solution in Vietnamese with SGK notation.',
  DISTRIBUTION_MISMATCH: 'Return exactly the bucket counts in the grounding plan.',
  TARGET_ROLE_MISMATCH: 'Use a skill from this bucket’s binding in the grounding.',
  FRONTIER_SKILL_NOT_SELECTED: 'Do not introduce an above-grade skill — use only the grounding’s FRONTIER targets.',
  REQUIRED_SKILL_OUT_OF_BOUNDS: 'Keep requiredSkillIds inside the prerequisite closure of the item target.',
};

/** Which reason codes are repairable IN PLACE vs need a fresh slot. */
const REPAIR_IN_PLACE = new Set<ExerciseValidationReasonCode>([
  'MISSING_ANSWER',
  'MISSING_SOLUTION',
  'MISSING_RUBRIC',
  'HINT_LADDER_MALFORMED',
  'UNKNOWN_PROBLEM_TYPE',
  'PROBLEM_TYPE_SKILL_MISMATCH',
  'LANGUAGE_MISMATCH',
  'ANSWER_UNVERIFIABLE',
]);

export function instructionFor(code: ExerciseValidationReasonCode): string {
  return INSTRUCTION[code];
}

export function isRepairInPlace(code: ExerciseValidationReasonCode): boolean {
  return REPAIR_IN_PLACE.has(code);
}

/**
 * Build the slot-regeneration requests for the next generator call, from the
 * validator findings. One `SlotRequest` per affected item (deduped), plus
 * shortfall slots to reach `spec.totalQuestions`.
 */
export function slotRequestsFor(
  findings: readonly ExerciseFinding[],
  acceptedIds: ReadonlySet<string>,
  batchItems: readonly { id: string; bucket: SlotRequest['bucket']; skillId: SlotRequest['skillId'] }[],
  grounding: GenerationGrounding,
  shortfall: number,
): SlotRequest[] {
  const byItem = new Map<string, { code: ExerciseValidationReasonCode; instruction: string }>();
  for (const f of findings) {
    for (const id of f.questionIds) {
      if (acceptedIds.has(id)) continue;
      if (!byItem.has(id)) byItem.set(id, { code: f.code, instruction: instructionFor(f.code) });
    }
  }

  const out: SlotRequest[] = [];
  for (const [id, { code, instruction }] of byItem) {
    const item = batchItems.find((b) => b.id === id);
    if (!item) continue;
    out.push({ bucket: item.bucket, skillId: item.skillId, reasonCode: code, instruction, replaces: [id] });
  }

  // fill genuine shortfall with fresh slots on the largest bucket
  const [primaryBucket] = Object.entries(grounding.plan.distribution).sort((a, b) => b[1] - a[1])[0]!;
  for (let i = 0; i < shortfall; i++) {
    out.push({
      bucket: primaryBucket as SlotRequest['bucket'],
      skillId: grounding.targetSkills[0]!.skillId,
      reasonCode: 'SHORTFALL',
      instruction: 'Generate an additional valid item for this bucket to reach the required question count.',
      replaces: [],
    });
  }
  return out;
}
