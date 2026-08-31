import {
  type ChildId,
  type ChildLearningTwin,
  type DailyPlanResult,
  type LearningContext,
  type LearningMix,
  type PlannedAction,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapEngineResult } from '@copilot/gap-engine';
import { DEFAULT_PLANNING_CONFIG, type PlanningConfig } from './config.js';
import { computeLearningMix } from './learning-mix.js';
import { candidateActions } from './nbla.js';

export interface DailyPlanInput {
  readonly childId: ChildId;
  readonly planDate: string; // YYYY-MM-DD
  readonly availableMinutes: number;
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly context: LearningContext;
  readonly knowledgeBase: KnowledgeBase;
  readonly parentGoal?: string;
  readonly daysToExam?: number;
  readonly asOf?: Date;
  readonly config?: PlanningConfig;
}

/**
 * Build the day's plan (Math Core §27). Greedily fills the time budget with the
 * highest-ROI actions while respecting the Learning Mix proportions. Returns
 * `no_plan_needed` when nothing would add value today.
 */
export function buildDailyPlan(input: DailyPlanInput): DailyPlanResult {
  const asOf = input.asOf ?? new Date();
  const config = input.config ?? DEFAULT_PLANNING_CONFIG;
  const createdAt = asOf.toISOString();

  const { mix, situation } = computeLearningMix(
    { twin: input.twin, gaps: input.gaps, asOf, ...pick(input, 'parentGoal', 'daysToExam') },
    config,
  );

  const candidates = candidateActions(
    {
      twin: input.twin,
      gaps: input.gaps,
      context: input.context,
      knowledgeBase: input.knowledgeBase,
      ...pick(input, 'parentGoal', 'daysToExam'),
    },
    config,
  );

  // "No plan needed" (UI/UX Spec §17): no required work — nothing in the school or
  // gap-repair buckets worth doing, no fresh gap, no exam soon. An optional daily
  // thinking challenge does not, by itself, make a plan "needed".
  const meaningful = candidates.filter((a) => a.roiPerMinute >= 0.25 && a.kind !== 'no_extra_practice');
  const requiredWork = meaningful.filter(
    (a) => a.mixBucket === 'school' || a.mixBucket === 'gapRepair',
  );
  const hasActiveGap = input.gaps.gaps.some((g) => g.type !== 'careless_error' && g.score.band !== 'low');
  if (!hasActiveGap && situation !== 'exam_soon' && requiredWork.length === 0) {
    const challenge = meaningful.find((a) => a.kind === 'thinking_challenge');
    return {
      kind: 'no_plan_needed',
      childId: input.childId,
      planDate: input.planDate,
      reason: challenge
        ? 'Hôm nay con không cần thêm bài bắt buộc: phần đang học đã ổn, chưa có điểm cần củng cố, chưa tới kỳ kiểm tra. Có thể cho con làm 1 bài thử thách tư duy nếu con muốn.'
        : 'Hôm nay con không cần thêm bài: các phần đang học đã ổn, chưa có điểm cần củng cố và chưa tới kỳ kiểm tra.',
      createdAt,
    };
  }

  const orderedActions = fillBudget(meaningful.length > 0 ? meaningful : candidates, input.availableMinutes, mix);

  return {
    kind: 'plan',
    childId: input.childId,
    planDate: input.planDate,
    availableMinutes: input.availableMinutes,
    mix,
    situation,
    orderedActions,
    createdAt,
  };
}

/** Greedy knapsack-ish fill: keep each bucket near its mix share, pick highest ROI. */
function fillBudget(
  candidates: readonly PlannedAction[],
  budget: number,
  mix: LearningMix,
): PlannedAction[] {
  const targetMinutes: Record<PlannedAction['mixBucket'], number> = {
    school: (mix.school / 100) * budget,
    gapRepair: (mix.gapRepair / 100) * budget,
    advanced: (mix.advanced / 100) * budget,
    thinking: (mix.thinking / 100) * budget,
  };
  const spent: Record<PlannedAction['mixBucket'], number> = {
    school: 0,
    gapRepair: 0,
    advanced: 0,
    thinking: 0,
  };
  const chosen: PlannedAction[] = [];
  let totalSpent = 0;
  const pool = [...candidates];

  while (totalSpent < budget && pool.length > 0) {
    // prefer the bucket furthest below its target, then highest ROI within it
    let bestIdx = -1;
    let bestKey = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const a = pool[i]!;
      // hard rule (Math Core §27 / E2E invariant): the plan must NEVER exceed the
      // selected time budget — no slack.
      if (totalSpent + a.estimatedMinutes > budget) continue;
      const deficit = (targetMinutes[a.mixBucket] - spent[a.mixBucket]) / Math.max(1, targetMinutes[a.mixBucket]);
      const key = deficit * 2 + a.roiPerMinute;
      if (key > bestKey) {
        bestKey = key;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const [action] = pool.splice(bestIdx, 1);
    chosen.push(action!);
    spent[action!.mixBucket] += action!.estimatedMinutes;
    totalSpent += action!.estimatedMinutes;
  }

  // If nothing fit (every candidate is individually longer than the budget),
  // still schedule the single highest-value action, shortened to the budget —
  // a short dose beats an empty day, and the budget is never exceeded.
  if (chosen.length === 0 && candidates.length > 0) {
    const best = [...candidates].sort((a, b) => b.roiPerMinute - a.roiPerMinute)[0]!;
    chosen.push({ ...best, estimatedMinutes: Math.min(best.estimatedMinutes, budget) });
  }

  // Order the chosen actions: school first (do the lesson), then gap repair, advanced, thinking last.
  const order: Record<PlannedAction['mixBucket'], number> = { school: 0, gapRepair: 1, advanced: 2, thinking: 3 };
  return chosen.sort((a, b) => order[a.mixBucket] - order[b.mixBucket] || b.roiPerMinute - a.roiPerMinute);
}

function pick<T, K extends keyof T>(obj: T, ...keys: K[]): Partial<Pick<T, K>> {
  const out: Partial<Pick<T, K>> = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}
