import type { ChildId, SkillId } from './identifiers.js';
import type { GapType } from './gap.js';
import type { LearningMix } from './roles.js';

export interface Exam {
  readonly id: string;
  readonly childId: ChildId;
  readonly examDate: string; // YYYY-MM-DD
  readonly subject: string;
  /** Official scope if the parent/teacher entered it; otherwise inferred. */
  readonly scopeSkillIds?: readonly SkillId[];
  readonly inferredScope?: {
    readonly skillIds: readonly SkillId[];
    readonly confidence: number; // 0..1
    readonly needsParentConfirm: boolean;
  };
}

export interface RevisionPriorityItem {
  readonly skillId: SkillId;
  readonly name: string;
  readonly priority: number; // 0..1 — probability_in_exam × gap × forgetting × importance × prereq_impact
  readonly band: 'ưu_tiên_cao' | 'nhắc_lại' | 'đã_ổn';
  readonly reason: string;
}

export interface RevisionPlan {
  readonly childId: ChildId;
  readonly examId: string;
  readonly dayCountdown: number;
  readonly dailyMinutes: number;
  readonly priorityItems: readonly RevisionPriorityItem[];
  readonly createdAt: string;
}

// --- post-exam assessment ---
export interface AssessmentQuestionOutcome {
  readonly questionRef: string;
  readonly skillId: SkillId;
  readonly problemTypeId?: SkillId;
  readonly awardedScore: number; // 0..1
  readonly stepsObserved?: readonly string[];
  readonly reasoningQuality?: 'weak' | 'adequate' | 'strong';
}

export interface LostPoint {
  readonly questionRef: string;
  readonly skillId: SkillId;
  readonly lostFraction: number; // 1 - awardedScore
  readonly classification: GapType;
  readonly note: string;
}

export interface AssessmentDiagnosis {
  readonly childId: ChildId;
  readonly examId: string;
  readonly totalAwarded: number; // 0..1 overall
  readonly lostPoints: readonly LostPoint[];
  /** Skills to prioritise afterwards, worst first. */
  readonly remediationSkillIds: readonly SkillId[];
}

// --- weekly report ---
export interface WeeklyReport {
  readonly childId: ChildId;
  readonly weekOf: string; // YYYY-MM-DD (Monday)
  readonly stats: {
    readonly sessions: number;
    readonly totalMinutes: number;
    readonly skillsSteady: number;
  };
  readonly progress: readonly string[];
  readonly needsFollowUp: readonly string[];
  readonly nextWeekMix: LearningMix;
  readonly nextWeekNote: string;
}

// --- notifications ---
export const NOTIFICATION_TYPES = [
  'gap_detected',
  'exam_upcoming',
  'revision_reminder',
  'plan_ready',
  'weekly_report_ready',
  'teacher_updated',
  'child_finished_tasks',
  'relationship_request_received',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface Notification {
  readonly id: string;
  readonly targetUserId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}
