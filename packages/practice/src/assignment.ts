import {
  type Assignment,
  type ChildId,
  type ChildLearningTwin,
  type DailyPlan,
  type PlannedAction,
  type Question,
} from '@copilot/domain';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { selectStretchSet } from './stretch-zone.js';

const MODE_BY_ACTION: Record<PlannedAction['kind'], Assignment['mode']> = {
  review_prerequisite: 'gap_repair',
  close_gap: 'gap_repair',
  practice_current_skill: 'practice',
  harder_problem_type: 'practice',
  thinking_challenge: 'challenge',
  advanced_extension: 'practice',
  exam_revision: 'revision',
  retention_check: 'revision',
  no_extra_practice: 'practice',
};

export interface BuildAssignmentInput {
  readonly childId: ChildId;
  readonly action: PlannedAction;
  readonly twin: ChildLearningTwin;
  readonly planDate: string;
  readonly at: string; // ISO
  readonly newId: () => string;
  readonly itemsPerSession?: number;
  readonly pool?: readonly Question[];
}

/**
 * LEGACY delivery path (Group C5 replaces this with AI generation).
 * Turns one planned action into an assignment, choosing stretch-zone items from
 * the reference library. Returns `null` when the library has nothing for the
 * target skill. Kept working only as migration compatibility.
 */
export function buildAssignment(input: BuildAssignmentInput): Assignment | null {
  const pool = (input.pool ?? loadReferenceLibrary()).filter(
    (q) => !input.action.targetSkillId || q.skillId === input.action.targetSkillId,
  );
  if (pool.length === 0) return null;

  // item count scales with the minutes this action was actually given — was a
  // flat 4 (1 for thinking) regardless of estimatedMinutes, so a 20-minute
  // session could land 1 assignment (4 items) or 3-4 assignments (12-16 items)
  // depending only on which/how-many NBLA actions the planner happened to pick,
  // with no relation to the requested time. Same pacing assumption the AI
  // worksheet spec uses (minutesPerItem, Math Core §17/§24), so a legacy and an
  // AI-generated session feel proportionate to each other too.
  const MINUTES_PER_ITEM = 2.5;
  const MIN_ITEMS_PER_ACTION = 2;
  const count =
    input.itemsPerSession ??
    (input.action.kind === 'thinking_challenge'
      ? 1 // one substantial reasoning problem by design (§35), not an item-count bug
      : Math.max(MIN_ITEMS_PER_ACTION, Math.round(input.action.estimatedMinutes / MINUTES_PER_ITEM)));
  const chosen =
    input.action.kind === 'thinking_challenge'
      ? pool
          .filter((q) => q.thinkingLevel === 'T4' || q.thinkingLevel === 'T5')
          .slice(0, 1)
          .concat(pool.slice(0, 1))
          .slice(0, 1)
      : selectStretchSet(input.twin, pool, Math.min(count, pool.length));

  const items = chosen.length > 0 ? chosen : pool.slice(0, 1);

  return {
    id: `asg_${input.newId()}`,
    childId: input.childId,
    dailyPlanDate: input.planDate,
    mode: MODE_BY_ACTION[input.action.kind],
    targetSkillIds: input.action.targetSkillId ? [input.action.targetSkillId] : [],
    questionIds: items.map((q) => q.id),
    createdAt: input.at,
  };
}

/** Build one assignment per action in a daily plan (skips actions with no items). */
export function buildAssignmentsForPlan(
  plan: DailyPlan,
  twin: ChildLearningTwin,
  at: string,
  newId: () => string,
): Assignment[] {
  return plan.orderedActions
    .map((action) =>
      buildAssignment({ childId: plan.childId, action, twin, planDate: plan.planDate, at, newId }),
    )
    .filter((a): a is Assignment => a !== null);
}
