import type { ChildLearningTwin, GapType, SkillId } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapConfig } from './config.js';

/**
 * Error-signature classification (Golden Error Dataset pipeline).
 *
 * The AI/scan layer proposes an `error_signature` for an observed wrong answer.
 * This deterministic step maps that signature — together with prerequisite state,
 * problem thinking level and evidence corroboration — to a gap type. The AI never
 * decides the gap type directly (non-negotiable rule 7); it only proposes the
 * signature.
 */

/** Base signature → gap type. Deterministic overrides are applied on top. */
const SIGNATURE_TO_GAP: Record<string, GapType> = {
  // procedure / method
  procedure_error: 'method_gap',
  theorem_selection_error: 'method_gap',
  inverse_operation_error: 'method_gap',
  ratio_translation_error: 'method_gap',
  formula_without_structure: 'method_gap',
  // concept
  concept_error: 'concept_gap',
  definition_confusion: 'concept_gap',
  concept_confusion: 'concept_gap',
  like_term_error: 'concept_gap',
  // careless
  careless_error: 'careless_error',
  careless_simplification: 'careless_error',
  calculation_error: 'careless_error',
  calculation_after_correct_model: 'careless_error',
  // reasoning
  thinking_strategy_failure: 'reasoning_gap',
  nonlinear_structure_missed: 'reasoning_gap',
  counting_double_count: 'reasoning_gap',
  // presentation
  reasoning_jump: 'presentation_error',
  careless_unit_error: 'presentation_error',
  // recognition
  identity_not_recognized: 'recognition_gap',
  pattern_surface_guess: 'recognition_gap',
  structure_missed: 'recognition_gap',
  // reading
  data_read_error: 'reading_error',
  reading_error: 'reading_error',
  // application
  constraint_substitution_error: 'application_gap',
  representation_error: 'application_gap',
  // prerequisite-flavoured procedural
  fraction_procedure_error: 'prerequisite_gap',
  sign_error: 'prerequisite_gap',
  sign_distribution_error: 'prerequisite_gap',
  algebra_sign_error: 'prerequisite_gap',
  conversion_direction_error: 'prerequisite_gap',
  // retention
  conversion_factor_error: 'retention_gap',
};

export interface SignatureClassificationInput {
  readonly errorSignature: string;
  readonly skillId: SkillId;
  readonly problemTypeId?: string;
  readonly thinkingLevel?: string;
  readonly twin: ChildLearningTwin;
  readonly knowledgeBase: KnowledgeBase;
  readonly config: GapConfig;
  /** Repeated same-signature observations raise confidence + can escalate. */
  readonly corroboratingObservations?: number;
  /** Verified (test/teacher) evidence raises confidence. */
  readonly verifiedEvidence?: boolean;
}

export interface SignatureClassification {
  readonly gapType: GapType;
  readonly confidence: 'low' | 'medium' | 'high';
  readonly rootSkillId: SkillId;
  readonly overrideApplied: string | null;
  readonly masteryUpdate: 'none' | 'minimal_provisional' | 'provisional_penalty';
}

const HIGH_THINKING = new Set(['T4', 'T5']);

export function classifyErrorSignature(input: SignatureClassificationInput): SignatureClassification {
  const { errorSignature, skillId, twin, knowledgeBase: kb, config } = input;
  const base = SIGNATURE_TO_GAP[errorSignature] ?? 'concept_gap';

  let gapType = base;
  let rootSkillId = skillId;
  let overrideApplied: string | null = null;

  // -- deterministic overrides --

  // 1) A high-thinking (T4/T5) failure on a signature that isn't already reasoning/
  //    recognition is very likely a thinking gap, NOT a knowledge gap
  //    (non-negotiable rule 3).
  if (
    HIGH_THINKING.has(input.thinkingLevel ?? '') &&
    (base === 'concept_gap' || base === 'method_gap') &&
    skillMastery(twin, skillId) >= config.strongMastery - 5
  ) {
    gapType = 'reasoning_gap';
    overrideApplied = 'high_thinking_with_strong_knowledge';
  }

  // 2) If a blocking prerequisite is weak AND has evidence, the root is there —
  //    regardless of the surface signature (Math Core §20). Never invent an
  //    unobserved prerequisite (rule for above-grade failures).
  const weakPre = weakEvidencedPrerequisite(skillId, twin, kb, config);
  if (weakPre) {
    gapType = 'prerequisite_gap';
    rootSkillId = weakPre;
    overrideApplied = overrideApplied ? `${overrideApplied}+prerequisite_root` : 'prerequisite_root';
  }

  // 3) Careless never becomes a knowledge gap on one observation, and never
  //    carries more than a minimal mastery update (non-negotiable rules 1, 2).
  const corroboration = input.corroboratingObservations ?? 0;
  let confidence: SignatureClassification['confidence'];
  if (input.verifiedEvidence || corroboration >= 2) confidence = 'high';
  else if (corroboration >= 1) confidence = 'medium';
  else confidence = 'low';

  let masteryUpdate: SignatureClassification['masteryUpdate'];
  if (gapType === 'careless_error' || gapType === 'presentation_error') {
    masteryUpdate = 'minimal_provisional';
  } else if (confidence === 'high') {
    masteryUpdate = 'provisional_penalty';
  } else {
    masteryUpdate = 'minimal_provisional';
  }

  return { gapType, confidence, rootSkillId, overrideApplied, masteryUpdate };
}

function skillMastery(twin: ChildLearningTwin, id: SkillId): number {
  return twin.skillMastery.get(id)?.mastery ?? 45;
}

function weakEvidencedPrerequisite(
  skillId: SkillId,
  twin: ChildLearningTwin,
  kb: KnowledgeBase,
  config: GapConfig,
): SkillId | null {
  const edges = kb.prerequisites.filter((e) => e.to === skillId && e.importance >= config.blockingImportance);
  let worst: { id: SkillId; mastery: number } | null = null;
  for (const e of edges) {
    const st = twin.skillMastery.get(e.from);
    if (st && st.evidenceCount > 0 && st.mastery < config.weakPrerequisite) {
      if (!worst || st.mastery < worst.mastery) worst = { id: e.from, mastery: st.mastery };
    }
  }
  return worst?.id ?? null;
}
