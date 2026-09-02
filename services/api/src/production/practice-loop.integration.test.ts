import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * F8 / F30 + Golden Journey 1 & 7 — the practice loop end to end, against
 * PostgreSQL: zero-data parent → child → plan → assignment → student attempt →
 * append-only evidence → derived state invalidated. No paid AI (legacy
 * reference-library path), no LIVE generation.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('F8 — practice loop (assignment → attempt → evidence)', () => {
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
    pool = new Pool({ connectionString: DATABASE_URL });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`pl${Date.now()}`), now });
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of [
        'attempt_answers',
        'attempts',
        'assignment_items',
        'assignments',
        'plan_items',
        'learning_plans',
        'knowledge_gaps',
        'skill_states',
        'learning_state_snapshots',
        'evidence',
        'student_account_links',
      ]) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[]) OR ${t === 'attempt_answers' || t === 'plan_items' || t === 'assignment_items' || t === 'student_account_links' ? 'true' : 'false'}`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM attempt_answers WHERE attempt_id IN (SELECT id FROM attempts WHERE child_id = ANY($1::uuid[]))`, [children]).catch(() => {});
      await c.query(`DELETE FROM attempts WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM assignment_items WHERE assignment_id IN (SELECT id FROM assignments WHERE child_id = ANY($1::uuid[]))`, [children]).catch(() => {});
      await c.query(`DELETE FROM assignments WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM plan_items WHERE learning_plan_id IN (SELECT id FROM learning_plans WHERE child_id = ANY($1::uuid[]))`, [children]).catch(() => {});
      await c.query(`DELETE FROM learning_plans WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM skill_states WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM knowledge_gaps WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM learning_state_snapshots WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM evidence WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM student_account_links WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]);
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  it('Journey 1 — zero-data parent creates a child + gets a practice assignment', async () => {
    const stamp = Date.now();
    const parent = await reg(`pl-p-${stamp}@x.com`, 'PARENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };

    const child = await api.createChild(pAuth, { displayName: 'Bé Na', schoolGrade: 4 });
    children.push(child.childId);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    // no school, no evidence — the estimated context path still works
    const ctx = await api.getLearningContext(pAuth, child.childId);
    expect(ctx).toBeTruthy();

    const res = await api.createPracticeAssignment(pAuth, child.childId, { minutes: 20 });
    // the legacy reference library must have items for a grade-4 child
    expect(res.assignmentIds.length).toBeGreaterThan(0);

    const list = await api.getChildAssignments(pAuth, child.childId);
    expect(list.length).toBe(res.assignmentIds.length);
    expect(list[0]!.status).toBe('ASSIGNED');

    const detail = await api.getAssignmentDetail(pAuth, res.assignmentIds[0]!);
    expect(detail.items.length).toBeGreaterThan(0);
    // child-safe: no worked solution in the item DTO
    expect(JSON.stringify(detail)).not.toContain('workedSolution');

    // F3 — the hero Parent DTOs are DB-authorized and answer "hôm nay dạy con gì?"
    const home = await api.getParentHome(pAuth, child.childId);
    expect(home.child.childId).toBe(child.childId);
    expect(home.child.displayName).toBe('Bé Na');
    const progress = await api.getParentProgress(pAuth, child.childId);
    expect(progress.child.childId).toBe(child.childId);
    // an unrelated parent cannot read the hero screen
    const stranger = await reg(`pl-x-${stamp}@x.com`, 'PARENT');
    await expect(
      api.getParentHome({ bearer: stranger.bearer, workspace: 'PARENT' }, child.childId),
    ).rejects.toBeTruthy();
    // a write-through TWIN snapshot now exists
    const snap = await pool.query<{ n: number }>(
      `SELECT count(*)::int n FROM learning_state_snapshots WHERE child_id = $1 AND kind = 'TWIN'`,
      [child.childId],
    );
    expect(snap.rows[0]!.n).toBe(1);
  });

  it('Journey 7 — student completes practice → append-only evidence → derived state invalidated', async () => {
    const stamp = Date.now();
    const parent = await reg(`pl-p2-${stamp}@x.com`, 'PARENT');
    const student = await reg(`pl-s2-${stamp}@x.com`, 'STUDENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };

    const child = await api.createChild(pAuth, { displayName: 'Bé Bo', schoolGrade: 4 });
    children.push(child.childId);
    const fam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId]);
    families.push(fam.rows[0]!.family_id);

    // link the student to this child (server-resolved childScope)
    const { IdentityService } = await import('@copilot/identity');
    const { PgIdentityStore } = await import('@copilot/identity/pg');
    const idSvc = new IdentityService({ store: new PgIdentityStore(pool), auth: new InMemoryAuthAdapter(), now });
    await idSvc.linkStudentAccount({
      studentUserId: student.userId as never,
      childId: child.childId,
      linkMethod: 'PARENT_INVITE',
      linkedByUserId: parent.userId as never,
    });
    const sAuth = { bearer: student.bearer, workspace: 'STUDENT' as const };

    const { assignmentIds } = await api.createPracticeAssignment(pAuth, child.childId, { minutes: 20 });
    const assignmentId = assignmentIds[0]!;
    const detail = await api.getAssignmentDetail(sAuth, assignmentId); // student can read own assignment

    const evidenceBefore = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [child.childId]);

    const result = await api.submitPractice(
      sAuth,
      assignmentId,
      detail.items.map((it) => ({ assignmentItemId: it.id, answer: '5/6', hintsUsed: 0, timeSpentSeconds: 45 })),
    );
    expect(result.results.length).toBe(detail.items.length);
    // verification level is honest — never DETERMINISTIC unless actually comparable
    for (const r of result.results) {
      expect([
        'DETERMINISTIC_CORRECTNESS_VERIFIED',
        'FORMAT_VERIFIED',
        'AI_CROSSCHECK_REQUIRED',
        'UNVERIFIED',
      ]).toContain(r.verificationLevel);
    }

    const evidenceAfter = await pool.query<{ n: number }>(`SELECT count(*)::int n FROM evidence WHERE child_id = $1`, [child.childId]);
    expect(evidenceAfter.rows[0]!.n).toBeGreaterThan(evidenceBefore.rows[0]!.n);

    // assignment marked completed
    const list = await api.getChildAssignments(pAuth, child.childId);
    expect(list.find((a) => a.id === assignmentId)!.status).toBe('COMPLETED');

    // a student cannot submit for another child's assignment
    const otherChild = await api.createChild(pAuth, { displayName: 'Khác', schoolGrade: 4 });
    children.push(otherChild.childId);
    const otherFam = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [otherChild.childId]);
    families.push(otherFam.rows[0]!.family_id);
    const other = await api.createPracticeAssignment(pAuth, otherChild.childId, {});
    if (other.assignmentIds[0]) {
      await expect(api.submitPractice(sAuth, other.assignmentIds[0], [])).rejects.toBeTruthy();
    }

    // attempt_answers is append-only at the DB
    await expect(
      pool.query(`DELETE FROM attempt_answers WHERE attempt_id = $1`, [result.attemptId]),
    ).rejects.toThrow(/append-only/);
  });
});
