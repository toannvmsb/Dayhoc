import { describe, expect, it } from 'vitest';
import {
  asChildId,
  asSkillId,
  distributionTotal,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type Evidence,
  type ParentGoal,
  type TeacherContribution,
} from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildExerciseGenerationSpec } from './exercise-spec.js';

const kb = loadKnowledgeBase();
const asOf = new Date('2027-01-25T09:00:00Z');
let n = 0;

const LESSON_SKILL = 'M7.RATIO.EQUAL_CHAIN'; // C.G7.6.21
const PREREQ = 'M7.RATIO.PROPORTION'; // direct prereq
const ADV = 'M7.ALG.SYMMETRIC'; // curriculumOrigin 9 → above-grade algebra frontier

function ev(childId: string, skillId: string, daysAgo: number, correct: boolean, extra: Partial<Evidence> = {}): Evidence {
  const at = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${++n}` as Evidence['id'],
    childId: asChildId(childId),
    source: 'app_practice',
    occurredAt: at,
    recordedAt: at,
    skillId: asSkillId(skillId),
    result: { correct },
    confidenceTier: 'B',
    provenance: 'manual',
    ...extra,
  };
}

const teacherOnLesson = (childId: string): TeacherContribution => ({
  id: `tc_${childId}`,
  childId: asChildId(childId),
  contributedAs: 'teacher',
  actorUserId: 'teacher',
  occurredOn: '2027-01-19',
  recordedAt: '2027-01-19T12:00:00Z',
  taughtSkillIds: [asSkillId(LESSON_SKILL)],
  problemTypeIds: [],
  homeworkRefs: [],
});

function spec(childId: string, evidence: Evidence[], parentGoal: ParentGoal, daysToExam?: number) {
  const cid = asChildId(childId);
  const twin = buildLearningTwin({ childId: cid, gradeContext: 7, evidence, knowledgeBase: kb, asOf });
  const gaps = runGapEngine({ childId: cid, gradeContext: 7, twin, evidence, knowledgeBase: kb, parentGoal, asOf });
  const context = buildLearningContext({
    childId: cid,
    gradeContext: 7,
    evidence,
    teacherContributions: [teacherOnLesson(childId)],
    knowledgeBase: kb,
    asOf,
  });
  return buildExerciseGenerationSpec({
    childId: cid,
    gradeContext: 7,
    twin,
    gaps,
    context,
    knowledgeBase: kb,
    parentGoal,
    availableMinutes: 25,
    ...(daysToExam !== undefined ? { daysToExam } : {}),
    asOf,
    newId: (() => {
      let i = 0;
      return () => `${childId}_${i++}`;
    })(),
  });
}

// weak-prerequisite child: fails PROPORTION repeatedly + shaky on the lesson skill
const weakChild = (id: string) => [
  ev(id, PREREQ, 20, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
  ev(id, PREREQ, 9, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
  ev(id, PREREQ, 3, false, { reasoningQuality: 'weak' }),
  ev(id, LESSON_SKILL, 5, false, { reasoningQuality: 'weak' }),
  ev(id, LESSON_SKILL, 2, false),
];

// strong child: solid on the lesson skill + prereq, real traction above grade
const strongChild = (id: string) => [
  ev(id, PREREQ, 24, true, { confidenceTier: 'A' }),
  ev(id, PREREQ, 10, true, { confidenceTier: 'A' }),
  ev(id, LESSON_SKILL, 12, true, { confidenceTier: 'A' }),
  ev(id, LESSON_SKILL, 4, true, { confidenceTier: 'A' }),
  ev(id, ADV, 14, true, { confidenceTier: 'A' }),
  ev(id, ADV, 6, true, { confidenceTier: 'A' }),
];

describe('buildExerciseGenerationSpec (doc 14 §3, C1)', () => {
  it('is a pure function — identical inputs give identical specs (modulo id/createdAt)', () => {
    const a = spec('c_pure', weakChild('c_pure'), 'theo_sat_chuong_trinh');
    const b = spec('c_pure', weakChild('c_pure'), 'theo_sat_chuong_trinh');
    expect({ ...a, generationSpecId: '', createdAt: '' }).toEqual({ ...b, generationSpecId: '', createdAt: '' });
  });

  it('distribution always reconciles exactly to totalQuestions', () => {
    for (const s of [
      spec('c1', weakChild('c1'), 'theo_sat_chuong_trinh'),
      spec('c2', strongChild('c2'), 'hsg_thi_chuyen'),
      spec('c3', strongChild('c3'), 'phat_trien_tu_duy', 5),
    ]) {
      expect(distributionTotal(s.generationPlan.distribution)).toBe(s.generationPlan.totalQuestions);
    }
  });

  it('every target skill id exists in the production KB', () => {
    const s = spec('c_ids', strongChild('c_ids'), 'kha_gioi');
    for (const id of s.targets.skillIds) expect(kb.skills.has(id)).toBe(true);
    for (const pt of s.targets.problemTypeIds) expect(kb.problemTypes.some((p) => p.id === pt)).toBe(true);
  });

  // CASE A — two Grade-7 children, same lesson & textbook, different state → different specs
  it('CASE A — weak-prereq child vs strong+HSG child produce materially different specs', () => {
    const weak = spec('c_weak', weakChild('c_weak'), 'theo_sat_chuong_trinh');
    const strong = spec('c_strong', strongChild('c_strong'), 'hsg_thi_chuyen');

    expect(weak.learningContext.resolvedLessonId).toBe(strong.learningContext.resolvedLessonId); // same lesson

    // weak child: prerequisite repair scheduled, difficulty pulled down
    expect(weak.childState.prerequisiteGaps.length).toBeGreaterThan(0);
    expect(weak.generationPlan.distribution.prerequisiteRepair).toBeGreaterThanOrEqual(1);
    expect(KNOWLEDGE_LEVELS.indexOf(weak.difficulty.kMax)).toBeLessThan(KNOWLEDGE_LEVELS.indexOf(strong.difficulty.kMax));

    // strong + HSG child: advanced + thinking scheduled, higher ceiling
    expect(strong.generationPlan.distribution.advanced).toBeGreaterThanOrEqual(1);
    expect(strong.generationPlan.distribution.thinkingChallenge).toBeGreaterThanOrEqual(1);
    expect(strong.difficulty.stretchRatio).toBeGreaterThan(weak.difficulty.stretchRatio);

    expect(weak.generationPlan.distribution).not.toEqual(strong.generationPlan.distribution);
  });

  // CASE B — above-grade algebra frontier + a prereq weakness → parallel gap repair, no global downgrade
  it('CASE B — above-grade frontier + prereq weakness → prerequisiteRepair ≥ 1 AND advanced ≥ 1', () => {
    const evidence = [
      // real traction above grade (algebra frontier ~G9)
      ev('c_b', ADV, 16, true, { confidenceTier: 'A' }),
      ev('c_b', ADV, 7, true, { confidenceTier: 'A' }),
      ev('c_b', 'M7.ALG.FACTOR', 10, true, { confidenceTier: 'A' }),
      // but a shaky prerequisite for the current lesson
      ev('c_b', PREREQ, 12, false, { reasoningQuality: 'weak', source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
      ev('c_b', PREREQ, 4, false, { reasoningQuality: 'weak' }),
      ev('c_b', LESSON_SKILL, 3, true),
    ];
    const s = spec('c_b', evidence, 'hsg_thi_chuyen');
    expect(s.childState.actualLearningFrontier['algebraic_thinking']).toMatch(/above_grade/);
    expect(s.generationPlan.distribution.prerequisiteRepair).toBeGreaterThanOrEqual(1);
    expect(s.generationPlan.distribution.advanced).toBeGreaterThanOrEqual(1);
    // not collapsed to a single low grade level
    expect(KNOWLEDGE_LEVELS.indexOf(s.difficulty.kMax)).toBeGreaterThanOrEqual(KNOWLEDGE_LEVELS.indexOf('K3'));
  });

  // CASE C — same child state, different parent goal → distribution / K / T change; mastery does not
  it('CASE C — parent goal changes allocation and difficulty, never the mastery estimate', () => {
    const evidence = strongChild('c_c');
    const school = spec('c_c', evidence, 'theo_sat_chuong_trinh');
    const hsg = spec('c_c', evidence, 'hsg_thi_chuyen');

    expect(school.childState.relevantMastery).toEqual(hsg.childState.relevantMastery); // mastery is truth, goal-independent
    const changed =
      JSON.stringify(school.generationPlan.distribution) !== JSON.stringify(hsg.generationPlan.distribution) ||
      school.difficulty.kMax !== hsg.difficulty.kMax ||
      school.difficulty.tMax !== hsg.difficulty.tMax;
    expect(changed).toBe(true);
    expect(THINKING_LEVELS.indexOf(hsg.difficulty.tMax)).toBeGreaterThanOrEqual(THINKING_LEVELS.indexOf(school.difficulty.tMax));
  });

  // CASE D — ESTIMATED context → more conservative than a VERIFIED context
  it('CASE D — an ESTIMATED learning context is flagged and pulls difficulty down vs VERIFIED', () => {
    const evidence = strongChild('c_d');
    const cid = asChildId('c_d');
    const twin = buildLearningTwin({ childId: cid, gradeContext: 7, evidence, knowledgeBase: kb, asOf });
    const gaps = runGapEngine({ childId: cid, gradeContext: 7, twin, evidence, knowledgeBase: kb, asOf });

    const verifiedCtx = buildLearningContext({
      childId: cid, gradeContext: 7, evidence,
      teacherContributions: [teacherOnLesson('c_d')], knowledgeBase: kb, asOf,
    });
    const estimatedCtx = buildLearningContext({
      childId: cid, gradeContext: 7, evidence: [],
      teacherContributions: [], knowledgeBase: kb, asOf,
      expectedContext: {
        curriculum: 'KET_NOI_TRI_THUC', chapterId: 6, lessonId: 'C.G7.6.21', alsoPlausibleLessonIds: [],
        window: { fromLessonId: 'C.G7.6.21', toLessonId: 'C.G7.6.21', widthLessons: 2, lessonIds: ['C.G7.6.21'] },
        source: 'CURRICULUM_TIMELINE', confidence: 'ESTIMATED', asOfDate: '2027-01-25', paceDeltaApplied: 0,
        calendar: { calendarId: 'x', version: 1, status: 'PROVISIONAL', source: 't', academicYear: '2026-2027' },
      },
    });

    const common = { childId: cid, gradeContext: 7 as const, twin, gaps, knowledgeBase: kb, parentGoal: 'hsg_thi_chuyen' as ParentGoal, availableMinutes: 25, asOf };
    const verified = buildExerciseGenerationSpec({ ...common, context: verifiedCtx });
    const estimated = buildExerciseGenerationSpec({ ...common, context: estimatedCtx });

    expect(estimated.learningContext.isEstimated).toBe(true);
    expect(verified.learningContext.isEstimated).toBe(false);
    expect(KNOWLEDGE_LEVELS.indexOf(estimated.difficulty.kMax)).toBeLessThanOrEqual(
      KNOWLEDGE_LEVELS.indexOf(verified.difficulty.kMax),
    );
  });
});
