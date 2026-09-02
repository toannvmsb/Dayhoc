import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryLearningStateStore, snapshotHash } from './store.js';
import type { PersistedGapRow, SkillStateRow } from '@copilot/domain';

const CHILD_A = 'child-a';
const CHILD_B = 'child-b';

function skill(childId: string, skillId: string, mastery: number): SkillStateRow {
  return {
    childId,
    skillId,
    mastery,
    confidence: 0.6,
    retention: 0.7,
    evidenceCount: 3,
    lastObservedAt: '2027-01-10T00:00:00Z',
    lastVerifiedAt: null,
    computedFromEvidenceCount: 3,
    computedAt: '2027-01-11T00:00:00Z',
  };
}
function gap(childId: string, target: string): PersistedGapRow {
  return {
    id: `g-${target}`,
    childId,
    gapType: 'prerequisite_gap',
    targetSkillId: target,
    rootSkillId: null,
    severity: 0.6,
    priority: 12.5,
    lifecycleState: 'DETECTED',
    blocksCurrentLearning: true,
    blocksAdvancedLearning: false,
    rationale: 'nhầm khi quy đồng',
    evidenceRefs: ['ev1', 'ev2'],
    detectedAt: '2027-01-10T00:00:00Z',
    updatedAt: '2027-01-10T00:00:00Z',
    computedFromEvidenceCount: 3,
  };
}

describe('IX / F1 — learning-state store (in-memory)', () => {
  let store: InMemoryLearningStateStore;
  beforeEach(() => {
    store = new InMemoryLearningStateStore();
  });

  it('snapshotHash is deterministic + order-independent', () => {
    expect(snapshotHash({ a: 1, b: [2, 3] })).toBe(snapshotHash({ b: [2, 3], a: 1 }));
    expect(snapshotHash({ a: 1 })).not.toBe(snapshotHash({ a: 2 }));
  });

  it('a twin snapshot round-trips and carries staleness metadata', async () => {
    const state = { skills: { 'M4.FRAC': 62 } };
    await store.putSnapshot({
      childId: CHILD_A,
      kind: 'TWIN',
      state,
      stateVersion: 'twin.v1',
      evidenceCount: 7,
      contentHash: snapshotHash(state),
      provenance: { datasetRevision: 'math-dev-core-1.0' },
      computedAt: '2027-01-11T00:00:00Z',
    });
    const got = await store.getSnapshot(CHILD_A, 'TWIN');
    expect(got?.evidenceCount).toBe(7);
    expect(got?.contentHash).toBe(snapshotHash(state));
    expect(got?.state).toEqual(state);
    // a later evidence count → the caller knows the snapshot is stale
    expect(got!.evidenceCount).toBeLessThan(9);
  });

  it('derived rows replace (recompute-safe) and are scoped to child_id', async () => {
    await store.replaceSkillStates(CHILD_A, [skill(CHILD_A, 'M4.FRAC', 50), skill(CHILD_A, 'M4.ADD', 80)]);
    await store.replaceSkillStates(CHILD_B, [skill(CHILD_B, 'M7.RATIO', 40)]);
    // recompute for A → fewer rows
    await store.replaceSkillStates(CHILD_A, [skill(CHILD_A, 'M4.FRAC', 65)]);

    const a = await store.listSkillStates(CHILD_A);
    expect(a).toHaveLength(1);
    expect(a[0]!.mastery).toBe(65);
    // B untouched
    expect(await store.listSkillStates(CHILD_B)).toHaveLength(1);
  });

  it('gaps persist with lifecycle + provenance and replace on recompute', async () => {
    await store.replaceGaps(CHILD_A, [gap(CHILD_A, 'M4.FRAC.COMMON_DENOM'), gap(CHILD_A, 'M4.ALG.FIND_X')]);
    let gaps = await store.listGaps(CHILD_A);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]!.lifecycleState).toBe('DETECTED');
    expect(gaps[0]!.evidenceRefs).toEqual(['ev1', 'ev2']);
    // the FIND_X gap closes → recompute drops it
    await store.replaceGaps(CHILD_A, [gap(CHILD_A, 'M4.FRAC.COMMON_DENOM')]);
    gaps = await store.listGaps(CHILD_A);
    expect(gaps).toHaveLength(1);
  });

  it('a daily plan + items round-trip, one per (child, date)', async () => {
    await store.savePlan({
      id: 'p1',
      childId: CHILD_A,
      planDate: '2027-01-12',
      availableMinutes: 20,
      kind: 'plan',
      mix: { school: 10, gapRepair: 8, thinking: 2 },
      plannerVersion: 'exercise-spec.v1',
      createdAt: '2027-01-12T07:00:00Z',
      items: [
        { orderIndex: 0, actionKind: 'gapRepair', skillId: 'M4.FRAC.COMMON_DENOM', minutes: 8, payload: {} },
        { orderIndex: 1, actionKind: 'school', skillId: 'M4.FRAC.ADD', minutes: 10, payload: {} },
      ],
    });
    const p = await store.getPlan(CHILD_A, '2027-01-12');
    expect(p?.items).toHaveLength(2);
    expect(p?.mix.gapRepair).toBe(8);
    // re-save same date → replace
    await store.savePlan({ ...(p as never), availableMinutes: 30, items: [] } as never);
    expect((await store.getPlan(CHILD_A, '2027-01-12'))?.availableMinutes).toBe(30);
  });

  it('assignment + items + attempt + answers (genuine student work)', async () => {
    const asg = await store.createAssignment({
      childId: CHILD_A,
      source: 'LEGACY_PRACTICE',
      assignedByRole: 'PARENT',
      targetSkillIds: ['M4.FRAC.COMMON_DENOM'],
      items: [
        {
          orderIndex: 0,
          questionRef: 'Q.M4.FRAC.001',
          skillId: 'M4.FRAC.COMMON_DENOM',
          problemTypeId: null,
          knowledgeLevel: 3,
          thinkingLevel: 2,
          prompt: { text: 'Quy đồng 1/2 và 1/3' },
          answerSpec: { kind: 'fraction', value: '5/6' },
          hints: ['Tìm mẫu chung', 'Mẫu chung nhỏ nhất của 2 và 3'],
        },
      ],
    });
    expect(asg.status).toBe('ASSIGNED');
    const full = await store.getAssignment(asg.id);
    expect(full?.items).toHaveLength(1);
    const itemId = full!.items[0]!.id;

    const attempt = await store.startAttempt({ assignmentId: asg.id, childId: CHILD_A });
    const submitted = await store.submitAttempt(attempt.id, [
      {
        assignmentItemId: itemId,
        childAnswer: { value: '5/6' },
        hintsUsed: 1,
        reasoningText: 'mẫu chung là 6',
        timeSpentSeconds: 90,
        verificationLevel: 'DETERMINISTIC_CORRECTNESS_VERIFIED',
        correct: true,
        verifiedAt: '2027-01-12T07:10:00Z',
      },
    ]);
    expect(submitted.status).toBe('SUBMITTED');
    const answers = await store.listAttemptAnswers(attempt.id);
    expect(answers[0]!.verificationLevel).toBe('DETERMINISTIC_CORRECTNESS_VERIFIED');
    expect(answers[0]!.correct).toBe(true);

    // resubmitting a finalised attempt is refused (append-only semantics)
    await expect(store.submitAttempt(attempt.id, [])).rejects.toThrow();

    await store.updateAssignmentStatus(asg.id, 'COMPLETED');
    expect((await store.getAssignment(asg.id))?.assignment.completedAt).toBeTruthy();
  });

  it('a reasoning answer that is not deterministically verified stays UNVERIFIED / AI_CROSSCHECK_REQUIRED', async () => {
    const asg = await store.createAssignment({
      childId: CHILD_A,
      source: 'LEGACY_PRACTICE',
      targetSkillIds: ['M7.PROOF.ALGEBRA'],
      items: [
        {
          orderIndex: 0,
          questionRef: null,
          skillId: 'M7.PROOF.ALGEBRA',
          problemTypeId: null,
          knowledgeLevel: 3,
          thinkingLevel: 5,
          prompt: { text: 'Chứng minh ...' },
          answerSpec: { kind: 'reasoning' },
          hints: [],
        },
      ],
    });
    const item = (await store.getAssignment(asg.id))!.items[0]!.id;
    const att = await store.startAttempt({ assignmentId: asg.id, childId: CHILD_A });
    await store.submitAttempt(att.id, [
      {
        assignmentItemId: item,
        childAnswer: { text: 'Vì ...' },
        verificationLevel: 'AI_CROSSCHECK_REQUIRED',
        correct: null,
      },
    ]);
    const ans = await store.listAttemptAnswers(att.id);
    expect(ans[0]!.verificationLevel).toBe('AI_CROSSCHECK_REQUIRED');
    expect(ans[0]!.correct).toBeNull(); // never pretend correctness
  });

  it('invalidateDerived wipes only derived state, never student work, and is child-scoped', async () => {
    await store.replaceSkillStates(CHILD_A, [skill(CHILD_A, 'M4.FRAC', 50)]);
    await store.replaceGaps(CHILD_A, [gap(CHILD_A, 'M4.FRAC.COMMON_DENOM')]);
    await store.putSnapshot({
      childId: CHILD_A,
      kind: 'TWIN',
      state: {},
      stateVersion: 'v1',
      evidenceCount: 1,
      contentHash: 'x',
      provenance: {},
      computedAt: '2027-01-11T00:00:00Z',
    });
    const asg = await store.createAssignment({ childId: CHILD_A, source: 'LEGACY_PRACTICE', targetSkillIds: [], items: [] });
    await store.replaceSkillStates(CHILD_B, [skill(CHILD_B, 'M7.RATIO', 40)]);

    await store.invalidateDerived(CHILD_A);

    expect(await store.listSkillStates(CHILD_A)).toHaveLength(0);
    expect(await store.listGaps(CHILD_A)).toHaveLength(0);
    expect(await store.getSnapshot(CHILD_A, 'TWIN')).toBeNull();
    // student work survives
    expect(await store.getAssignment(asg.id)).not.toBeNull();
    // child B derived state untouched
    expect(await store.listSkillStates(CHILD_B)).toHaveLength(1);
  });
});
