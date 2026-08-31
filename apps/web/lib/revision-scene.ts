import { asChildId, asSkillId, type Evidence, type Exam } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine } from '@copilot/gap-engine';
import { buildLearningContext } from '@copilot/learning-context';
import { buildRevisionPlan, buildWeeklyReport, inferExamScope } from '@copilot/revision';
import { buildExamRevisionView, buildWeeklyReportView } from '@copilot/projections';

const CHILD = asChildId('demo_minh_anh');
const AS_OF = new Date('2026-08-31T09:00:00Z');

function base() {
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
    mk(1, 'M7.RATIO.EQUAL_CHAIN', 5, true, { confidenceTier: 'A' }),
    mk(2, 'M7.RATIO.PROPORTION', 12, true, { confidenceTier: 'A' }),
    mk(3, 'M4.FRAC.COMMON_DENOM', 120, true, { confidenceTier: 'A' }),
    mk(4, 'M4.FRAC.COMMON_DENOM', 4, false, { reasoningQuality: 'weak', timeSpentSeconds: 300 }),
    mk(5, 'M4.FRAC.COMMON_DENOM', 2, false, { reasoningQuality: 'weak', timeSpentSeconds: 240 }),
  ];
  const twin = buildLearningTwin({ childId: CHILD, gradeContext: 7, evidence, knowledgeBase: kb, asOf: AS_OF });
  const gaps = runGapEngine({ childId: CHILD, gradeContext: 7, twin, evidence, knowledgeBase: kb, asOf: AS_OF });
  const context = buildLearningContext({
    childId: CHILD,
    gradeContext: 7,
    evidence,
    teacherContributions: [
      { id: 'tc', childId: CHILD, contributedAs: 'teacher', actorUserId: 't', occurredOn: '2026-08-25', recordedAt: '2026-08-25T00:00:00Z', taughtSkillIds: [asSkillId('M7.RATIO.EQUAL_CHAIN')], problemTypeIds: [], homeworkRefs: [] },
    ],
    knowledgeBase: kb,
    asOf: AS_OF,
  });
  return { kb, twin, gaps, context, evidence };
}

export function examRevisionView() {
  const { kb, twin, gaps, context } = base();
  const exam: Exam = {
    id: 'exam_1',
    childId: CHILD,
    examDate: '2026-09-12',
    subject: 'Toán',
    inferredScope: inferExamScope(context, twin, kb),
  };
  const plan = buildRevisionPlan({ childId: CHILD, exam, twin, gaps, knowledgeBase: kb, asOf: AS_OF });
  return buildExamRevisionView(exam, plan, kb);
}

export function weeklyReportView() {
  const { kb, twin, gaps, evidence } = base();
  const before = buildLearningTwin({ childId: CHILD, gradeContext: 7, evidence: [], knowledgeBase: kb, asOf: AS_OF });
  return buildWeeklyReportView(
    buildWeeklyReport({
      childId: CHILD,
      weekOf: '2026-08-24',
      weekEvidence: evidence,
      twinBefore: before,
      twinAfter: twin,
      gapsAfter: gaps,
      knowledgeBase: kb,
    }),
  );
}
