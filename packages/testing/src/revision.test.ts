import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Exam } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import {
  buildRevisionPlan,
  buildWeeklyReport,
  diagnoseAssessment,
  inferExamScope,
  notificationsForRun,
} from '@copilot/revision';
import { KB, buildEvidence } from './harness.js';

const childId = asChildId('rev_child');
const asOf = new Date('2026-08-31T09:00:00Z');

function scene(specs: Parameters<typeof buildEvidence>[1]) {
  const evidence = buildEvidence(childId, specs, asOf);
  const twin = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
  const gaps = runGapEngine({ childId, gradeContext: 7, twin, evidence, knowledgeBase: KB, asOf });
  const context = buildLearningContext({
    childId,
    gradeContext: 7,
    evidence,
    teacherContributions: [
      {
        id: 'tc_1',
        childId,
        contributedAs: 'teacher',
        actorUserId: 't',
        occurredOn: '2026-08-25',
        recordedAt: '2026-08-25T00:00:00Z',
        taughtSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN')],
        problemTypeIds: [],
        homeworkRefs: [],
      },
    ],
    knowledgeBase: KB,
    asOf,
  });
  return { evidence, twin, gaps, context };
}

describe('Exam flow works with only a date + recent context', () => {
  const { twin, context } = scene([
    { skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 6, correct: true },
    { skillId: 'M7.RATIO.PROPORTION', daysAgo: 12, correct: true },
    { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 4, correct: false, reasoningQuality: 'weak' },
  ]);

  it('infers a scope from context and asks the parent to confirm', () => {
    const scope = inferExamScope(context, twin, KB);
    expect(scope.skillIds.length).toBeGreaterThan(0);
    expect(scope.skillIds).toContain(asSkillId('M7.RATIO.EQUAL_CHAIN'));
    expect(scope.confidence).toBeGreaterThan(0);
    expect(scope.confidence).toBeLessThanOrEqual(1);
    expect(typeof scope.needsParentConfirm).toBe('boolean');
  });

  it('builds a revision plan from an inferred-scope exam', () => {
    const scope = inferExamScope(context, twin, KB);
    const exam: Exam = {
      id: 'exam_1',
      childId,
      examDate: '2026-09-12',
      subject: 'Toán',
      inferredScope: scope,
    };
    const { gaps } = scene([{ skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 4, correct: false, reasoningQuality: 'weak' }]);
    const plan = buildRevisionPlan({ childId, exam, twin, gaps, knowledgeBase: KB, asOf });
    expect(plan.dayCountdown).toBe(12);
    expect(plan.priorityItems.length).toBeGreaterThan(0);
    for (let i = 1; i < plan.priorityItems.length; i++) {
      expect(plan.priorityItems[i - 1]!.priority).toBeGreaterThanOrEqual(plan.priorityItems[i]!.priority);
    }
  });
});

describe('Revision priority golden (Math Core §28)', () => {
  it('a forgotten, gated scope skill outranks a solid one', () => {
    const { twin, gaps } = scene([
      // solid + recent
      { skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 3, correct: true, confidenceTier: 'A' },
      { skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 8, correct: true, confidenceTier: 'A' },
      // forgotten prerequisite-heavy skill: verified long ago, now weak
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 120, correct: true, confidenceTier: 'A' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false, reasoningQuality: 'weak' },
    ]);
    const exam: Exam = {
      id: 'exam_2',
      childId,
      examDate: '2026-09-10',
      subject: 'Toán',
      scopeSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN'), asSkillId('M4.FRAC.COMMON_DENOM')],
    };
    const plan = buildRevisionPlan({ childId, exam, twin, gaps, knowledgeBase: KB, asOf });
    expect(plan.priorityItems[0]!.skillId).toBe('M4.FRAC.COMMON_DENOM');
    expect(plan.priorityItems[0]!.band).toBe('ưu_tiên_cao');
  });
});

describe('Post-exam diagnosis classifies lost points', () => {
  it('does not treat every dropped mark as the same weakness', () => {
    const { twin } = scene([
      { skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 5, correct: true, confidenceTier: 'A' },
      { skillId: 'M7.RATIO.EQUAL_CHAIN', daysAgo: 10, correct: true, confidenceTier: 'A' },
      { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 6, correct: false },
      { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 2, correct: false },
    ]);
    const diag = diagnoseAssessment({
      childId,
      examId: 'exam_3',
      twin,
      knowledgeBase: KB,
      outcomes: [
        { questionRef: 'C1', skillId: asSkillId('M7.RATIO.EQUAL_CHAIN'), awardedScore: 0.6, reasoningQuality: 'strong' },
        { questionRef: 'C2', skillId: asSkillId('M4.FRAC.COMMON_DENOM'), awardedScore: 0 },
        { questionRef: 'C3', skillId: asSkillId('M4.FRAC.SIMPLIFY'), awardedScore: 0.4, stepsObserved: ['a', 'b'] },
        { questionRef: 'C4', skillId: asSkillId('M7.RATIO.EQUAL_CHAIN'), awardedScore: 1 },
      ],
    });
    const kinds = new Set(diag.lostPoints.map((l) => l.classification));
    expect(kinds.has('careless_error')).toBe(true); // C1
    expect(kinds.has('procedural_gap')).toBe(true); // C3
    expect(diag.lostPoints.find((l) => l.questionRef === 'C2')!.classification).toBe('prerequisite_gap'); // weak equivalent
    expect(diag.remediationSkillIds.length).toBeGreaterThan(0);
    expect(diag.totalAwarded).toBeCloseTo(0.5, 1);
  });
});

describe('Weekly report proposes next week\'s mix', () => {
  it('shifts toward gap repair while a gap is open', () => {
    const before = buildLearningTwin({ childId, gradeContext: 7, evidence: [], knowledgeBase: KB, asOf });
    const { twin, gaps, evidence } = scene([
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 5, correct: false, reasoningQuality: 'weak' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 2, correct: false, reasoningQuality: 'weak' },
    ]);
    const report = buildWeeklyReport({
      childId,
      weekOf: '2026-08-24',
      weekEvidence: evidence,
      twinBefore: before,
      twinAfter: twin,
      gapsAfter: gaps,
      knowledgeBase: KB,
    });
    expect(report.nextWeekMix.gapRepair).toBeGreaterThan(20);
    expect(report.nextWeekMix.school + report.nextWeekMix.gapRepair + report.nextWeekMix.advanced + report.nextWeekMix.thinking).toBe(100);
    expect(report.needsFollowUp[0]).toMatch(/Quy đồng/);
  });
});

describe('notifications', () => {
  it('fires an exam notification inside the 14-day window', () => {
    const { gaps } = scene([{ skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: true }]);
    const ns = notificationsForRun(gaps, 10, { targetUserId: 'u1', at: asOf.toISOString(), newId: () => 'x' });
    expect(ns.some((n) => n.type === 'exam_upcoming')).toBe(true);
  });
});
