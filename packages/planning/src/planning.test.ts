import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { computeLearningMix, detectSituation } from './learning-mix.js';
import { candidateActions } from './nbla.js';
import { buildDailyPlan } from './daily-plan.js';
import { DEFAULT_PLANNING_CONFIG } from './config.js';

const kb = loadKnowledgeBase();
const childId = asChildId('child_1');
const asOf = new Date('2026-08-31T09:00:00Z');
let n = 0;

function ev(skillId: string, daysAgo: number, correct: boolean, extra: Partial<Evidence> = {}): Evidence {
  const occurredAt = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${++n}` as Evidence['id'],
    childId,
    source: 'app_practice',
    occurredAt,
    recordedAt: occurredAt,
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...extra,
  };
}

function pipeline(evidence: Evidence[], gradeContext: 4 | 7 = 4, parentGoal?: string) {
  const twin = buildLearningTwin({ childId, gradeContext, evidence, knowledgeBase: kb, asOf });
  const gaps = runGapEngine({
    childId,
    gradeContext,
    twin,
    evidence,
    knowledgeBase: kb,
    ...(parentGoal ? { parentGoal } : {}),
    asOf,
  });
  const context = buildLearningContext({
    childId,
    gradeContext,
    evidence,
    teacherContributions: [],
    knowledgeBase: kb,
    asOf,
  });
  return { twin, gaps, context };
}

describe('Learning Mix (Math Core §24)', () => {
  it('switches to a gap-repair-heavy mix right after a fresh gap', () => {
    const { twin, gaps } = pipeline([
      ev('M4.FRAC.EQUIVALENT', 25, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', 6, false, { reasoningQuality: 'weak' }),
      ev('M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak' }),
    ]);
    const { mix, situation } = computeLearningMix({ twin, gaps, asOf }, DEFAULT_PLANNING_CONFIG);
    expect(situation).toBe('after_gap_detected');
    expect(mix.gapRepair).toBeGreaterThan(mix.advanced);
    expect(mix.school + mix.gapRepair + mix.advanced + mix.thinking).toBe(100);
  });

  it('uses the strong-student mix when mastery is high and no serious gaps', () => {
    const { twin, gaps } = pipeline([
      ev('M4.FRAC.EQUIVALENT', 22, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.EQUIVALENT', 12, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', 8, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', 3, true, { confidenceTier: 'A' }),
    ]);
    expect(detectSituation({ twin, gaps, asOf }, DEFAULT_PLANNING_CONFIG)).toBe('strong_student');
  });

  it('goes to exam_soon when an exam is within the window', () => {
    const { twin, gaps } = pipeline([ev('M4.FRAC.COMMON_DENOM', 5, true)]);
    expect(detectSituation({ twin, gaps, asOf, daysToExam: 9 }, DEFAULT_PLANNING_CONFIG)).toBe('exam_soon');
  });

  it('a thinking goal nudges the thinking share up', () => {
    const { twin, gaps } = pipeline([ev('M4.FRAC.COMMON_DENOM', 5, true)]);
    const base = computeLearningMix({ twin, gaps, asOf }, DEFAULT_PLANNING_CONFIG).mix;
    const nudged = computeLearningMix(
      { twin, gaps, asOf, parentGoal: 'phat_trien_tu_duy' },
      DEFAULT_PLANNING_CONFIG,
    ).mix;
    expect(nudged.thinking).toBeGreaterThan(base.thinking);
  });
});

describe('Next Best Learning Action', () => {
  it('ranks a blocking gap-repair action above a routine practice action', () => {
    const { twin, gaps, context } = pipeline([
      ev('M4.FRAC.EQUIVALENT', 20, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', 7, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', 3, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    ]);
    const actions = candidateActions({ twin, gaps, context, knowledgeBase: kb }, DEFAULT_PLANNING_CONFIG);
    expect(actions[0]!.mixBucket).toBe('gapRepair');
    expect(actions.some((a) => a.kind === 'thinking_challenge')).toBe(true);
  });
});

describe('Daily plan (Math Core §27)', () => {
  it('respects the time budget and orders school work first', () => {
    const { twin, gaps, context } = pipeline([
      ev('M4.FRAC.EQUIVALENT', 20, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.COMMON_DENOM', 6, false, { reasoningQuality: 'weak' }),
      ev('M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak' }),
    ]);
    const plan = buildDailyPlan({
      childId,
      planDate: '2026-08-31',
      availableMinutes: 25,
      twin,
      gaps,
      context,
      knowledgeBase: kb,
      asOf,
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    const total = plan.orderedActions.reduce((s, a) => s + a.estimatedMinutes, 0);
    expect(total).toBeLessThanOrEqual(25); // never exceeds the selected budget
    const buckets = plan.orderedActions.map((a) => a.mixBucket);
    if (buckets.includes('school') && buckets.includes('thinking')) {
      expect(buckets.indexOf('school')).toBeLessThan(buckets.lastIndexOf('thinking'));
    }
  });

  it('returns "no plan needed" when everything is healthy', () => {
    const { twin, gaps, context } = pipeline([
      ev('M4.FRAC.EQUIVALENT', 20, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.EQUIVALENT', 10, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.SIMPLIFY', 14, true, { confidenceTier: 'A' }),
      ev('M4.FRAC.SIMPLIFY', 5, true, { confidenceTier: 'A' }),
    ]);
    // no active skills in context (all evidence is old-ish but healthy), no gaps
    const plan = buildDailyPlan({
      childId,
      planDate: '2026-08-31',
      availableMinutes: 20,
      twin,
      gaps,
      context: { ...context, activeSkillIds: [] },
      knowledgeBase: kb,
      asOf,
    });
    expect(plan.kind).toBe('no_plan_needed');
  });

  it('is deterministic', () => {
    const { twin, gaps, context } = pipeline([
      ev('M4.FRAC.COMMON_DENOM', 6, false, { reasoningQuality: 'weak' }),
      ev('M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak' }),
    ]);
    const make = () =>
      buildDailyPlan({ childId, planDate: '2026-08-31', availableMinutes: 30, twin, gaps, context, knowledgeBase: kb, asOf });
    expect(make()).toEqual(make());
  });
});
