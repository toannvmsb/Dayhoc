import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { createProductionApi } from './production-api.js';

/**
 * Backlog B1-04 — "bài ôn thi tháng/học kỳ" built from the reference library, free (no AI).
 * createPracticeAssignment({ examId }) → ONE REVISION assignment covering the exam's confirmed scope.
 * Real PostgreSQL.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('exam practice from the library (B1-04)', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-03-01T03:00:00.000Z');
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];
  const prevSource = process.env.PRACTICE_SOURCE;
  const prevMode = process.env.AI_GENERATION_MODE;

  async function reg(email: string) {
    const me = await api.register({ email, password: 'supersecret', intendedRole: 'PARENT', displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  async function setup(tag: string) {
    const parent = await reg(`ep-${tag}-${Date.now()}@x.com`);
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
    process.env.AI_GENERATION_MODE = 'OFF';
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`ep${Date.now()}`), now });
  }, 20_000);

  afterAll(async () => {
    if (prevSource === undefined) delete process.env.PRACTICE_SOURCE;
    else process.env.PRACTICE_SOURCE = prevSource;
    if (prevMode === undefined) delete process.env.AI_GENERATION_MODE;
    else process.env.AI_GENERATION_MODE = prevMode;
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      for (const t of [
        'exam_results', 'exams', 'attempt_answers', 'attempts', 'assignment_items', 'assignments',
        'plan_items', 'learning_plans', 'knowledge_gaps', 'skill_states', 'learning_state_snapshots', 'evidence',
      ]) {
        await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      }
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]);
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  }, 20_000);

  const scopeSkills = (() => {
    const ids = [...new Set(loadReferenceLibrary().filter((q) => q.skillId.startsWith('M4.')).map((q) => String(q.skillId)))];
    return ids.slice(0, 4);
  })();

  it('builds one REVISION assignment inside the confirmed scope, no duplicates, easy→hard', async () => {
    const { auth, childId } = await setup('scope');
    const exam = await api.createExam(auth, childId, { examDate: '2027-03-12', subject: 'Toán', notes: 'giữa kỳ' });
    await api.confirmExamScope(auth, childId, exam.examId, scopeSkills);

    const before = await pool.query(`SELECT count(*)::int n FROM worksheet_jobs`).then((r) => r.rows[0].n as number).catch(() => 0);
    const res = await api.createPracticeAssignment(auth, childId, { examId: exam.examId, minutes: 30 });
    expect(res.planKind).toBe('exam');
    expect(res.assignmentIds).toHaveLength(1);
    expect(res.pickedItems).toBeGreaterThanOrEqual(scopeSkills.length);

    const rows = (
      await pool.query<{ question_ref: string; skill_id: string; knowledge_level: number }>(
        `SELECT question_ref, skill_id, knowledge_level FROM assignment_items WHERE assignment_id = $1 ORDER BY order_index`,
        [res.assignmentIds[0]],
      )
    ).rows;
    expect(rows.length).toBe(res.pickedItems);
    const refs = rows.map((r) => r.question_ref);
    expect(new Set(refs).size).toBe(refs.length); // no repeated question
    const skillsUsed = new Set(rows.map((r) => r.skill_id));
    for (const sk of skillsUsed) expect(scopeSkills).toContain(sk); // never outside the exam scope
    expect(skillsUsed.size).toBeGreaterThanOrEqual(2); // spread over the scope, not one skill
    const ks = rows.map((r) => r.knowledge_level);
    for (let i = 1; i < ks.length; i += 1) expect(ks[i]).toBeGreaterThanOrEqual(ks[i - 1]!);

    const list = await api.getChildAssignments(auth, childId);
    expect(list.find((a) => a.id === res.assignmentIds[0])?.mode).toBe('REVISION');

    // zero AI: nothing was queued
    const after = await pool.query(`SELECT count(*)::int n FROM worksheet_jobs`).then((r) => r.rows[0].n as number).catch(() => 0);
    expect(after).toBe(before);
  });

  it('a longer test has more questions than a shorter one for the same scope', async () => {
    const { auth, childId } = await setup('len');
    const exam = await api.createExam(auth, childId, { examDate: '2027-03-12', subject: 'Toán' });
    await api.confirmExamScope(auth, childId, exam.examId, scopeSkills);
    const short = await api.createPracticeAssignment(auth, childId, { examId: exam.examId, minutes: 15 });
    const long = await api.createPracticeAssignment(auth, childId, { examId: exam.examId, minutes: 45 });
    expect(long.pickedItems).toBeGreaterThan(short.pickedItems);
  });

  it("another family's parent cannot build practice from this child's exam", async () => {
    const a = await setup('ownerx');
    const b = await setup('other');
    const exam = await api.createExam(a.auth, a.childId, { examDate: '2027-03-12', subject: 'Toán' });
    await expect(api.createPracticeAssignment(b.auth, a.childId, { examId: exam.examId })).rejects.toThrow();
    // and an exam id from another child never resolves
    await expect(api.createPracticeAssignment(b.auth, b.childId, { examId: exam.examId })).rejects.toThrow();
  });
});
