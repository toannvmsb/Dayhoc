import { DEFAULT_STRETCH_CONFIG, type StretchConfig } from './stretch-zone.js';

/**
 * Parent-chosen learning goals (spec §1 "quản lý mục tiêu học", backlog B2-03).
 * A goal only tunes HOW MUCH of a worksheet is comfortable vs. stretch — it never changes which
 * skills are eligible, never lifts a child past an unmet prerequisite, and never rewrites mastery.
 */
export const LEARNING_GOALS = ['KEEP_PACE', 'CATCH_UP', 'ADVANCED', 'EXAM_PREP'] as const;
export type LearningGoalCode = (typeof LEARNING_GOALS)[number];

export const DEFAULT_LEARNING_GOAL: LearningGoalCode = 'KEEP_PACE';

export interface LearningGoalInfo {
  readonly code: LearningGoalCode;
  readonly label: string;
  readonly hint: string;
  /** [solvableShare, struggleShare] — must sum to 1. */
  readonly mix: readonly [number, number];
}

export const LEARNING_GOAL_INFO: Readonly<Record<LearningGoalCode, LearningGoalInfo>> = {
  KEEP_PACE: {
    code: 'KEEP_PACE',
    label: 'Giữ nhịp với lớp',
    hint: 'Ôn đúng phần con đang học ở trường, vừa sức, có một ít bài thử thách.',
    mix: [0.75, 0.25],
  },
  CATCH_UP: {
    code: 'CATCH_UP',
    label: 'Củng cố kiến thức nền',
    hint: 'Nhiều bài vừa sức hơn để con chắc phần còn yếu trước khi lên bài khó.',
    mix: [0.85, 0.15],
  },
  ADVANCED: {
    code: 'ADVANCED',
    label: 'Nâng cao / học sinh giỏi',
    hint: 'Tăng tỉ lệ bài thử thách, tiến dần tới đề nâng cao và đề học sinh giỏi.',
    mix: [0.6, 0.4],
  },
  EXAM_PREP: {
    code: 'EXAM_PREP',
    label: 'Ôn thi sắp tới',
    hint: 'Tập trung đúng phạm vi bài thi; vẫn giữ tỉ lệ vừa sức như bình thường.',
    mix: [0.75, 0.25],
  },
};

export function isLearningGoal(v: unknown): v is LearningGoalCode {
  return typeof v === 'string' && (LEARNING_GOALS as readonly string[]).includes(v);
}

/**
 * Stored goals are a free-form jsonb array — read it defensively. Accepts `["ADVANCED"]` or
 * `[{ code: "ADVANCED" }]`; unknown/garbled entries are dropped (never throw on stored data).
 */
export function parseStoredGoals(raw: unknown): LearningGoalCode[] {
  if (!Array.isArray(raw)) return [];
  const out: LearningGoalCode[] = [];
  for (const g of raw) {
    const code = typeof g === 'object' && g !== null ? (g as { code?: unknown }).code : g;
    if (isLearningGoal(code) && !out.includes(code)) out.push(code);
  }
  return out;
}

/** The one "difficulty" goal (KEEP_PACE / CATCH_UP / ADVANCED); EXAM_PREP is a scope flag, not a difficulty. */
export function primaryGoal(goals: readonly LearningGoalCode[]): LearningGoalCode {
  return goals.find((g) => g !== 'EXAM_PREP') ?? DEFAULT_LEARNING_GOAL;
}

/** The comfortable/stretch mix for a goal set, driven only by the primary goal. */
export function stretchConfigForGoals(goals: readonly LearningGoalCode[]): StretchConfig {
  const [solvable, struggle] = LEARNING_GOAL_INFO[primaryGoal(goals)].mix;
  return { ...DEFAULT_STRETCH_CONFIG, solvableShare: solvable, struggleShare: struggle };
}
