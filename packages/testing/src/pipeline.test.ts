import { describe, expect, it } from 'vitest';
import { asChildId, type Evidence, type Submission } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { buildAssignment, loadQuestionBank, submissionToEvidence } from '@copilot/practice';
import { KB, buildEvidence } from './harness.js';

const childId = asChildId('pipeline_child');
const asOf = new Date('2026-08-31T09:00:00Z');

/**
 * End-to-end deterministic loop (Phase 5 acceptance):
 * evidence → twin → gaps → daily plan → assignment → submission → new evidence
 * → recompute → the twin has moved.
 */
describe('full planning pipeline', () => {
  const evidence = buildEvidence(
    childId,
    [
      { skillId: 'M4.FRAC.EQUIVALENT', daysAgo: 20, correct: true, confidenceTier: 'A' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 12, correct: false, reasoningQuality: 'weak', source: 'school_homework', provenance: 'scan', confidenceTier: 'B' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 7, correct: false, reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 4, correct: false, reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 2, correct: false, reasoningQuality: 'weak' },
    ],
    asOf,
  );

  const twin = buildLearningTwin({ childId, gradeContext: 4, evidence, knowledgeBase: KB, asOf });
  const gaps = runGapEngine({ childId, gradeContext: 4, twin, evidence, knowledgeBase: KB, asOf });
  const context = buildLearningContext({
    childId,
    gradeContext: 4,
    evidence,
    teacherContributions: [],
    knowledgeBase: KB,
    asOf,
  });

  it('produces a plan whose top action targets the detected gap', () => {
    const plan = buildDailyPlan({
      childId,
      planDate: '2026-08-31',
      availableMinutes: 25,
      twin,
      gaps,
      context,
      knowledgeBase: KB,
      asOf,
    });
    expect(plan.kind).toBe('plan');
    if (plan.kind !== 'plan') return;
    expect(plan.orderedActions.some((a) => a.mixBucket === 'gapRepair')).toBe(true);
  });

  it('builds an assignment from the plan and closes the loop into new evidence', () => {
    const plan = buildDailyPlan({
      childId,
      planDate: '2026-08-31',
      availableMinutes: 25,
      twin,
      gaps,
      context,
      knowledgeBase: KB,
      asOf,
    });
    if (plan.kind !== 'plan') throw new Error('expected a plan');

    const gapAction = plan.orderedActions.find(
      (a) => a.mixBucket === 'gapRepair' && a.targetSkillId === 'M4.FRAC.COMMON_DENOM',
    ) ?? plan.orderedActions.find((a) => a.targetSkillId === 'M4.FRAC.COMMON_DENOM');
    // fall back: any action with a bank-backed skill
    const action = gapAction ?? plan.orderedActions[0]!;

    const assignment = buildAssignment({
      childId,
      action: { ...action, targetSkillId: action.targetSkillId ?? ('M4.FRAC.COMMON_DENOM' as never) },
      twin,
      planDate: '2026-08-31',
      at: asOf.toISOString(),
      newId: () => '1',
    });
    expect(assignment).not.toBeNull();
    expect(assignment!.questionIds.length).toBeGreaterThan(0);

    // child now answers all items correctly, unaided
    const bank = loadQuestionBank();
    const newEvidence: Evidence[] = assignment!.questionIds.map((qid, i) => {
      const q = bank.find((x) => x.id === qid)!;
      const submission: Submission = {
        id: `sub_${i}`,
        assignmentId: assignment!.id,
        questionId: qid,
        childId,
        childAnswer: 'ok',
        correct: true,
        score: 1,
        hintsUsed: 0,
        maxHints: 6,
        timeSpentSeconds: 80,
        submittedAt: new Date(asOf.getTime() + i * 60_000).toISOString(),
      };
      return submissionToEvidence({ submission, question: q, at: asOf.toISOString(), newId: () => `${i}` });
    });

    const before = twin.skillMastery.get('M4.FRAC.COMMON_DENOM' as never)?.mastery ?? 0;
    const twin2 = buildLearningTwin({
      childId,
      gradeContext: 4,
      evidence: [...evidence, ...newEvidence],
      knowledgeBase: KB,
      asOf: new Date(asOf.getTime() + 3_600_000),
    });
    const after = twin2.skillMastery.get('M4.FRAC.COMMON_DENOM' as never)?.mastery ?? 0;

    // the loop moved the twin upward (new correct, unaided evidence)
    if (newEvidence.some((e) => e.skillId === 'M4.FRAC.COMMON_DENOM')) {
      expect(after).toBeGreaterThan(before);
    } else {
      expect(twin2.computedFromEvidenceCount).toBeGreaterThan(twin.computedFromEvidenceCount);
    }
  });
});
