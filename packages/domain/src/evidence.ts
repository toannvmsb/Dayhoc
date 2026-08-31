import type { ChildId, EvidenceId, ProblemTypeId, SkillId } from './identifiers.js';

/** Where an observation came from (Math Core §3). */
export const EVIDENCE_SOURCES = [
  'school_test',
  'school_exam',
  'school_homework',
  'app_worksheet',
  'app_practice',
  'diagnostic',
  'parent_feedback',
  'teacher_feedback',
  'notebook_scan',
  'teacher_message_scan',
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * Evidence confidence hierarchy (Math Core §3):
 *  A verified · B strong · C supporting · D estimated.
 * Distinct from AI-model confidence — an AI guess never becomes "verified" on its own.
 */
export const CONFIDENCE_TIERS = ['A', 'B', 'C', 'D'] as const;
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/** How the record entered the system (audit/provenance). */
export const PROVENANCE = ['manual', 'scan', 'assessment', 'teacher', 'parent'] as const;
export type Provenance = (typeof PROVENANCE)[number];

/**
 * A single append-only observation. Never updated or deleted.
 * Mastery/gap/readiness are derived from an ordered stream of these.
 */
export interface Evidence {
  readonly id: EvidenceId;
  readonly childId: ChildId;
  readonly source: EvidenceSource;
  readonly occurredAt: string; // ISO
  readonly recordedAt: string; // ISO
  readonly skillId?: SkillId;
  readonly problemTypeId?: ProblemTypeId;
  readonly result: EvidenceResult;
  readonly reasoningQuality?: ReasoningQuality;
  readonly hintDependency?: number; // 0..1
  readonly timeSpentSeconds?: number;
  readonly confidenceTier: ConfidenceTier;
  readonly provenance: Provenance;
  readonly aiInferenceId?: string;
}

export interface EvidenceResult {
  readonly correct?: boolean;
  readonly score?: number; // 0..1 for partial credit
  readonly steps?: readonly string[];
}

export const REASONING_QUALITY = ['weak', 'adequate', 'strong'] as const;
export type ReasoningQuality = (typeof REASONING_QUALITY)[number];
