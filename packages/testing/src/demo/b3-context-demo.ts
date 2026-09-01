/**
 * B3 functional demo (doc 17 §7) — 3 children showing the Curriculum Clock +
 * Learning Context Resolver end to end. Pure; used by the test + the report script.
 */
import { asChildId, asSkillId, type Evidence, type LessonConfirmationEvent } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { CurriculumClockService, toExpectedLearningContext } from '@copilot/curriculum-clock';
import { buildLearningContext, evaluatePace, type PaceEvaluation } from '@copilot/learning-context';

const kb = loadKnowledgeBase();
const clock = new CurriculumClockService();
const ENROLL = { curriculum: 'KET_NOI_TRI_THUC', academicYear: '2026-2027' } as const;

/** Clock + curriculum-pace policy two-pass (doc 13 §4), as the API runs it. */
function clockWithPace(
  grade: 4 | 7,
  asOf: Date,
  evidence: readonly Evidence[],
  lessonConfirmations: readonly LessonConfirmationEvent[] = [],
): {
  expectedContext: ReturnType<typeof toExpectedLearningContext> | null;
  appliedPaceDelta: number;
  paceEvaluation: PaceEvaluation;
} {
  const child = { ...ENROLL, grade };
  const base = clock.positionFor(child, asOf);
  const paceEvaluation = evaluatePace({
    expected: base ? toExpectedLearningContext(base) : null,
    evidence,
    lessonConfirmations,
    knowledgeBase: kb,
    asOf,
  });
  const appliedPaceDelta = paceEvaluation.autoApply.applied ? paceEvaluation.autoApply.value : 0;
  const effective =
    appliedPaceDelta !== 0 ? clock.positionFor(child, asOf, { paceDeltaOverride: appliedPaceDelta }) : base;
  return {
    expectedContext: effective ? toExpectedLearningContext(effective) : null,
    appliedPaceDelta,
    paceEvaluation,
  };
}

function ev(childId: string, skillId: string, at: string, over: Partial<Evidence> = {}): Evidence {
  return {
    id: `ev_${skillId}_${at}` as Evidence['id'],
    childId: asChildId(childId),
    source: 'app_practice',
    occurredAt: at,
    recordedAt: at,
    skillId: asSkillId(skillId),
    result: { correct: true },
    confidenceTier: 'B',
    provenance: 'manual',
    ...over,
  };
}

export interface DemoCase {
  readonly label: string;
  readonly expected: unknown;
  readonly resolved: unknown;
  readonly paceDelta: number;
  readonly paceDeltaHypothesis: unknown;
  readonly conflicts: unknown;
}

const HW_SCAN: Partial<Evidence> = { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' };

export function runB3Demo(): DemoCase[] {
  const out: DemoCase[] = [];

  // --- CHILD A: Grade 4, no parent/teacher update, no evidence ---
  {
    const asOf = new Date('2026-11-14T09:00:00Z');
    const { expectedContext, appliedPaceDelta, paceEvaluation } = clockWithPace(4, asOf, []);
    const ctx = buildLearningContext({
      childId: asChildId('A'),
      gradeContext: 4,
      evidence: [],
      teacherContributions: [],
      expectedContext,
      appliedPaceDelta,
      paceEvaluation,
      knowledgeBase: kb,
      asOf,
    });
    out.push({
      label: 'CHILD A — Grade 4, no Parent/Teacher update, no evidence',
      expected: ctx.expected,
      resolved: ctx.resolved,
      paceDelta: ctx.paceDelta,
      paceDeltaHypothesis: ctx.paceDeltaHypothesis,
      conflicts: ctx.conflicts,
    });
  }

  // --- CHILD B: Grade 4, timeline says lesson X, parent confirms X+1 ---
  {
    const asOf = new Date('2026-11-14T09:00:00Z');
    const confirmations: LessonConfirmationEvent[] = [
      {
        id: 'lc_B',
        childId: asChildId('B'),
        lessonId: 'C.G4.8.5', // Tính chất phân phối — chapter 8
        source: 'PARENT_UPDATE',
        confidence: 'STRONG',
        confirmedBy: 'parent_B',
        confirmedAt: '2026-11-13T20:00:00Z',
      },
    ];
    const { expectedContext, appliedPaceDelta, paceEvaluation } = clockWithPace(4, asOf, [], confirmations);
    const ctx = buildLearningContext({
      childId: asChildId('B'),
      gradeContext: 4,
      evidence: [],
      teacherContributions: [],
      lessonConfirmations: confirmations,
      expectedContext,
      appliedPaceDelta,
      paceEvaluation,
      knowledgeBase: kb,
      asOf,
    });
    out.push({
      label: 'CHILD B — Grade 4, calendar estimate vs parent confirmation (X+1)',
      expected: ctx.expected,
      resolved: ctx.resolved,
      paceDelta: ctx.paceDelta,
      paceDeltaHypothesis: ctx.paceDeltaHypothesis,
      conflicts: ctx.conflicts,
    });
  }

  // --- CHILD C: Grade 7, calendar ~chapter 6, 5 homework scans over 3 school weeks
  //     consistently a chapter ahead → curriculum-pace policy AUTO-APPLIES a
  //     LOW-confidence paceDelta. Note: resolved context stays SUPPORTING — the
  //     pace only shifts the FUTURE estimate, it does not become verified. ---
  {
    const asOf = new Date('2027-01-25T09:00:00Z');
    const evidence: Evidence[] = [
      ev('C', 'M7.ALG.POLY_1VAR', '2027-01-02T08:00:00Z', HW_SCAN),
      ev('C', 'M7.ALG.POLY_ADD_SUB', '2027-01-08T08:00:00Z', HW_SCAN),
      ev('C', 'M7.ALG.POLY_MUL', '2027-01-13T08:00:00Z', HW_SCAN),
      ev('C', 'M7.ALG.POLY_ADD_SUB', '2027-01-18T08:00:00Z', HW_SCAN),
      ev('C', 'M7.ALG.POLY_MUL', '2027-01-22T08:00:00Z', HW_SCAN),
    ];
    const { expectedContext, appliedPaceDelta, paceEvaluation } = clockWithPace(7, asOf, evidence);
    const ctx = buildLearningContext({
      childId: asChildId('C'),
      gradeContext: 7,
      evidence,
      teacherContributions: [],
      expectedContext,
      appliedPaceDelta,
      paceEvaluation,
      knowledgeBase: kb,
      asOf,
    });
    out.push({
      label: 'CHILD C — Grade 7, 5 homework scans over 3 weeks ahead → auto-applied LOW paceDelta',
      expected: ctx.expected,
      resolved: ctx.resolved,
      paceDelta: ctx.paceDelta,
      paceDeltaHypothesis: ctx.paceDeltaHypothesis,
      conflicts: ctx.conflicts,
    });
  }

  return out;
}
