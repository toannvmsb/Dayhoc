import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type Evidence, type ExpectedLearningContext, type TeacherContribution } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { resolveLearningContext } from './resolver.js';

const kb = loadKnowledgeBase();
const childId = asChildId('c1');
const asOf = new Date('2027-02-01T09:00:00Z');

// two skills that map to different curriculum nodes
const SK_CH6 = 'M7.RATIO.EQUAL_CHAIN'; // C.G7.6.21
const SK_CH7 = 'M7.ALG.POLY_MUL'; // C.G7.7.27
const nodeOf = (s: string) => kb.skills.get(s)!.curriculumNodeId;

function ev(skillId: string, daysAgo: number, over: Partial<Evidence> = {}): Evidence {
  const at = new Date(asOf.getTime() - daysAgo * 86_400_000).toISOString();
  return {
    id: `ev_${skillId}_${daysAgo}`,
    childId,
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

const clockAt = (lessonId: string, windowIds: string[] = [lessonId]): ExpectedLearningContext => ({
  curriculum: 'KET_NOI_TRI_THUC',
  chapterId: Number(/C\.G7\.(\d+)\./.exec(lessonId)![1]),
  lessonId,
  alsoPlausibleLessonIds: [],
  window: {
    fromLessonId: windowIds[0]!,
    toLessonId: windowIds[windowIds.length - 1]!,
    widthLessons: 2,
    lessonIds: windowIds,
  },
  source: 'CURRICULUM_TIMELINE',
  confidence: 'ESTIMATED',
  asOfDate: '2027-02-01',
  paceDeltaApplied: 0,
  calendar: {
    calendarId: 'cal.KNTT.G7.2026-2027.v1',
    version: 1,
    status: 'PROVISIONAL',
    source: 'test',
    academicYear: '2026-2027',
  },
});

describe('LearningContextResolver (doc 13 §3)', () => {
  it('with no signals at all → the calendar estimate, ESTIMATED', () => {
    const r = resolveLearningContext({ expected: clockAt(nodeOf(SK_CH6)), contributions: [], evidence: [], knowledgeBase: kb, asOf });
    expect(r.resolved.source).toBe('CURRICULUM_TIMELINE');
    expect(r.resolved.confidence).toBe('ESTIMATED');
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH6));
  });

  it('TEST 2 — a verified parent update overrides the calendar estimate', () => {
    const contribution: TeacherContribution = {
      id: 'tc', childId, contributedAs: 'parent', actorUserId: 'u',
      occurredOn: '2027-01-28', recordedAt: '2027-01-28T00:00:00Z',
      taughtSkillIds: [asSkillId(SK_CH7)], problemTypeIds: [], homeworkRefs: [],
    };
    const r = resolveLearningContext({
      expected: clockAt(nodeOf(SK_CH6)), // calendar says chapter 6
      contributions: [contribution], // parent says chapter 7
      evidence: [],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH7));
    expect(r.resolved.source).toBe('PARENT_UPDATE');
  });

  it('NOT latest-wins: a lone stale calendar estimate never overrides a recent verified test', () => {
    const r = resolveLearningContext({
      expected: clockAt(nodeOf(SK_CH7)), // calendar (weak) says chapter 7
      contributions: [],
      evidence: [
        ev(SK_CH6, 5, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }), // verified, 5 days ago
      ],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH6));
    expect(r.resolved.confidence).toBe('VERIFIED');
    expect(r.resolved.lastVerifiedAt).not.toBeNull();
  });

  it('repeated homework evidence on the same lesson raises its score above a single app attempt elsewhere', () => {
    const r = resolveLearningContext({
      expected: null,
      contributions: [],
      evidence: [
        ev(SK_CH7, 3, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
        ev(SK_CH7, 6, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
        ev(SK_CH7, 9, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
        ev(SK_CH6, 2), // one app attempt on a different chapter
      ],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH7));
  });

  it('is a pure replay of its inputs (idempotent)', () => {
    const input = {
      expected: clockAt(nodeOf(SK_CH6)),
      contributions: [],
      evidence: [ev(SK_CH6, 2), ev(SK_CH7, 4)],
      knowledgeBase: kb,
      asOf,
    };
    expect(resolveLearningContext(input)).toEqual(resolveLearningContext(input));
  });
});

describe('Context Resolver hard invariants (doc 13 §2 A–F)', () => {
  it('A — a recent VERIFIED context is not overridden by CURRICULUM_TIMELINE', () => {
    const r = resolveLearningContext({
      expected: clockAt(nodeOf(SK_CH7)),
      contributions: [],
      evidence: [ev(SK_CH6, 4, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' })],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH6));
    expect(r.resolved.source).not.toBe('CURRICULUM_TIMELINE');
  });

  it('B3-4 — 10 low-confidence observations do not silently override a recent VERIFIED', () => {
    const noise = Array.from({ length: 10 }, (_, i) => ev(SK_CH7, 2 + i, { confidenceTier: 'D' }));
    const r = resolveLearningContext({
      expected: null,
      contributions: [],
      evidence: [ev(SK_CH6, 3, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }), ...noise],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH6));
    expect(r.resolved.confidence).toBe('VERIFIED');
  });

  it('B — ESTIMATED evidence is never promoted to VERIFIED by repetition', () => {
    const many = Array.from({ length: 6 }, (_, i) => ev(SK_CH7, 2 + i, { confidenceTier: 'D' }));
    const r = resolveLearningContext({ expected: null, contributions: [], evidence: many, knowledgeBase: kb, asOf });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH7));
    expect(['ESTIMATED', 'SUPPORTING']).toContain(r.resolved.confidence);
    expect(r.resolved.confidence).not.toBe('VERIFIED');
  });

  it('C — a single supporting observation does NOT raise confidence to STRONG', () => {
    const r = resolveLearningContext({
      expected: null,
      contributions: [],
      evidence: [ev(SK_CH6, 3, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' })],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.confidence).toBe('SUPPORTING');
  });

  it('D / B3-6 — conflicting VERIFIED sources → conflict state + deterministic (most-recent) resolution', () => {
    const r = resolveLearningContext({
      expected: null,
      contributions: [],
      evidence: [
        ev(SK_CH6, 10, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
        ev(SK_CH7, 2, { source: 'school_exam', provenance: 'assessment', confidenceTier: 'A' }),
      ],
      knowledgeBase: kb,
      asOf,
    });
    expect(r.resolved.guardrailApplied).toContain('conflicting_verified');
    expect(r.conflictLessonIds).toContain(nodeOf(SK_CH6)); // the older one is the conflict
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH7)); // most recent wins
  });

  it('E — an old VERIFIED is weighted down but its evidence is still in the input (history kept)', () => {
    // stale verified (60 days) on CH6 vs recent homework on CH7
    const r = resolveLearningContext({
      expected: null,
      contributions: [],
      evidence: [
        ev(SK_CH6, 60, { source: 'school_test', provenance: 'assessment', confidenceTier: 'A' }),
        ev(SK_CH7, 3, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
        ev(SK_CH7, 6, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' }),
      ],
      knowledgeBase: kb,
      recencyDays: 90,
      asOf,
    });
    expect(r.resolved.lessonId).toBe(nodeOf(SK_CH7)); // stale verified no longer dominates
  });

  it('F — parent/teacher confirmation and observed schoolwork are distinct source types', () => {
    const confirmed = resolveLearningContext({
      expected: null,
      contributions: [],
      lessonConfirmations: [
        { id: 'lc1', childId, lessonId: nodeOf(SK_CH7), source: 'PARENT_UPDATE', confidence: 'STRONG', confirmedBy: 'u', confirmedAt: new Date(asOf.getTime() - 2 * 86_400_000).toISOString() },
      ],
      evidence: [ev(SK_CH6, 3)],
      knowledgeBase: kb,
      asOf,
    });
    expect(confirmed.resolved.source).toBe('PARENT_UPDATE');

    const observed = resolveLearningContext({
      expected: null,
      contributions: [],
      evidence: [ev(SK_CH7, 2, { source: 'school_homework', provenance: 'scan', confidenceTier: 'C' })],
      knowledgeBase: kb,
      asOf,
    });
    expect(observed.resolved.source).toBe('SCHOOLWORK_EVIDENCE');
  });
});
