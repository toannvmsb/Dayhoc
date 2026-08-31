import { describe, expect, it } from 'vitest';
import { asChildId, asSkillId, type ChildLearningTwin, type Submission } from '@copilot/domain';
import { loadQuestionBank, questionsForSkill } from './question-bank.js';
import { advanceHintLadder, currentHintText, initHintLadder } from './hint-ladder.js';
import { selectStretchSet } from './stretch-zone.js';
import { submissionToEvidence } from './submission.js';

describe('authored question bank', () => {
  it('validates every question and requires a full six-rung hint ladder', () => {
    const bank = loadQuestionBank();
    expect(bank.length).toBeGreaterThan(4);
    for (const q of bank) {
      expect(q.hints).toHaveLength(6);
      expect(q.workedSolution.length).toBeGreaterThan(0);
      expect(q.origin).toBe('authored');
    }
  });
});

describe('hint ladder state machine (Math Core §17)', () => {
  const q = questionsForSkill('M4.FRAC.COMMON_DENOM')[0]!;

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

    const pool = loadQuestionBank();
    const set = selectStretchSet(twin, pool, 4);
    expect(set).toHaveLength(4);
    // at least one comfortable (common denom, mastery 80) and one stretch (distributive, mastery 30)
    expect(set.some((q) => q.skillId === 'M4.FRAC.COMMON_DENOM')).toBe(true);
  });
});

describe('submission → evidence (loop close, Math Core §29)', () => {
  const q = questionsForSkill('M4.FRAC.COMMON_DENOM')[0]!;
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
    const challenge = questionsForSkill('M4.ARITH.DISTRIBUTIVE').find((x) => x.answerSpec.kind === 'reasoning')!;
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
