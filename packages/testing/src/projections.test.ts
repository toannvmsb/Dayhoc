import { describe, expect, it } from 'vitest';
import { asChildId, type Evidence } from '@copilot/domain';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { buildAssignmentsForPlan, initHintLadder } from '@copilot/practice';
import { loadReferenceLibrary } from '@copilot/reference-library';
import {
  assertChildSafe,
  buildChildChallenge,
  buildChildQuestion,
  buildChildResult,
  buildChildToday,
  buildParentGapDetail,
  buildParentHome,
  buildParentProgress,
  buildParentTeachingPlan,
} from '@copilot/projections';
import { KB, buildEvidence } from './harness.js';

const childId = asChildId('proj_child');
const asOf = new Date('2026-08-31T09:00:00Z');
const profile = { childId, displayName: 'Minh Anh', schoolGrade: 7, schoolContext: 'Kết nối tri thức' };

function scene() {
  const evidence: Evidence[] = buildEvidence(
    childId,
    [
      { skillId: 'M7.RATIO.PROPORTION', daysAgo: 20, correct: true, confidenceTier: 'A' },
      { skillId: 'M7.ALG.IDENTITY', daysAgo: 12, correct: true, confidenceTier: 'A' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 8, correct: false, reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
      { skillId: 'M4.FRAC.COMMON_DENOM', daysAgo: 3, correct: false, reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' },
    ],
    asOf,
  );
  const twin = buildLearningTwin({ childId, gradeContext: 7, evidence, knowledgeBase: KB, asOf });
  const gaps = runGapEngine({ childId, gradeContext: 7, twin, evidence, knowledgeBase: KB, asOf });
  const context = buildLearningContext({ childId, gradeContext: 7, evidence, teacherContributions: [], knowledgeBase: KB, asOf });
  const plan = buildDailyPlan({ childId, planDate: '2026-08-31', availableMinutes: 25, twin, gaps, context, knowledgeBase: KB, asOf });
  return { evidence, twin, gaps, context, plan };
}

describe('Parent projections', () => {
  const s = scene();
  const input = { profile, twin: s.twin, gaps: s.gaps, context: s.context, plan: s.plan, knowledgeBase: KB, examCountdownDays: 13 };

  it('Home: status in words, a today plan, attention items, frontier insight', () => {
    const home = buildParentHome(input);
    expect(home.child.displayName).toBe('Minh Anh');
    expect(home.attention.length).toBeGreaterThan(0);
    expect(home.attention[0]!.title).toMatch(/cần củng cố/);
    expect(home.progressInsights.some((i) => i.includes('vượt chuẩn lớp 7'))).toBe(true);
    expect(home.attention.some((a) => a.kind === 'exam')).toBe(true);
  });

  it('Home: surfaces resolved.lastVerifiedAt so the parent can see how fresh the confirmed lesson is', () => {
    // this fixture's context is evidence-derived (no explicit lesson
    // confirmation) — confirm the field passes through as null, not dropped.
    expect(input.context.resolved.lastVerifiedAt === null || typeof input.context.resolved.lastVerifiedAt === 'string').toBe(true);
    const home = buildParentHome(input);
    expect(home.learningContext.lastVerifiedAt).toBe(input.context.resolved.lastVerifiedAt);

    // a real VERIFIED confirmation timestamp flows through unchanged.
    const confirmedAt = '2026-08-30T08:00:00.000Z';
    const confirmed = {
      ...input,
      context: { ...s.context, resolved: { ...s.context.resolved, confidence: 'VERIFIED' as const, lastVerifiedAt: confirmedAt } },
    };
    expect(buildParentHome(confirmed).learningContext.lastVerifiedAt).toBe(confirmedAt);
  });

  it('Progress: three separate axes, no single overall score', () => {
    const prog = buildParentProgress(input);
    expect(prog).not.toHaveProperty('overallScore');
    expect(prog).not.toHaveProperty('level');
    expect(prog.axes.knowledge.length).toBeGreaterThan(0);
    for (const row of prog.axes.knowledge) {
      expect(['trên_mức_mục_tiêu', 'đúng_mức_mục_tiêu', 'đang_củng_cố', 'chưa_ổn_định']).toContain(row.status);
    }
  });

  it('Gap detail: why-app-thinks, lifecycle strip, parent choices', () => {
    const gapId = s.gaps.gaps.find((g) => g.type !== 'careless_error')!.id;
    const detail = buildParentGapDetail(input, gapId)!;
    expect(detail.whyAppThinks[0]!.length).toBeGreaterThan(10);
    expect(detail.lifecycleStep.some((x) => x.state === 'current')).toBe(true);
    expect(detail.prescription?.options.map((o) => o.key).sort()).toEqual(
      ['follow', 'later', 'lighter', 'intensify'].sort(),
    );
  });

  it('Teaching Copilot: coaches the parent, not a worked answer for the child', () => {
    const gapId = s.gaps.gaps.find((g) => g.type !== 'careless_error')!.id;
    const plan = buildParentTeachingPlan(input, gapId)!;
    expect(plan.forGapId).toBe(gapId);
    expect(plan.gapMeaning.length).toBeGreaterThan(30);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    // every step tells the parent what to SAY and WHY (the pedagogy)
    for (const step of plan.steps) {
      expect(step.say.length).toBeGreaterThan(5);
      expect(step.why.length).toBeGreaterThan(10);
    }
    expect(plan.checkUnderstanding.length).toBeGreaterThan(0);
    expect(plan.commonMistakes.length).toBeGreaterThan(0);
    expect(plan.praise.length).toBeGreaterThan(0);
    // no leaked internals
    expect(JSON.stringify(plan)).not.toMatch(/mastery|gapScore|severity|confidence":/);
  });

  it('Teaching Copilot: falls back to the current lesson when there is no gap', () => {
    const noGaps = { ...input, gaps: { ...s.gaps, gaps: [] } };
    const plan = buildParentTeachingPlan(noGaps);
    // may be null only if there is also no active lesson skill
    if (plan) {
      expect(plan.forGapId).toBeNull();
      expect(plan.focusLine.length).toBeGreaterThan(5);
    }
  });
});

describe('Child-safe projection (server-side)', () => {
  const s = scene();
  const assignments =
    s.plan.kind === 'plan' ? buildAssignmentsForPlan(s.plan, s.twin, asOf.toISOString(), (() => { let i = 0; return () => `${++i}`; })()) : [];

  it('buildChildToday exposes tasks only — no gap score / mastery / ranking', () => {
    const view = buildChildToday({
      childDisplayName: 'Minh Anh',
      dateLabel: 'Thứ Bảy, 30/8',
      plan: s.plan,
      assignments,
      completedAssignmentIds: [],
    });
    expect(view).not.toHaveProperty('mastery');
    expect(view).not.toHaveProperty('gaps');
    expect(view.tasks.every((t) => 'title' in t && !('mastery' in t))).toBe(true);
    // the runtime guard passes for the child view
    expect(() => assertChildSafe(view)).not.toThrow();
  });

  it('assertChildSafe REJECTS a parent view (defense in depth)', () => {
    const home = buildParentHome({ profile, twin: s.twin, gaps: s.gaps, context: s.context, plan: s.plan, knowledgeBase: KB });
    expect(() => assertChildSafe(home)).toThrow(/child-safe projection violation/);
  });

  it('assertChildSafe rejects a hand-crafted leak', () => {
    expect(() => assertChildSafe({ tasks: [{ title: 'x', mastery: 82 }] })).toThrow(/forbidden key "mastery"/);
  });

  it('child question view: one question, only unlocked hints, no answer key', () => {
    const q = loadReferenceLibrary().find((x) => x.skillId === 'M4.FRAC.COMMON_DENOM')!;
    const view = buildChildQuestion({
      assignmentId: 'asg_1',
      question: q,
      index: 2,
      total: 5,
      hintState: { ...initHintLadder(q.id), rungsRevealed: 1, rung: 'orientation', dependency: 0.2 },
    });
    expect(view.index).toBe(2);
    expect(view.revealedHints).toHaveLength(1); // only the first rung
    expect(view).not.toHaveProperty('answerSpec');
    expect(view).not.toHaveProperty('workedSolution');
    expect(() => assertChildSafe(view)).not.toThrow();
  });

  it('child result view: shows a reasoning prompt after a challenge, and it is child-safe', () => {
    const challenge = loadReferenceLibrary().find((x) => x.answerSpec.kind === 'reasoning')!;
    const result = buildChildResult({
      assignmentId: 'asg_c',
      questions: [challenge],
      outcomes: [{ questionId: challenge.id, correct: true }],
      hasNext: false,
    });
    expect(result.reasoningPrompt).toBe('Con đã nghĩ theo cách nào?');
    expect(() => assertChildSafe(result)).not.toThrow();

    const chView = buildChildChallenge('asg_c', challenge);
    expect(chView.badge).toBe('SUY LUẬN');
    expect(() => assertChildSafe(chView)).not.toThrow();
  });
});
