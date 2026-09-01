import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence, type ExpectedLearningContext, type LessonConfirmationEvent } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { AUTO_APPLY_BOUND, HYPOTHESIS_BOUND, evaluatePace } from './pace.js';

const kb = loadKnowledgeBase();
const childId = asChildId('c1');
const asOf = new Date('2027-02-01T09:00:00Z');

// grade-7 nodes: C.G7.6.21 = idx 20, C.G7.7.25/26/27 = idx 24/25/26, C.G7.1.4 = idx 3
const AHEAD = ['M7.ALG.POLY_1VAR', 'M7.ALG.POLY_ADD_SUB', 'M7.ALG.POLY_MUL'];
const BEHIND = 'M7.QNUM.ORDER_TRANSPOSE';
const nodeOf = (s: string) => kb.skills.get(s)!.curriculumNodeId;

const expectedAt = (lessonId: string): ExpectedLearningContext => ({
  curriculum: 'KET_NOI_TRI_THUC',
  chapterId: Number(/C\.G7\.(\d+)\./.exec(lessonId)![1]),
  lessonId,
  alsoPlausibleLessonIds: [],
  window: { fromLessonId: lessonId, toLessonId: lessonId, widthLessons: 2, lessonIds: [lessonId] },
  source: 'CURRICULUM_TIMELINE',
  confidence: 'ESTIMATED',
  asOfDate: '2027-02-01',
  paceDeltaApplied: 0,
  calendar: { calendarId: 'cal.KNTT.G7.2026-2027.v1', version: 1, status: 'PROVISIONAL', source: 't', academicYear: '2026-2027' },
});

/** homework scan `daysAgo` before asOf, on a chapter-7 polynomial skill (ahead of calendar). */
function hw(skillId: string, daysAgo: number): Evidence {
  const at = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${skillId}_${daysAgo}`,
    childId,
    source: 'school_homework',
    occurredAt: at,
    recordedAt: at,
    skillId: asSkillId(skillId),
    result: { correct: true },
    confidenceTier: 'C',
    provenance: 'scan',
  };
}
const rr = <T>(xs: T[], n: number): T => xs[n % xs.length]!;

describe('curriculum-pace policy (doc 13 §4)', () => {
  const expected = expectedAt(nodeOf('M7.RATIO.EQUAL_CHAIN')); // calendar ≈ Bài 21

  it('1–2 consistent observations → no adjustment, no hypothesis', () => {
    const r = evaluatePace({ expected, evidence: [hw(AHEAD[0]!, 3), hw(AHEAD[1]!, 9)], knowledgeBase: kb, asOf });
    expect(r.hypothesis.value).toBe(0);
    expect(r.autoApply.applied).toBe(false);
  });

  it('3–4 consistent observations → hypothesis only, NOT auto-applied', () => {
    const evidence = [0, 1, 2].map((i) => hw(rr(AHEAD, i), 3 + i * 5));
    const r = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    expect(r.hypothesis.value).toBeGreaterThan(0);
    expect(r.hypothesis.observationCount).toBe(3);
    expect(r.autoApply.applied).toBe(false);
    expect(r.autoApply.confidence).toBe('NONE');
  });

  it('≥5 consistent observations spanning ≥2 school weeks → auto-apply LOW, bounded', () => {
    const evidence = [0, 5, 10, 15, 20].map((d, i) => hw(rr(AHEAD, i), d + 2));
    const r = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    expect(r.hypothesis.spanWeeks).toBeGreaterThanOrEqual(2);
    expect(r.autoApply.applied).toBe(true);
    expect(r.autoApply.confidence).toBe('LOW');
    expect(Math.abs(r.autoApply.value)).toBeLessThanOrEqual(AUTO_APPLY_BOUND);
    expect(Math.abs(r.hypothesis.value)).toBeLessThanOrEqual(HYPOTHESIS_BOUND);
  });

  it('5 observations all in ONE school week → hypothesis only (span gate)', () => {
    const evidence = [0, 1, 2, 3, 4].map((d, i) => hw(rr(AHEAD, i), d + 2));
    const r = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    expect(r.hypothesis.observationCount).toBe(5);
    expect(r.hypothesis.spanWeeks).toBe(1);
    expect(r.autoApply.applied).toBe(false);
  });

  it('conflicting direction → pace held at 0 (decay / recalculate)', () => {
    const evidence = [hw(AHEAD[0]!, 4), hw(AHEAD[1]!, 10), hw(BEHIND, 6)];
    const r = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    expect(r.hypothesis.value).toBe(0);
    expect(r.autoApply.applied).toBe(false);
    expect(r.autoApply.reason).toMatch(/conflicting/i);
  });

  it('stale evidence (all older than the observation window) → decays to 0', () => {
    const evidence = [40, 50, 60, 70, 80].map((d, i) => hw(rr(AHEAD, i), d));
    const r = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    expect(r.hypothesis.value).toBe(0);
    expect(r.autoApply.applied).toBe(false);
  });

  it('a recent lesson confirmation ≥2 lessons ahead lowers the auto-apply floor to 3', () => {
    const confirmation: LessonConfirmationEvent = {
      id: 'lc1',
      childId,
      lessonId: nodeOf('M7.ALG.POLY_ADD_SUB'), // ~5 lessons ahead of the calendar
      source: 'TEACHER_UPDATE',
      confidence: 'VERIFIED',
      confirmedBy: 'teacher',
      confirmedAt: new Date(asOf.getTime() - 4 * 86_400_000).toISOString(),
    };
    const evidence = [2, 9, 16].map((d, i) => hw(rr(AHEAD, i), d));
    const r = evaluatePace({ expected, evidence, lessonConfirmations: [confirmation], knowledgeBase: kb, asOf });
    expect(r.hypothesis.observationCount).toBe(3);
    expect(r.autoApply.applied).toBe(true);
  });

  it('extreme lag is clamped to the bounds', () => {
    const near = expectedAt(nodeOf(BEHIND)); // calendar ≈ Bài 4, homework ≈ Bài 27 → huge lead
    const evidence = [0, 5, 10, 15, 20].map((d, i) => hw(rr(AHEAD, i), d + 2));
    const r = evaluatePace({ expected: near, evidence, knowledgeBase: kb, asOf });
    expect(r.hypothesis.value).toBe(HYPOTHESIS_BOUND);
    expect(r.autoApply.value).toBe(AUTO_APPLY_BOUND);
  });

  it('is pure — identical inputs give identical output', () => {
    const evidence = [0, 5, 10, 15, 20].map((d, i) => hw(rr(AHEAD, i), d + 2));
    const a = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    const b = evaluatePace({ expected, evidence, knowledgeBase: kb, asOf });
    expect(a).toEqual(b);
  });

  it('no calendar estimate → no pace signal', () => {
    const r = evaluatePace({ expected: null, evidence: [hw(AHEAD[0]!, 2)], knowledgeBase: kb, asOf });
    expect(r.autoApply.applied).toBe(false);
    expect(r.hypothesis.value).toBe(0);
  });
});
