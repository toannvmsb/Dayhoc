import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { buildAssignmentsForPlan, initHintLadder, loadQuestionBank } from '@copilot/practice';
import {
  assertChildSafe,
  buildChildChallenge,
  buildChildQuestion,
  buildChildResult,
  buildChildToday,
} from '@copilot/projections';

const CHILD = asChildId('demo_minh_anh');
const AS_OF = new Date('2026-08-31T09:00:00Z');

function scene() {
  const kb = loadKnowledgeBase();
  const at = (d: number) => new Date(AS_OF.getTime() - d * 86_400_000).toISOString();
  const mk = (i: number, s: string, d: number, c: boolean, x: Partial<Evidence> = {}): Evidence => ({
    id: `ev_${i}` as Evidence['id'],
    childId: CHILD,
    source: 'app_practice',
    occurredAt: at(d),
    recordedAt: at(d),
    skillId: asSkillId(s),
    result: { correct: c },
    confidenceTier: 'B',
    provenance: 'manual',
    ...x,
  });
  const evidence = [
    mk(1, 'M4.FRAC.EQUIVALENT', 24, true, { confidenceTier: 'A' }),
    mk(2, 'M4.FRAC.COMMON_DENOM', 8, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    mk(3, 'M4.FRAC.COMMON_DENOM', 3, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    mk(4, 'M7.RATIO.EQUAL_CHAIN', 5, true),
  ];
  const twin = buildLearningTwin({ childId: CHILD, gradeContext: 7, evidence, knowledgeBase: kb, asOf: AS_OF });
  const gaps = runGapEngine({ childId: CHILD, gradeContext: 7, twin, evidence, knowledgeBase: kb, asOf: AS_OF });
  const context = buildLearningContext({ childId: CHILD, gradeContext: 7, evidence, teacherContributions: [], knowledgeBase: kb, asOf: AS_OF });
  const plan = buildDailyPlan({ childId: CHILD, planDate: '2026-08-31', availableMinutes: 25, twin, gaps, context, knowledgeBase: kb, asOf: AS_OF });
  const assignments =
    plan.kind === 'plan'
      ? buildAssignmentsForPlan(plan, twin, AS_OF.toISOString(), (() => { let i = 0; return () => `${++i}`; })())
      : [];
  return { kb, twin, plan, assignments };
}

export function childTodayView() {
  const { plan, assignments } = scene();
  const view = buildChildToday({
    childDisplayName: 'Minh Anh',
    dateLabel: 'Thứ Bảy, 30/8',
    plan,
    assignments,
    completedAssignmentIds: [],
  });
  assertChildSafe(view);
  return view;
}

export function childFirstQuestionView() {
  const { kb, assignments } = scene();
  const bank = loadQuestionBank();
  const asg = assignments.find((a) => a.questionIds.length > 0 && bank.some((q) => q.id === a.questionIds[0]));
  if (!asg) return null;
  const q = bank.find((x) => x.id === asg.questionIds[0])!;
  const view = buildChildQuestion({
    assignmentId: asg.id,
    question: q,
    index: 1,
    total: asg.questionIds.length,
    hintState: { ...initHintLadder(q.id), rungsRevealed: 1, rung: 'orientation', dependency: 0.2 },
  });
  void kb;
  assertChildSafe(view);
  return view;
}

export function childChallengeView() {
  const bank = loadQuestionBank();
  const q = bank.find((x) => x.answerSpec.kind === 'reasoning')!;
  const view = buildChildChallenge('asg_challenge', q);
  assertChildSafe(view);
  return view;
}

export function childResultView() {
  const bank = loadQuestionBank();
  const qs = bank.filter((x) => x.skillId === 'M4.FRAC.COMMON_DENOM').slice(0, 3);
  const view = buildChildResult({
    assignmentId: 'asg_1',
    questions: qs,
    outcomes: qs.map((q, i) => ({ questionId: q.id, correct: i !== 1 })),
    hasNext: true,
  });
  assertChildSafe(view);
  return view;
}
