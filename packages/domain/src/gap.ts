import type { ChildId, GapId, SkillId } from './identifiers.js';

/**
 * Gap taxonomy (Math Core §19). The engine MUST be able to discriminate these —
 * see the golden discrimination matrix. A careless error is NOT a knowledge gap.
 */
export const GAP_TYPES = [
  'concept_gap',
  'prerequisite_gap',
  'method_gap',
  'recognition_gap',
  'application_gap',
  'reasoning_gap',
  'procedural_gap',
  'retention_gap',
  'careless_error',
  'reading_error',
  'presentation_error',
] as const;
export type GapType = (typeof GAP_TYPES)[number];

/** The eight discrimination targets the engine must separate (Golden Test §1.1). */
export const CORE_DISCRIMINATION_TARGETS = [
  'concept_gap',
  'prerequisite_gap',
  'careless_error',
  'method_gap',
  'recognition_gap',
  'application_gap',
  'reasoning_gap',
  'retention_gap',
] as const satisfies readonly GapType[];

/** Gap lifecycle (Math Core §22). A gap never closes after a single correct answer. */
export const GAP_LIFECYCLE_STATES = [
  'DETECTED',
  'CONFIRMED',
  'TREATING',
  'IMPROVING',
  'CLOSED',
  'MONITORING',
] as const;
export type GapLifecycleState = (typeof GAP_LIFECYCLE_STATES)[number];

/** Allowed forward transitions in the gap lifecycle. */
export const GAP_TRANSITIONS: Record<GapLifecycleState, readonly GapLifecycleState[]> = {
  DETECTED: ['CONFIRMED'],
  CONFIRMED: ['TREATING'],
  TREATING: ['IMPROVING', 'TREATING'],
  IMPROVING: ['CLOSED', 'TREATING'],
  CLOSED: ['MONITORING'],
  MONITORING: ['CLOSED', 'DETECTED'],
};

export interface KnowledgeGap {
  readonly id: GapId;
  readonly childId: ChildId;
  readonly type: GapType;
  readonly targetSkillId: SkillId;
  readonly rootSkillId?: SkillId;
  readonly severity: number; // 0..1
  readonly priority: number; // gap_score
  readonly lifecycleState: GapLifecycleState;
  readonly detectedAt: string; // ISO
}
