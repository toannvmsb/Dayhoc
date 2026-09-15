import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * "Giao con luyện tập phần này ngay" (doc — audit against anh's core-loop
 * spec §4: "những ngày sau cha mẹ có thể yêu cầu ôn tập ... phần đang yếu").
 * createPracticeAssignment({gapId}) must build ONE assignment scoped to that
 * gap's own skill, bypassing the whole-day mix — against PostgreSQL, no paid
 * AI (legacy reference-library path).
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('targeted practice request (Gap Detail → "ôn ngay")', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-01-20T00:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];

  async function reg(email: string, role: 'PARENT' | 'STUDENT') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`tp${Date.now()}`), now });
  }, 20_000);

  afterAll(async () => {
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

  it('createPracticeAssignment({gapId}) builds one assignment scoped to that gap\'s skill', async () => {
    const stamp = Date.now();
    const parent = await reg(`tp-p-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Weak Spot', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    // force a detected gap on a real, content-backed skill (repeated wrong
    // answers, confidence A — matches the pattern doc history uses elsewhere).
    for (let i = 0; i < 4; i += 1) {
      await pool.query(
        `INSERT INTO evidence (id, child_id, source, occurred_at, recorded_at, skill_id, result, confidence_tier, provenance)
         VALUES (gen_random_uuid(), $1, 'app_practice', $2, $2, 'M4.ARITH.DISTRIBUTIVE', '{"correct":false}'::jsonb, 'A', 'manual')`,
        [child.childId, new Date(2027, 0, 10 + i).toISOString()],
      );
    }

    const home = await api.getParentHome(pAuth, child.childId);
    const gap = home.attention.find((a) => a.kind === 'gap');
    expect(gap, 'a gap should be detected for the child').toBeTruthy();

    const before = await api.getChildAssignments(pAuth, child.childId);

    const res = await api.createPracticeAssignment(pAuth, child.childId, { gapId: gap!.gapId });
    expect(res.planKind).toBe('targeted');
    expect(res.assignmentIds.length).toBe(1);

    const after = await api.getChildAssignments(pAuth, child.childId);
    expect(after.length).toBe(before.length + 1); // exactly one new assignment, not a whole-day plan's worth

    const detail = await api.getAssignmentDetail(pAuth, res.assignmentIds[0]!);
    expect(detail.items.length).toBeGreaterThanOrEqual(2); // buildAssignment's floor for a non-thinking action
    const created = after.find((a) => a.id === res.assignmentIds[0]);
    expect(created?.targetSkillIds).toEqual(['M4.ARITH.DISTRIBUTIVE']); // scoped to the gap's skill, not the whole plan
    expect(created?.mode).toBe('GAP_REPAIR');
  }, 20_000);

  it('an unknown gapId / skillId is refused, not silently ignored into a whole-day plan', async () => {
    const stamp = Date.now();
    const parent = await reg(`tp-p2-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: 'Bé Bogus Gap', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    // an unrecognised gapId falls through to `requestedSkillId` undefined →
    // the normal whole-day-plan path, NOT an error and NOT a targeted
    // assignment — assert it does NOT silently produce a bogus "targeted" result.
    const res = await api.createPracticeAssignment(pAuth, child.childId, { gapId: 'does-not-exist' });
    expect(res.planKind).not.toBe('targeted');
  }, 20_000);
});
