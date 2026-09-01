/**
 * B3 functional demo (doc 17 §7) — 3 children showing the Curriculum Clock +
 * Learning Context Resolver end to end. Pure; used by the test + the report script.
 */
import { asChildId, asSkillId, type Evidence } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { CurriculumClockService, toExpectedLearningContext } from '@copilot/curriculum-clock';
import { buildLearningContext } from '@copilot/learning-context';

const kb = loadKnowledgeBase();
const clock = new CurriculumClockService();
const ENROLL = { curriculum: 'KET_NOI_TRI_THUC', academicYear: '2026-2027' } as const;

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

export function runB3Demo(): DemoCase[] {
  const out: DemoCase[] = [];

  // --- CHILD A: Grade 4, no parent/teacher update, no evidence ---
  {
    const asOf = new Date('2026-11-14T09:00:00Z');
    const clk = clock.positionFor({ ...ENROLL, grade: 4 }, asOf)!;
    const ctx = buildLearningContext({
      childId: asChildId('A'),
      gradeContext: 4,
      evidence: [],
      teacherContributions: [],
      expectedContext: toExpectedLearningContext(clk),
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
    const clk = clock.positionFor({ ...ENROLL, grade: 4 }, asOf)!;
    // parent confirms a lesson one chapter ahead of the estimate
    const confirmedLesson = 'C.G4.8.5'; // Tính chất phân phối — chapter 8
    const ctx = buildLearningContext({
      childId: asChildId('B'),
      gradeContext: 4,
      evidence: [],
      teacherContributions: [],
      lessonConfirmations: [
        {
          id: 'lc_B',
          childId: asChildId('B'),
          lessonId: confirmedLesson,
          source: 'PARENT_UPDATE',
          confidence: 'STRONG',
          confirmedBy: 'parent_B',
          confirmedAt: '2026-11-13T20:00:00Z',
        },
      ],
      expectedContext: toExpectedLearningContext(clk),
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

  // --- CHILD C: Grade 7, timeline ~chapter 6, repeated homework a chapter ahead → paceDelta ---
  {
    const asOf = new Date('2027-01-20T09:00:00Z');
    const clk = clock.positionFor({ ...ENROLL, grade: 7 }, asOf)!;
    // calendar ≈ chapter 6 (tỉ lệ). Homework consistently on chapter 7 (đa thức).
    const ctx = buildLearningContext({
      childId: asChildId('C'),
      gradeContext: 7,
      evidence: [
        ev('C', 'M7.ALG.POLY_1VAR', '2027-01-05T08:00:00Z', { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
        ev('C', 'M7.ALG.POLY_ADD_SUB', '2027-01-12T08:00:00Z', { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
        ev('C', 'M7.ALG.POLY_MUL', '2027-01-18T08:00:00Z', { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
      ],
      teacherContributions: [],
      expectedContext: toExpectedLearningContext(clk),
      knowledgeBase: kb,
      asOf,
    });
    out.push({
      label: 'CHILD C — Grade 7, calendar X vs repeated homework ahead of calendar (paceDelta)',
      expected: ctx.expected,
      resolved: ctx.resolved,
      paceDelta: ctx.paceDelta,
      paceDeltaHypothesis: ctx.paceDeltaHypothesis,
      conflicts: ctx.conflicts,
    });
  }

  return out;
}
