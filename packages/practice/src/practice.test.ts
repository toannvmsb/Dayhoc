import { describe, expect, it } from 'vitest';
import {
  asChildId,
  asSkillId,
  KNOWLEDGE_LEVELS,
  type ChildLearningTwin,
  type PlannedAction,
  type Question,
  type Submission,
} from '@copilot/domain';
import { examplesForSkill, loadReferenceLibrary } from '@copilot/reference-library';
import { buildAssignment } from './assignment.js';
import { advanceHintLadder, currentHintText, initHintLadder } from './hint-ladder.js';
import { selectStretchSet } from './stretch-zone.js';
import { submissionToEvidence } from './submission.js';

describe('hint ladder state machine (Math Core §17)', () => {
  const q = examplesForSkill('M4.FRAC.COMMON_DENOM')[0]!;

  it('opens the orientation rung on the first unaided wrong attempt', () => {
    const s = advanceHintLadder(initHintLadder(q.id), { type: 'attempt_wrong' });
    expect(s.rung).toBe('orientation');
    expect(s.dependency).toBeGreaterThan(0);
    expect(s.dependency).toBeLessThan(0.5);
  });

  it('escalates rung by rung and only reveals the full solution last', () => {
    let s = initHintLadder(q.id);
    for (let i = 0; i < 6; i++) s = advanceHintLadder(s, { type: 'request_hint' });
    expect(s.rung).toBe('full_solution');
    expect(s.dependency).toBe(1); // needing the full solution = full dependency
    expect(currentHintText(s, q.hints, q.workedSolution)).toBe(q.workedSolution);
  });

  it('resolves on a correct attempt and stops changing', () => {
    let s = advanceHintLadder(initHintLadder(q.id), { type: 'request_hint' });
    s = advanceHintLadder(s, { type: 'attempt_correct' });
    expect(s.resolved).toBe(true);
    const after = advanceHintLadder(s, { type: 'request_hint' });
    expect(after).toEqual(s);
  });
});

describe('stretch-zone selection (Math Core §17)', () => {
  it('mixes mostly-solvable items with a minority of stretch items', () => {
    const twin = {
      skillMastery: new Map([
        [asSkillId('M4.FRAC.COMMON_DENOM'), { mastery: 80, confidence: 0.6, evidenceCount: 5, lastObservedAt: null, retention: 0.8, recentErrorStreak: 0, lastVerifiedAt: null }],
        [asSkillId('M4.ARITH.DISTRIBUTIVE'), { mastery: 30, confidence: 0.4, evidenceCount: 3, lastObservedAt: null, retention: 0.4, recentErrorStreak: 1, lastVerifiedAt: null }],
      ]),
      problemTypeMastery: new Map(),
      thinkingProfile: new Map(),
      frontier: [],
      childId: asChildId('c'),
      computedAt: '',
      computedFromEvidenceCount: 0,
    } as unknown as ChildLearningTwin;

    const pool = loadReferenceLibrary();
    const set = selectStretchSet(twin, pool, 4);
    expect(set).toHaveLength(4);
    // at least one comfortable (common denom, mastery 80) and one stretch (distributive, mastery 30)
    expect(set.some((q) => q.skillId === 'M4.FRAC.COMMON_DENOM')).toBe(true);
  });

  it('ramps low → high: every zone is sorted ascending, and comfortable (easier on average) comes before stretch', () => {
    const twin = {
      skillMastery: new Map([[asSkillId('M4.FRAC.COMMON_DENOM'), { mastery: 60, confidence: 0.5, evidenceCount: 4, lastObservedAt: null, retention: 0.6, recentErrorStreak: 0, lastVerifiedAt: null }]]),
      problemTypeMastery: new Map(),
      thinkingProfile: new Map(),
      frontier: [],
      childId: asChildId('c'),
      computedAt: '',
      computedFromEvidenceCount: 0,
    } as unknown as ChildLearningTwin;

    // shuffled input order on purpose — output order must come from the sort, not input order
    const pool: Question[] = [
      mkQuestion('q-k4', 'K4'),
      mkQuestion('q-k1', 'K1'),
      mkQuestion('q-k5', 'K5'),
      mkQuestion('q-k0', 'K0'),
      mkQuestion('q-k3', 'K3'),
      mkQuestion('q-k2', 'K2'),
    ];
    const set = selectStretchSet(twin, pool, 6);
    expect(set).toHaveLength(6);
    const ranks = set.map((q) => KNOWLEDGE_LEVELS.indexOf(q.knowledgeLevel));
    for (let i = 1; i < ranks.length; i += 1) expect(ranks[i]).toBeGreaterThanOrEqual(ranks[i - 1]!);
  });
});

describe('assignment item count scales with the minutes the action was actually given (was a flat 4/1)', () => {
  const pool: Question[] = Array.from({ length: 8 }, (_, i) => mkQuestion(`q-${i}`, KNOWLEDGE_LEVELS[Math.min(i, 5)]!));
  const twin = {
    skillMastery: new Map([[asSkillId('M4.FRAC.COMMON_DENOM'), { mastery: 50, confidence: 0.5, evidenceCount: 4, lastObservedAt: null, retention: 0.6, recentErrorStreak: 0, lastVerifiedAt: null }]]),
    problemTypeMastery: new Map(),
    thinkingProfile: new Map(),
    frontier: [],
    childId: asChildId('c'),
    computedAt: '',
    computedFromEvidenceCount: 0,
  } as unknown as ChildLearningTwin;

  function mkAction(overrides: Partial<PlannedAction>): PlannedAction {
    return {
      kind: 'practice_current_skill',
      mixBucket: 'school',
      targetSkillId: asSkillId('M4.FRAC.COMMON_DENOM'),
      estimatedMinutes: 10,
      roiPerMinute: 0.5,
      parentFacingTitle: 'Bài trên lớp',
      childFacingTitle: 'Bài trên lớp',
      rationale: 'test',
      ...overrides,
    };
  }

  it('a 10-minute action gets more items than a 4-minute action', () => {
    const short = buildAssignment({ childId: asChildId('c'), action: mkAction({ kind: 'retention_check', estimatedMinutes: 4 }), twin, planDate: '2026-09-15', at: '2026-09-15T00:00:00Z', newId: () => '1', pool });
    const long = buildAssignment({ childId: asChildId('c'), action: mkAction({ estimatedMinutes: 10 }), twin, planDate: '2026-09-15', at: '2026-09-15T00:00:00Z', newId: () => '1', pool });
    expect(short!.questionIds.length).toBeGreaterThanOrEqual(2);
    expect(long!.questionIds.length).toBeGreaterThan(short!.questionIds.length);
  });

  it('thinking_challenge is always exactly 1 substantial problem, regardless of estimatedMinutes', () => {
    const a = buildAssignment({ childId: asChildId('c'), action: mkAction({ kind: 'thinking_challenge', estimatedMinutes: 6 }), twin, planDate: '2026-09-15', at: '2026-09-15T00:00:00Z', newId: () => '1', pool });
    expect(a!.questionIds).toHaveLength(1);
  });

  it('an explicit itemsPerSession still overrides the derived count', () => {
    const a = buildAssignment({ childId: asChildId('c'), action: mkAction({ estimatedMinutes: 10 }), twin, planDate: '2026-09-15', at: '2026-09-15T00:00:00Z', newId: () => '1', pool, itemsPerSession: 3 });
    expect(a!.questionIds).toHaveLength(3);
  });
});

function mkQuestion(id: string, knowledgeLevel: (typeof KNOWLEDGE_LEVELS)[number]): Question {
  return {
    id,
    skillId: asSkillId('M4.FRAC.COMMON_DENOM'),
    knowledgeLevel,
    thinkingLevel: 'T2',
    prompt: `prompt ${id}`,
    answerSpec: { kind: 'numeric', value: 1, tolerance: 0 },
    hints: ['a', 'b', 'c', 'd', 'e', 'f'],
    workedSolution: 'solution',
    origin: 'authored',
  };
}

describe('submission → evidence (loop close, Math Core §29)', () => {
  const q = examplesForSkill('M4.FRAC.COMMON_DENOM')[0]!;
  const baseSubmission: Submission = {
    id: 'sub_1',
    assignmentId: 'asg_1',
    questionId: q.id,
    childId: asChildId('child_1'),
    childAnswer: '8/12 và 9/12',
    correct: true,
    score: 1,
    hintsUsed: 0,
    maxHints: 6,
    timeSpentSeconds: 90,
    submittedAt: '2026-08-31T08:00:00Z',
  };

  it('a heavily-hinted correct answer records high hint dependency', () => {
    const evidence = submissionToEvidence({
      submission: { ...baseSubmission, hintsUsed: 5 },
      question: q,
      at: '2026-08-31T08:01:00Z',
      newId: () => 'x',
    });
    expect(evidence.source).toBe('app_practice');
    expect(evidence.confidenceTier).toBe('B');
    expect(evidence.hintDependency).toBeCloseTo(5 / 6, 2);
    expect(evidence.skillId).toBe('M4.FRAC.COMMON_DENOM');
  });

  it('grades a reasoning question on the explanation, not a single answer', () => {
    const challenge = examplesForSkill('M4.ARITH.DISTRIBUTIVE').find((x) => x.answerSpec.kind === 'reasoning')!;
    const strong = submissionToEvidence({
      submission: { ...baseSubmission, questionId: challenge.id, correct: false, score: undefined, reasoningText: 'x'.repeat(80) },
      question: challenge,
      at: '2026-08-31T08:02:00Z',
      newId: () => 'y',
    });
    expect(strong.reasoningQuality).toBe('strong');
    expect(strong.result.correct).toBe(true);
    expect(strong.result.score).toBe(1);
  });
});
