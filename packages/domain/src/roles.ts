/** User roles. Parent is the primary user; Child is a beneficiary with a minimal, child-safe surface. */
export const ROLES = ['parent', 'child', 'teacher', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Learning-mix dimensions used by the planner (Blueprint §6, Math Core §24). */
export const LEARNING_MIX_DIMENSIONS = [
  'school',
  'gapRepair',
  'advanced',
  'thinking',
] as const;
export type LearningMixDimension = (typeof LEARNING_MIX_DIMENSIONS)[number];

export type LearningMix = Record<LearningMixDimension, number>;
