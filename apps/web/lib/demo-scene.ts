import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildDailyPlan } from '@copilot/planning';
import { buildParentHome, buildParentProgress, type ParentViewInput } from '@copilot/projections';

/**
 * A deterministic demo scene assembled from the real engine packages — the same
 * pipeline production would run. No mock data structures: seed evidence in, real
 * twin / gaps / plan out. Situation matches the design narrative (lớp 7, tỉ lệ
 * thức & dãy tỉ số bằng nhau, gap ở quy đồng mẫu số).
 */
const CHILD = asChildId('demo_minh_anh');
const AS_OF = new Date('2026-08-31T09:00:00Z');

const PROFILE = {
  childId: CHILD as string,
  displayName: 'Minh Anh',
  schoolGrade: 7,
  schoolContext: 'Kết nối tri thức',
};

function seedEvidence(): Evidence[] {
  const at = (days: number) => new Date(AS_OF.getTime() - days * 86_400_000).toISOString();
  const mk = (
    i: number,
    skillId: string,
    days: number,
    correct: boolean,
    extra: Partial<Evidence> = {},
  ): Evidence => ({
    id: `ev_${String(i).padStart(3, '0')}` as Evidence['id'],
    childId: CHILD,
    source: 'app_practice',
    occurredAt: at(days),
    recordedAt: at(days),
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...extra,
  });

  return [
    mk(1, 'M7.RATIO.PROPORTION', 26, true, { confidenceTier: 'A' }),
    mk(2, 'M7.RATIO.PROPORTION', 18, true, { confidenceTier: 'A' }),
    mk(3, 'M7.RATIO.EQUAL_CHAIN', 9, true, { problemTypeId: undefined }),
    mk(4, 'M7.RATIO.EQUAL_CHAIN', 4, true),
    mk(5, 'M7.ALG.IDENTITY', 12, true, { confidenceTier: 'A' }),
    mk(6, 'M7.ALG.IDENTITY', 5, true),
    mk(7, 'M4.FRAC.EQUIVALENT', 24, true, { confidenceTier: 'A' }),
    mk(8, 'M4.FRAC.COMMON_DENOM', 10, false, { reasoningQuality: 'weak', source: 'school_homework', provenance: 'scan' }),
    mk(9, 'M4.FRAC.COMMON_DENOM', 6, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
    mk(10, 'M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
  ];
}

export function demoScene() {
  const kb = loadKnowledgeBase();
  const evidence = seedEvidence();
  const twin = buildLearningTwin({ childId: CHILD, gradeContext: 7, evidence, knowledgeBase: kb, asOf: AS_OF });
  const gaps = runGapEngine({
    childId: CHILD,
    gradeContext: 7,
    twin,
    evidence,
    knowledgeBase: kb,
    parentGoal: 'kha_gioi',
    asOf: AS_OF,
  });
  const context = buildLearningContext({
    childId: CHILD,
    gradeContext: 7,
    evidence,
    teacherContributions: [
      {
        id: 'tc_1',
        childId: CHILD,
        contributedAs: 'teacher',
        actorUserId: 'teacher_hang',
        occurredOn: '2026-08-24',
        recordedAt: '2026-08-24T12:00:00Z',
        taughtSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN')],
        problemTypeIds: [],
        homeworkRefs: ['SGK tr.12 bài 1-4'],
      },
    ],
    knowledgeBase: kb,
    asOf: AS_OF,
  });
  const plan = buildDailyPlan({
    childId: CHILD,
    planDate: '2026-08-31',
    availableMinutes: 25,
    twin,
    gaps,
    context,
    knowledgeBase: kb,
    parentGoal: 'kha_gioi',
    daysToExam: 13,
    asOf: AS_OF,
  });

  const viewInput: ParentViewInput = { profile: PROFILE, twin, gaps, context, plan, knowledgeBase: kb, examCountdownDays: 13 };
  return {
    home: buildParentHome(viewInput),
    progress: buildParentProgress(viewInput),
  };
}
