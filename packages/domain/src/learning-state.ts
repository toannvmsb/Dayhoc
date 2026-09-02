/**
 * Persisted learning-state vocabulary (migration group IX / F1 — docs 04 §4/§5).
 *
 * The Learning Twin / gaps / plan are DERIVED, recomputable from the append-only
 * `evidence` stream. These records persist the latest computed state so the
 * product does not recompute the whole pipeline per request. `child_id` is the
 * durable owner. Nothing here is irreplaceable — a rebuild from `evidence`
 * overwrites every derived row.
 *
 * `assignments` / `attempts` / `attempt_answers` are GENUINE student work
 * (append-only) that feeds BACK into `evidence`.
 */

export const LEARNING_SNAPSHOT_KINDS = ['TWIN', 'GAPS', 'CONTEXT', 'FRONTIER'] as const;
export type LearningSnapshotKind = (typeof LEARNING_SNAPSHOT_KINDS)[number];

export interface LearningStateSnapshot {
  readonly childId: string;
  readonly kind: LearningSnapshotKind;
  readonly state: unknown; // the serialised twin / gaps / context blob
  readonly stateVersion: string;
  readonly evidenceCount: number;
  readonly contentHash: string;
  readonly provenance: Record<string, unknown>;
  readonly computedAt: string;
}

export interface SkillStateRow {
  readonly childId: string;
  readonly skillId: string;
  readonly mastery: number; // 0..100
  readonly confidence: number; // 0..1
  readonly retention: number | null;
  readonly evidenceCount: number;
  readonly lastObservedAt: string | null;
  readonly lastVerifiedAt: string | null;
  readonly computedFromEvidenceCount: number;
  readonly computedAt: string;
}

export interface PersistedGapRow {
  readonly id: string;
  readonly childId: string;
  readonly gapType: string;
  readonly targetSkillId: string;
  readonly rootSkillId: string | null;
  readonly severity: number;
  readonly priority: number;
  readonly lifecycleState: string;
  readonly blocksCurrentLearning: boolean;
  readonly blocksAdvancedLearning: boolean;
  readonly rationale: string | null;
  readonly evidenceRefs: readonly string[];
  readonly detectedAt: string;
  readonly updatedAt: string;
  readonly computedFromEvidenceCount: number;
}

export interface PersistedPlanRow {
  readonly id: string;
  readonly childId: string;
  readonly planDate: string;
  readonly availableMinutes: number;
  readonly kind: string;
  readonly mix: Record<string, number>;
  readonly plannerVersion: string | null;
  readonly createdAt: string;
  readonly items: readonly PersistedPlanItemRow[];
}
export interface PersistedPlanItemRow {
  readonly orderIndex: number;
  readonly actionKind: string;
  readonly skillId: string | null;
  readonly minutes: number;
  readonly payload: Record<string, unknown>;
}

export const ASSIGNMENT_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export interface AssignmentRow {
  readonly id: string;
  readonly childId: string;
  readonly learningPlanId: string | null;
  readonly subjectId: string | null;
  readonly assignedByUserId: string | null;
  readonly assignedByRole: 'PARENT' | 'TEACHER' | 'SYSTEM' | null;
  readonly source: 'LEGACY_PRACTICE' | 'AI_GENERATED';
  readonly generationSpecId: string | null;
  readonly generatedExerciseSetId: string | null;
  readonly mode: string;
  readonly targetSkillIds: readonly string[];
  readonly status: AssignmentStatus;
  readonly dueDate: string | null;
  readonly createdAt: string;
  readonly completedAt: string | null;
}

export interface AssignmentItemRow {
  readonly id: string;
  readonly assignmentId: string;
  readonly orderIndex: number;
  readonly questionRef: string | null;
  readonly skillId: string | null;
  readonly problemTypeId: string | null;
  readonly knowledgeLevel: number | null;
  readonly thinkingLevel: number | null;
  readonly prompt: unknown;
  readonly answerSpec: unknown;
  readonly hints: readonly unknown[];
}

export const ATTEMPT_STATUSES = ['IN_PROGRESS', 'SUBMITTED', 'ABANDONED'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export interface AttemptRow {
  readonly id: string;
  readonly assignmentId: string | null;
  readonly childId: string;
  readonly status: AttemptStatus;
  readonly startedAt: string;
  readonly submittedAt: string | null;
}

export interface AttemptAnswerRow {
  readonly id: string;
  readonly attemptId: string;
  readonly assignmentItemId: string;
  readonly childAnswer: unknown;
  readonly hintsUsed: number;
  readonly reasoningText: string | null;
  readonly timeSpentSeconds: number | null;
  /** From `@copilot/domain` AnswerVerificationLevel — never claim CORRECTNESS when not proven. */
  readonly verificationLevel: string;
  readonly correct: boolean | null;
  readonly verifiedAt: string | null;
  readonly evidenceId: string | null;
  readonly createdAt: string;
}
