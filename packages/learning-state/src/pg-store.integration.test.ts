import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotHash } from './store.js';

/**
 * Integration test — DB migrated through `*_learning_state_persistence`. Proves
 * `PgLearningStateStore` round-trips through the real schema, derived rows are
 * replace-on-recompute, and `attempts` / `attempt_answers` reject DELETE
 * (append-only trigger).
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('PgLearningStateStore (integration)', () => {
  let pool: import('pg').Pool;
  let Store: typeof import('./pg-store.js').PgLearningStateStore;
  let childId: string;
  let userId: string;
  let familyId: string;

  beforeAll(async () => {
    const { Pool } = await import('pg');
    ({ PgLearningStateStore: Store } = await import('./pg-store.js'));
    pool = new Pool({ connectionString: DATABASE_URL });
    const u = await pool.query<{ id: string }>(`INSERT INTO users(role) VALUES ('parent') RETURNING id`);
    userId = u.rows[0]!.id;
    const f = await pool.query<{ id: string }>(`INSERT INTO families(owner_parent_id) VALUES ($1) RETURNING id`, [userId]);
    familyId = f.rows[0]!.id;
    const c = await pool.query<{ id: string }>(
      `INSERT INTO child_profiles(family_id, display_name, school_grade) VALUES ($1,'IX Child',4) RETURNING id`,
      [familyId],
    );
    childId = c.rows[0]!.id;
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM child_profiles WHERE id = $1`, [childId]);
      await c.query(`DELETE FROM families WHERE id = $1`, [familyId]);
      await c.query(`DELETE FROM users WHERE id = $1`, [userId]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it('snapshot + skill states + gaps + plan round-trip and replace on recompute', async () => {
    const store = new Store(pool);
    const state = { skills: { 'M4.FRAC': 62 } };
    await store.putSnapshot({
      childId,
      kind: 'TWIN',
      state,
      stateVersion: 'twin.v1',
      evidenceCount: 5,
      contentHash: snapshotHash(state),
      provenance: { source: 'recompute' },
      computedAt: new Date().toISOString(),
    });
    // recompute → upsert
    await store.putSnapshot({
      childId,
      kind: 'TWIN',
      state: { skills: { 'M4.FRAC': 70 } },
      stateVersion: 'twin.v1',
      evidenceCount: 8,
      contentHash: 'h2',
      provenance: {},
      computedAt: new Date().toISOString(),
    });
    const snap = await store.getSnapshot(childId, 'TWIN');
    expect(snap?.evidenceCount).toBe(8);

    await store.replaceSkillStates(childId, [
      {
        childId,
        skillId: 'M4.FRAC.COMMON_DENOM',
        mastery: 55,
        confidence: 0.6,
        retention: 0.7,
        evidenceCount: 3,
        lastObservedAt: null,
        lastVerifiedAt: null,
        computedFromEvidenceCount: 3,
        computedAt: new Date().toISOString(),
      },
    ]);
    await store.replaceSkillStates(childId, [
      {
        childId,
        skillId: 'M4.FRAC.COMMON_DENOM',
        mastery: 68,
        confidence: 0.7,
        retention: 0.75,
        evidenceCount: 5,
        lastObservedAt: null,
        lastVerifiedAt: null,
        computedFromEvidenceCount: 5,
        computedAt: new Date().toISOString(),
      },
    ]);
    const skills = await store.listSkillStates(childId);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.mastery).toBe(68);

    await store.replaceGaps(childId, [
      {
        id: crypto.randomUUID(),
        childId,
        gapType: 'prerequisite_gap',
        targetSkillId: 'M4.FRAC.COMMON_DENOM',
        rootSkillId: 'M4.MULT.TABLE',
        severity: 0.6,
        priority: 14.2,
        lifecycleState: 'DETECTED',
        blocksCurrentLearning: true,
        blocksAdvancedLearning: false,
        rationale: 'nhầm mẫu chung',
        evidenceRefs: ['e1'],
        detectedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        computedFromEvidenceCount: 5,
      },
    ]);
    expect((await store.listGaps(childId))[0]!.rootSkillId).toBe('M4.MULT.TABLE');

    await store.savePlan({
      id: crypto.randomUUID(),
      childId,
      planDate: '2027-01-12',
      availableMinutes: 20,
      kind: 'plan',
      mix: { school: 12, gapRepair: 8 },
      plannerVersion: 'v1',
      createdAt: new Date().toISOString(),
      items: [{ orderIndex: 0, actionKind: 'gapRepair', skillId: 'M4.FRAC.COMMON_DENOM', minutes: 8, payload: {} }],
    });
    expect((await store.getPlan(childId, '2027-01-12'))?.items).toHaveLength(1);
  });

  it('assignment → attempt → answers; DELETE on attempts/attempt_answers is rejected', async () => {
    const store = new Store(pool);
    const asg = await store.createAssignment({
      childId,
      source: 'LEGACY_PRACTICE',
      assignedByUserId: userId,
      assignedByRole: 'PARENT',
      targetSkillIds: ['M4.FRAC.COMMON_DENOM'],
      items: [
        {
          orderIndex: 0,
          questionRef: 'Q1',
          skillId: 'M4.FRAC.COMMON_DENOM',
          problemTypeId: null,
          knowledgeLevel: 3,
          thinkingLevel: 2,
          prompt: { text: 'Quy đồng 1/2, 1/3' },
          answerSpec: { kind: 'fraction' },
          hints: ['gợi ý 1'],
        },
      ],
    });
    const full = await store.getAssignment(asg.id);
    const item = full!.items[0]!.id;
    const att = await store.startAttempt({ assignmentId: asg.id, childId });
    await store.submitAttempt(att.id, [
      {
        assignmentItemId: item,
        childAnswer: { value: '5/6' },
        hintsUsed: 0,
        verificationLevel: 'DETERMINISTIC_CORRECTNESS_VERIFIED',
        correct: true,
      },
    ]);
    expect((await store.listAttemptAnswers(att.id))[0]!.correct).toBe(true);

    await expect(pool.query(`DELETE FROM attempt_answers WHERE attempt_id = $1`, [att.id])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM attempts WHERE id = $1`, [att.id])).rejects.toThrow(/append-only/);

    // invalidateDerived wipes derived rows, keeps the assignment/attempt
    await store.invalidateDerived(childId);
    expect(await store.listSkillStates(childId)).toHaveLength(0);
    expect((await store.getAssignment(asg.id))?.assignment.id).toBe(asg.id);
    expect(await store.listAttempts(childId)).toHaveLength(1);
  });
});
