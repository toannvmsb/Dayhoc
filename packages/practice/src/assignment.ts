import {
  type Assignment,
  type ChildId,
  type ChildLearningTwin,
  type DailyPlan,
  type PlannedAction,
  type Question,
} from '@copilot/domain';
import { loadQuestionBank } from './question-bank.js';
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
 * Turn one planned action into a concrete assignment, choosing stretch-zone
 * items from the authored bank (Math Core §16–§17). Returns `null` when the bank
 * has nothing for the target skill yet (Pending D-03).
 */
export function buildAssignment(input: BuildAssignmentInput): Assignment | null {
  const pool = (input.pool ?? loadQuestionBank()).filter(
    (q) => !input.action.targetSkillId || q.skillId === input.action.targetSkillId,
  );
  if (pool.length === 0) return null;

  const count = input.itemsPerSession ?? (input.action.kind === 'thinking_challenge' ? 1 : 4);
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
