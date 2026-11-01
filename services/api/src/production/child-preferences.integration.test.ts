import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * Backlog B2-02 / B2-03 — the parent picks a learning goal and daily study minutes
 * (spec §1 "quản lý mục tiêu học"). Stored in child_profiles.goals / available_time_profile
 * (no migration). The free daily library worksheet must honour the minutes. Real PostgreSQL, no AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('child preferences: learning goal + daily minutes', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-03-10T03:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];
  const prevSource = process.env.PRACTICE_SOURCE;

  async function reg(email: string, role: 'PARENT' | 'STUDENT') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  async function newChild(tag: string) {
    const parent = await reg(`cp-${tag}-${Date.now()}@x.com`, 'PARENT');
    const auth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(auth, { displayName: `Bé ${tag}`, schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    return { auth, childId: child.childId };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    process.env.PRACTICE_SOURCE = 'LIBRARY_FIRST';
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`cp${Date.now()}`), now });
  }, 20_000);

  afterAll(async () => {
    if (prevSource === undefined) delete process.env.PRACTICE_SOURCE;
    else process.env.PRACTICE_SOURCE = prevSource;
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of [
        'attempt_answers', 'attempts', 'assignment_items', 'assignments', 'plan_items', 'learning_plans',
        'knowledge_gaps', 'skill_states', 'learning_state_snapshots', 'evidence', 'child_profiles',
      ]) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 20_000);

  it('defaults: KEEP_PACE, 20 minutes, no exam prep', async () => {
    const { auth, childId } = await newChild('def');
    const p = await api.getChildPreferences(auth, childId);
    expect(p.goal).toBe('KEEP_PACE');
    expect(p.dailyMinutes).toBe(20);
    expect(p.examPrep).toBe(false);
    expect(p.goalOptions.map((g) => g.code)).toEqual(['KEEP_PACE', 'CATCH_UP', 'ADVANCED']);
  });

  it('round-trips goal, exam-prep flag and minutes', async () => {
    const { auth, childId } = await newChild('rt');
    await api.setChildPreferences(auth, childId, { dailyMinutes: 30, goal: 'ADVANCED', examPrep: true });
    const p = await api.getChildPreferences(auth, childId);
    expect(p).toMatchObject({ goal: 'ADVANCED', dailyMinutes: 30, examPrep: true });
  });

  it('rejects an unknown goal, EXAM_PREP as the main goal, and off-menu minutes', async () => {
    const { auth, childId } = await newChild('bad');
    await expect(api.setChildPreferences(auth, childId, { dailyMinutes: 20, goal: 'WIN_EVERYTHING' })).rejects.toThrow();
    await expect(api.setChildPreferences(auth, childId, { dailyMinutes: 20, goal: 'EXAM_PREP' })).rejects.toThrow();
    await expect(api.setChildPreferences(auth, childId, { dailyMinutes: 7, goal: 'KEEP_PACE' })).rejects.toThrow();
  });

  it('a parent cannot read or change another family\'s child', async () => {
    const a = await newChild('own');
    const b = await newChild('other');
    await expect(api.getChildPreferences(b.auth, a.childId)).rejects.toThrow();
    await expect(api.setChildPreferences(b.auth, a.childId, { dailyMinutes: 10, goal: 'CATCH_UP' })).rejects.toThrow();
  });

  it('the free daily worksheet sizes itself to the chosen minutes (15 min < 45 min)', async () => {
    const small = await newChild('min15');
    const big = await newChild('min45');
    await api.setChildPreferences(small.auth, small.childId, { dailyMinutes: 15, goal: 'KEEP_PACE' });
    await api.setChildPreferences(big.auth, big.childId, { dailyMinutes: 45, goal: 'KEEP_PACE' });

    const count = async (childId: string) =>
      Number(
        (await pool.query<{ n: string }>(
          `SELECT count(*) n FROM assignment_items ai JOIN assignments a ON a.id = ai.assignment_id WHERE a.child_id = $1`,
          [childId],
        )).rows[0]!.n,
      );

    await api.getParentHome(small.auth, small.childId);
    await api.getParentHome(big.auth, big.childId);
    const nSmall = await count(small.childId);
    const nBig = await count(big.childId);
    expect(nSmall).toBeGreaterThan(0);
    expect(nBig).toBeGreaterThan(nSmall);
  });
});
