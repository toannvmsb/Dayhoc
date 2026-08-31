/**
 * Two INDEPENDENT difficulty axes (core invariant).
 * A K2 (standard-knowledge) item may still be a T5 (non-routine) item.
 * Never collapse these into one "difficulty" scalar.
 */

/** Knowledge Level — how advanced the required knowledge is. */
export const KNOWLEDGE_LEVELS = ['K0', 'K1', 'K2', 'K3', 'K4', 'K5'] as const;
export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

/** Grade-agnostic semantics for K-levels (per-grade display labels live in math-data). */
export const KNOWLEDGE_LEVEL_MEANING: Record<KnowledgeLevel, string> = {
  K0: 'prerequisite_gap',
  K1: 'concept_intro',
  K2: 'standard',
  K3: 'strong',
  K4: 'advanced_or_HSG',
  K5: 'competition',
};

/** Thinking Level — how much reasoning the item demands, independent of knowledge. */
export const THINKING_LEVELS = ['T1', 'T2', 'T3', 'T4', 'T5'] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const THINKING_LEVEL_MEANING: Record<ThinkingLevel, string> = {
  T1: 'recall_execute',
  T2: 'recognize_apply',
  T3: 'transform_combine',
  T4: 'strategic_reasoning',
  T5: 'nonroutine_challenge',
};

/** Domains (Math Core §5). Extendable as grades expand. */
export const DOMAINS = [
  'number_sense',
  'arithmetic',
  'algebraic_thinking',
  'word_problems',
  'fractions',
  'geometry',
  'measurement',
  'statistics_probability',
  'logical_reasoning',
  'pattern_reasoning',
  'combinatorial_thinking',
] as const;
export type Domain = (typeof DOMAINS)[number];

/** Thinking dimensions form the Thinking Profile — kept separate from knowledge mastery. */
export const THINKING_DIMENSIONS = [
  'number_sense',
  'logical_reasoning',
  'pattern_recognition',
  'problem_representation',
  'strategic_choice',
  'algebraic_thinking',
  'spatial_reasoning',
  'proof_explanation',
  'combinatorial_thinking',
  'reverse_reasoning',
] as const;
export type ThinkingDimension = (typeof THINKING_DIMENSIONS)[number];
