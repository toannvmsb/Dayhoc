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

  it('links the assignment to its exam and lists it on the revision map', async () => {
    const { auth, childId } = await setup('link');
    const exam = await api.createExam(auth, childId, { examDate: '2027-03-12', subject: 'Toán' });
    await api.confirmExamScope(auth, childId, exam.examId, scopeSkills);
    expect((await api.getRevisionMap(auth, childId, exam.examId)).practice).toEqual([]);

    const res = await api.createPracticeAssignment(auth, childId, { examId: exam.examId, minutes: 30 });
    const row = await pool.query(`SELECT exam_id FROM assignments WHERE id = $1`, [res.assignmentIds[0]]);
    expect(row.rows[0].exam_id).toBe(exam.examId);

    const map = await api.getRevisionMap(auth, childId, exam.examId);
    expect(map.practice).toHaveLength(1);
    expect(map.practice[0]).toMatchObject({ assignmentId: res.assignmentIds[0], status: 'ASSIGNED', items: res.pickedItems });

    const list = await api.getChildAssignments(auth, childId);
    expect(list.find((a) => a.id === res.assignmentIds[0])).toMatchObject({ examId: exam.examId });

    // ordinary practice is NOT linked to any exam
    const plain = await api.createPracticeAssignment(auth, childId, { minutes: 20 });
    const plainRow = await pool.query(`SELECT exam_id FROM assignments WHERE id = $1`, [plain.assignmentIds[0]]);
    expect(plainRow.rows[0].exam_id).toBeNull();
  });

  it("deleting the exam keeps the child's practice (exam_id → NULL)", async () => {
    const { auth, childId } = await setup('del');
    const exam = await api.createExam(auth, childId, { examDate: '2027-03-12', subject: 'Toán' });
    await api.confirmExamScope(auth, childId, exam.examId, scopeSkills);
    const res = await api.createPracticeAssignment(auth, childId, { examId: exam.examId });
    await pool.query(`DELETE FROM exam_results WHERE exam_id = $1`, [exam.examId]);
    await pool.query(`DELETE FROM exams WHERE id = $1`, [exam.examId]);
    const row = await pool.query(`SELECT exam_id FROM assignments WHERE id = $1`, [res.assignmentIds[0]]);
    expect(row.rows).toHaveLength(1);
    expect(row.rows[0].exam_id).toBeNull();
  });

  it('selection log (B1-05): every served question records why, and only the parent can read it', async () => {
    const { auth, childId } = await setup('log');
    const exam = await api.createExam(auth, childId, { examDate: '2027-03-12', subject: 'Toán' });
    await api.confirmExamScope(auth, childId, exam.examId, scopeSkills);

    // exam practice
    const ex = await api.createPracticeAssignment(auth, childId, { examId: exam.examId, minutes: 30 });
    const exLog = await api.getAssignmentSelectionLog(auth, ex.assignmentIds[0]!);
    expect(exLog.examId).toBe(exam.examId);
    expect(exLog.items.length).toBe(ex.pickedItems);
    for (const it of exLog.items) expect(it.selectionReason).toMatch(/^EXAM_PREP:/);

    // free daily worksheet
    const daily = await api.createPracticeAssignment(auth, childId, { minutes: 20 });
    const dLog = await api.getAssignmentSelectionLog(auth, daily.assignmentIds[0]!);
    expect(dLog.items.length).toBeGreaterThan(0);
    for (const it of dLog.items) expect(it.selectionReason).toMatch(/^(PLAN:|LESSON_FALLBACK|DAILY_PLAN)/);

    // the log belongs to this family only
    const other = await setup('logother');
    await expect(api.getAssignmentSelectionLog(other.auth, daily.assignmentIds[0]!)).rejects.toThrow();
  });

  it('cooldown relaxation is logged: a pool that runs dry reports which cooldowns were relaxed', async () => {
    // needs a REAL clock: the serve history is read with the DB's now(), so a fake future clock
    // would make every earlier sheet look older than the cooldown window.
    const live = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`cd${Date.now()}`), now: () => new Date() });
    const me = await live.register({ email: `cd-${Date.now()}@x.com`, password: 'supersecret', intendedRole: 'PARENT', displayName: 'cd' });
    users.push(me.userId);
    const bearer = (await pool.query(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId])).rows[0].auth_user_id as string;
    const auth = { bearer, workspace: 'PARENT' as const };
    const child = await live.createChild(auth, { displayName: 'Bé cd', schoolGrade: 4 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);

    // serve the same single skill over and over: ~24 items/sheet from a ~100-question pool → must relax by sheet 5
    let relaxed = 0;
    for (let i = 0; i < 6; i += 1) {
      const r = await live.createPracticeAssignment(auth, child.childId, { skillId: scopeSkills[0]!, minutes: 60 });
      const log = await live.getAssignmentSelectionLog(auth, r.assignmentIds[0]!);
      relaxed += log.items.filter((it) => (it.cooldownOverrideReason ?? '').length > 0).length;
    }
    expect(relaxed).toBeGreaterThan(0);
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
