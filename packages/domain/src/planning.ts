import type { ChildId, GapId, ProblemTypeId, SkillId } from './identifiers.js';
import type { KnowledgeLevel, ThinkingLevel } from './taxonomy.js';
import type { LearningMix } from './roles.js';

/** The kinds of Next Best Learning Action (Math Core §40). */
export const LEARNING_ACTION_KINDS = [
  'review_prerequisite',
  'practice_current_skill',
  'close_gap',
  'harder_problem_type',
  'thinking_challenge',
  'advanced_extension',
  'exam_revision',
  'retention_check',
  'no_extra_practice',
] as const;
export type LearningActionKind = (typeof LEARNING_ACTION_KINDS)[number];

/** One ordered step in a daily plan. */
export interface PlannedAction {
  readonly kind: LearningActionKind;
  /** Which learning-mix bucket this action spends against. */
  readonly mixBucket: 'school' | 'gapRepair' | 'advanced' | 'thinking';
  readonly targetSkillId?: SkillId;
  readonly gapId?: GapId;
  readonly estimatedMinutes: number;
  /** Expected learning value per minute (0..1) — the greedy planner maximises Σ. */
  readonly roiPerMinute: number;
  readonly parentFacingTitle: string;
  readonly childFacingTitle: string;
  readonly rationale: string;
}

export interface DailyPlan {
  readonly kind: 'plan';
  readonly childId: ChildId;
  readonly planDate: string; // YYYY-MM-DD
  readonly availableMinutes: number;
  readonly mix: LearningMix;
  readonly situation: PlanningSituation;
  readonly orderedActions: readonly PlannedAction[];
  readonly createdAt: string; // ISO
}

export interface NoPlanNeeded {
  readonly kind: 'no_plan_needed';
  readonly childId: ChildId;
  readonly planDate: string;
  readonly reason: string;
  readonly createdAt: string;
}

export type DailyPlanResult = DailyPlan | NoPlanNeeded;

export const PLANNING_SITUATIONS = [
  'normal_week',
  'after_gap_detected',
  'strong_student',
  'exam_soon',
] as const;
export type PlanningSituation = (typeof PLANNING_SITUATIONS)[number];

// --- Practice ---

export interface Question {
  readonly id: string;
  readonly skillId: SkillId;
  readonly problemTypeId?: ProblemTypeId;
  readonly knowledgeLevel: KnowledgeLevel;
  readonly thinkingLevel: ThinkingLevel;
  readonly prompt: string;
  readonly answerSpec: AnswerSpec;
  /** Hint ladder — ordered rungs (Math Core §13/§17). */
  readonly hints: readonly string[];
  readonly workedSolution: string;
  readonly origin: 'authored' | 'ai_generated';
  readonly aiInferenceId?: string;
}

export type AnswerSpec =
  | { readonly kind: 'exact'; readonly value: string }
  | { readonly kind: 'fraction'; readonly numerator: number; readonly denominator: number }
  | { readonly kind: 'numeric'; readonly value: number; readonly tolerance: number }
  | { readonly kind: 'choice'; readonly correct: string; readonly options: readonly string[] }
  | { readonly kind: 'reasoning' }; // graded on explanation, not a single answer

export interface Assignment {
  readonly id: string;
  readonly childId: ChildId;
  readonly dailyPlanDate?: string;
  readonly mode: 'practice' | 'gap_repair' | 'challenge' | 'revision' | 'diagnostic';
  readonly targetSkillIds: readonly SkillId[];
  readonly questionIds: readonly string[];
  readonly createdAt: string;
}

/** The six-rung hint ladder (Math Core §17). */
export const HINT_RUNGS = [
  'orientation', // gợi ý định hướng
  'guiding_question', // câu hỏi dẫn
  'second_hint',
  'simpler_analogue', // ví dụ đơn giản hơn
  'retry_original',
  'full_solution', // chỉ khi thật cần
] as const;
export type HintRung = (typeof HINT_RUNGS)[number];

export interface HintLadderState {
  readonly questionId: string;
  readonly rung: HintRung | 'none';
  readonly rungsRevealed: number;
  readonly attempts: number;
  readonly resolved: boolean;
  /** 0..1 — used as `hintDependency` when the submission becomes evidence. */
  readonly dependency: number;
}

export interface Submission {
  readonly id: string;
  readonly assignmentId: string;
  readonly questionId: string;
  readonly childId: ChildId;
  readonly childAnswer: string;
  readonly correct: boolean;
  readonly score?: number; // partial credit 0..1
  readonly hintsUsed: number;
  readonly maxHints: number;
  readonly reasoningText?: string;
  readonly timeSpentSeconds: number;
  readonly submittedAt: string; // ISO
}
