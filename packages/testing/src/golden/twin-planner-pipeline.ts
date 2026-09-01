import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  type ChildId,
  type ConfidenceTier,
  type Evidence,
  type EvidenceSource,
  type Provenance,
} from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine, type GapEngineResult } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan, computeLearningMix, DEFAULT_PLANNING_CONFIG } from '@copilot/planning';
import { KB } from '../harness.js';
import type { LearningEvidenceEvent, TwinPlannerProfile } from './load.js';

/** The dataset anchors "now" here; week N maps back from this instant. */
export const TP_AS_OF = new Date('2026-08-31T09:00:00Z');

const CONFIDENCE_TIER: Record<LearningEvidenceEvent['confidence'], ConfidenceTier> = {
  verified: 'A',
  strong: 'B',
  supporting: 'C',
  estimated: 'D',
};

const KNOWN_SOURCES = new Set<string>([
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
]);

/**
 * Map one dataset evidence event onto the append-only `Evidence` shape the
 * deterministic engine consumes. Deliberately conservative: we do not invent
 * reasoning-quality or hint signals the dataset does not carry.
 */
export function eventToEvidence(
  childId: ChildId,
  ev: LearningEvidenceEvent,
  historyWeeks: number,
  index: number,
): Evidence {
  // week 1 is the oldest; the most recent week sits ~3 days before "now".
  const weeksBack = Math.max(0, historyWeeks - ev.week);
  const daysBack = weeksBack * 7 + 3;
  const occurredMs = TP_AS_OF.getTime() - daysBack * 86_400_000 - index * 60_000;
  const occurredAt = new Date(occurredMs).toISOString();

  const parentObs = ev.type === 'parent_observation';
  const source: EvidenceSource = parentObs
    ? 'parent_feedback'
    : ev.verified
      ? 'school_test'
      : KNOWN_SOURCES.has(ev.source)
        ? (ev.source as EvidenceSource)
        : 'app_practice';
  const provenance: Provenance = parentObs
    ? 'parent'
    : ev.verified
      ? 'assessment'
      : 'manual';

  const hintDependency = ev.hint_level > 0 ? Math.min(1, ev.hint_level / 3) : 0;
  const reasoningQuality: Evidence['reasoningQuality'] | undefined =
    !ev.correct && !!ev.error_signature && /reasoning|thinking|structure_missed|jump/.test(ev.error_signature)
      ? 'weak'
      : undefined;

  return {
    id: ev.event_id as Evidence['id'],
    childId,
    source,
    occurredAt,
    recordedAt: occurredAt,
    skillId: asSkillId(ev.skill_id),
    ...(ev.problem_type ? { problemTypeId: asProblemTypeId(ev.problem_type) } : {}),
    result: { correct: ev.correct },
    ...(reasoningQuality ? { reasoningQuality } : {}),
    hintDependency,
    ...(ev.response_time_sec !== null && ev.response_time_sec !== undefined
      ? { timeSpentSeconds: ev.response_time_sec }
      : {}),
    confidenceTier: ev.verified ? 'A' : CONFIDENCE_TIER[ev.confidence],
    provenance,
  };
}

export function profileToEvidence(
  profile: TwinPlannerProfile,
  events: readonly LearningEvidenceEvent[],
): { childId: ChildId; evidence: Evidence[] } {
  const childId = asChildId(`tp_${profile.profile_id}`);
  const mine = events
    .filter((e) => e.profile_id === profile.profile_id)
    .slice()
    .sort((a, b) => a.week - b.week || a.event_id.localeCompare(b.event_id));
  const evidence = mine.map((e, i) => eventToEvidence(childId, e, profile.history_weeks, i));
  return { childId, evidence };
}

export interface TwinPlannerRun {
  readonly profile: TwinPlannerProfile;
  readonly childId: ChildId;
  readonly evidence: Evidence[];
  readonly twin: ReturnType<typeof buildLearningTwin>;
  readonly gaps: GapEngineResult;
  readonly context: ReturnType<typeof buildLearningContext>;
  readonly parentGoal: string;
  readonly mix: ReturnType<typeof computeLearningMix>;
  readonly plan: ReturnType<typeof buildDailyPlan>;
  readonly planExam: ReturnType<typeof buildDailyPlan>;
}

/** Run the full deterministic pipeline for one dataset profile. */
export function runTwinPlanner(
  profile: TwinPlannerProfile,
  events: readonly LearningEvidenceEvent[],
): TwinPlannerRun {
  const { childId, evidence } = profileToEvidence(profile, events);
  const gradeContext = profile.grade_context;
  // dataset goal slug → engine/planner goal slug (Math Core §24 goal nudge keys)
  const parentGoal = profile.parent_goal === 'advanced_and_thinking' ? 'phat_trien_tu_duy' : 'theo_sat_chuong_trinh';

  const twin = buildLearningTwin({ childId, gradeContext, evidence, knowledgeBase: KB, asOf: TP_AS_OF });
  const gaps = runGapEngine({
    childId,
    gradeContext,
    twin,
    evidence,
    knowledgeBase: KB,
    parentGoal,
    asOf: TP_AS_OF,
  });
  const context = buildLearningContext({
    childId,
    gradeContext,
    evidence,
    teacherContributions: [],
    knowledgeBase: KB,
    asOf: TP_AS_OF,
  });
  const mix = computeLearningMix({ twin, gaps, parentGoal, asOf: TP_AS_OF }, DEFAULT_PLANNING_CONFIG);

  const base = {
    childId,
    planDate: '2026-08-31',
    availableMinutes: profile.daily_time_budget_min,
    twin,
    gaps,
    context,
    knowledgeBase: KB,
    parentGoal,
    asOf: TP_AS_OF,
  } as const;
  const plan = buildDailyPlan(base);
  const planExam = buildDailyPlan({ ...base, daysToExam: 2 });

  return { profile, childId, evidence, twin, gaps, context, parentGoal, mix, plan, planExam };
}

/** Total minutes a plan schedules (0 when no plan is needed). */
export function planMinutes(plan: ReturnType<typeof buildDailyPlan>): number {
  return plan.kind === 'plan'
    ? plan.orderedActions.reduce((sum, a) => sum + a.estimatedMinutes, 0)
    : 0;
}
