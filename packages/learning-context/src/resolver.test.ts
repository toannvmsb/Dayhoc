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

const clockAt = (lessonId: string): ExpectedLearningContext => ({
  curriculum: 'KET_NOI_TRI_THUC',
  chapterId: Number(/C\.G7\.(\d+)\./.exec(lessonId)![1]),
  lessonId,
  alsoPlausibleLessonIds: [],
  source: 'CURRICULUM_TIMELINE',
  confidence: 'ESTIMATED',
  asOfDate: '2027-02-01',
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
