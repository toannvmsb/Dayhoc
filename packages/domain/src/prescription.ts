import type { ChildId, GapId, SkillId } from './identifiers.js';
import type { GapLifecycleState, GapType } from './gap.js';

/** Append-only audit record for every gap lifecycle transition (DB Model §4). */
export interface GapLifecycleEvent {
  readonly id: string;
  readonly gapId: GapId;
  readonly fromState: GapLifecycleState;
  readonly toState: GapLifecycleState;
  readonly reason: string;
  readonly evidenceRef?: string;
  readonly createdAt: string; // ISO
}

/** Multiplicative breakdown of the gap-priority score (Math Core §21). */
export interface GapScoreBreakdown {
  readonly targetMasteryDifference: number; // 0..1
  readonly evidenceConfidence: number; // 0..1
  readonly recurrenceFactor: number; // >= 1
  readonly prerequisiteImportance: number; // 0..1
  readonly futureDependency: number; // 0..1 (how much upcoming learning it blocks)
  readonly learningGoalWeight: number; // 0..1
  readonly score: number; // product, normalized
  readonly band: 'low' | 'medium' | 'high';
}

/** A gap the engine detected, with its diagnostic reasoning attached. */
export interface DetectedGap {
  readonly id: GapId;
  readonly childId: ChildId;
  readonly type: GapType;
  readonly targetSkillId: SkillId;
  readonly rootSkillId: SkillId; // === target when the gap is in the skill itself
  readonly severity: number; // 0..1
  readonly lifecycleState: GapLifecycleState;
  readonly evidenceRefs: readonly string[];
  readonly detectedAt: string; // ISO
  readonly score: GapScoreBreakdown;
  /** Short, parent-facing "vì sao app nghĩ vậy?" (UI/UX Spec §9). */
  readonly rationale: string;
  /** Confusable types the engine explicitly ruled out (auditability). */
  readonly ruledOut: readonly GapType[];
  readonly blocksCurrentLearning: boolean;
  readonly blocksAdvancedLearning: boolean;
}

/** Learning readiness for a target skill (Math Core §25). */
export interface LearningReadiness {
  readonly childId: ChildId;
  readonly targetSkillId: SkillId;
  readonly readinessScore: number; // 0..1
  readonly breakdown: {
    readonly prerequisiteMastery: number;
    readonly problemTypeMastery: number;
    readonly thinkingReadiness: number;
    readonly retentionConfidence: number;
  };
  /**
   * repair_first — prerequisites too weak, hold the new skill.
   * parallel_repair — keep the (advanced) path AND dose gap repair (Grade 7 rule).
   * ready — go.
   */
  readonly recommendation: 'ready' | 'parallel_repair' | 'repair_first';
  readonly weakPrerequisites: readonly SkillId[];
}

/** Exercise dose for a prescription (Math Core §23). */
export interface ExerciseDose {
  readonly foundation: number;
  readonly standard: number;
  readonly application: number;
  readonly thinking: number;
}

/** A concrete remediation plan for one gap (Math Core §23, UI/UX Spec §9). */
export interface LearningPrescription {
  readonly id: string;
  readonly childId: ChildId;
  readonly gapId: GapId;
  readonly gapLabel: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly rootGapLabel: string;
  readonly durationDays: number;
  readonly sessions: number;
  readonly minutesPerSession: number;
  readonly dose: ExerciseDose;
  readonly retestItems: number;
  readonly retentionCheckDays: number;
  readonly blocksCurrentLearning: boolean;
  readonly blocksAdvancedLearning: boolean;
  /** Parent-friendly explanation: what's missing, why it matters, how much practice. */
  readonly rationale: string;
  /** The parent's four choices (UI/UX Spec §9) — engine offers, parent picks. */
  readonly options: readonly PrescriptionOption[];
  readonly createdAt: string; // ISO
}

export interface PrescriptionOption {
  readonly key: 'follow' | 'lighter' | 'intensify' | 'later';
  readonly label: string;
  readonly sessions: number;
  readonly minutesPerSession: number;
  readonly durationDays: number;
}
