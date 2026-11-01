import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IdentityService, InMemoryAuthAdapter } from '@copilot/identity';
import { PgIdentityStore } from '@copilot/identity/pg';
import { createProductionApi } from './production-api.js';
import { JOIN_CODE_LENGTH, normalizeJoinCode } from './class-join.js';

/**
 * Backlog B3-02 — a student joins a classroom with the class teacher's code; the guardian approves.
 * Real PostgreSQL, no AI.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe('join code format', () => {
  it('normalises spacing / case / dashes and rejects look-alike characters', () => {
    expect(normalizeJoinCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeJoinCode(' abcd efgh ')).toBe('ABCDEFGH');
    expect(normalizeJoinCode('ABCD-EFG0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeJoinCode('ABC')).toBeNull();
    expect(JOIN_CODE_LENGTH).toBe(8);
  });
});

describe.skipIf(!DATABASE_URL)('student joins a class with a teacher code', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  let idSvc: IdentityService;
  const stamp = Date.now();
  const now = () => new Date();
  const users: string[] = [];
  const children: string[] = [];
  const families: string[] = [];
  const schoolNames: string[] = [];
  let classroomId = '';
  let year = '';

  async function reg(email: string, role: 'PARENT' | 'STUDENT' | 'TEACHER') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [me.userId]);
    users.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  async function family(tag: string) {
    const parent = await reg(`cj-p-${tag}-${stamp}@x.com`, 'PARENT');
    const student = await reg(`cj-s-${tag}-${stamp}@x.com`, 'STUDENT');
    const pAuth = { bearer: parent.bearer, workspace: 'PARENT' as const };
    const child = await api.createChild(pAuth, { displayName: `Bé ${tag}`, schoolGrade: 7 });
    children.push(child.childId);
    families.push((await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [child.childId])).rows[0]!.family_id);
    await idSvc.linkStudentAccount({
      studentUserId: student.userId as never,
      childId: child.childId,
      linkMethod: 'PARENT_INVITE',
      linkedByUserId: parent.userId as never,
    });
    return { pAuth, sAuth: { bearer: student.bearer, workspace: 'STUDENT' as const }, childId: child.childId };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL!.includes('supabase') ? { rejectUnauthorized: false } : undefined });
    const auth = new InMemoryAuthAdapter(`cj${stamp}`);
    api = createProductionApi({ pool, authAdapter: auth, now });
    idSvc = new IdentityService({ store: new PgIdentityStore(pool), auth, now });

    const admin = await reg(`cj-setup-${stamp}@x.com`, 'PARENT');
    const a = { bearer: admin.bearer, workspace: 'PARENT' as const };
    year = (await api.listAcademicYears(a)).find((y) => y.status === 'ACTIVE')!.id;
    const schoolName = `CJ School ${stamp}`;
    schoolNames.push(schoolName);
    const school = await api.proposeSchool(a, { officialName: schoolName });
    classroomId = (await api.proposeClass(a, school.school.id, { academicYearId: year, grade: 7, className: `CJ-7A-${stamp}` })).id;
  }, 30_000);

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`DELETE FROM student_class_enrollments WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM classroom_join_codes WHERE classroom_id = $1`, [classroomId]).catch(() => {});
      await c.query(`DELETE FROM teacher_class_assignments WHERE classroom_id = $1`, [classroomId]).catch(() => {});
      await c.query(`DELETE FROM classrooms WHERE id = $1`, [classroomId]).catch(() => {});
      await c.query(`DELETE FROM schools WHERE official_name = ANY($1)`, [schoolNames]).catch(() => {});
      await c.query(`DELETE FROM student_account_links WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [children]).catch(() => {});
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [families]).catch(() => {});
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]).catch(() => {});
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await pool.end();
  }, 30_000);

  it('only a teacher assigned to the class can mint a code', async () => {
    const t = await reg(`cj-t-no-${stamp}@x.com`, 'TEACHER');
    const tAuth = { bearer: t.bearer, workspace: 'TEACHER' as const };
    await expect(api.teacherCreateJoinCode(tAuth, classroomId)).rejects.toThrow(/chưa được gắn/);
    expect((await api.teacherListClasses(tAuth)).classes).toEqual([]);
  });

  it('full flow: claim → code → student redeems → parent approves; privacy stays private', async () => {
    const t = await reg(`cj-t-${stamp}@x.com`, 'TEACHER');
    const tAuth = { bearer: t.bearer, workspace: 'TEACHER' as const };
    await api.teacherClaimClass(tAuth, classroomId);
    await api.teacherClaimClass(tAuth, classroomId); // idempotent
    const { code } = await api.teacherCreateJoinCode(tAuth, classroomId);
    expect(code).toHaveLength(8);

    const f = await family('flow');
    const joined = await api.studentJoinClass(f.sAuth, code.toLowerCase());
    expect(joined.status).toBe('PENDING_PARENT');
    expect(joined.classLabel).toContain('CJ School');

    // the same student retyping the code does not create a second row
    expect((await api.studentJoinClass(f.sAuth, code)).status).toBe('ALREADY_PENDING');

    // teacher sees only aggregate counts
    let mine = (await api.teacherListClasses(tAuth)).classes[0]!;
    expect(mine.pendingRequests).toBe(1);
    expect(JSON.stringify(mine)).not.toContain(f.childId);

    const { requests } = await api.listClassJoinRequests(f.pAuth, f.childId);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.classLabel).toContain('CJ School');

    const decided = await api.decideClassJoinRequest(f.pAuth, f.childId, requests[0]!.enrollmentId, true);
    expect(decided.status).toBe('ACTIVE');
    const row = (await pool.query(`SELECT status, privacy_mode, source, enrollment_type FROM student_class_enrollments WHERE child_id = $1`, [f.childId])).rows[0];
    expect(row).toMatchObject({ status: 'ACTIVE', privacy_mode: 'PRIVATE_LEARNING', source: 'STUDENT_JOIN_CODE', enrollment_type: 'PRIMARY' });

    expect((await api.studentJoinClass(f.sAuth, code)).status).toBe('ALREADY_MEMBER');
    mine = (await api.teacherListClasses(tAuth)).classes[0]!;
    expect(mine).toMatchObject({ pendingRequests: 0, approvedViaCode: 1 });
    await expect(api.decideClassJoinRequest(f.pAuth, f.childId, requests[0]!.enrollmentId, false)).rejects.toThrow(/đã được xử lý/);
  }, 30_000);

  it('a rejected request ends as LEFT and can be asked again', async () => {
    const t = await reg(`cj-t2-${stamp}@x.com`, 'TEACHER');
    const tAuth = { bearer: t.bearer, workspace: 'TEACHER' as const };
    await api.teacherClaimClass(tAuth, classroomId);
    const { code } = await api.teacherCreateJoinCode(tAuth, classroomId);
    const f = await family('reject');
    await api.studentJoinClass(f.sAuth, code);
    const [req] = (await api.listClassJoinRequests(f.pAuth, f.childId)).requests;
    expect((await api.decideClassJoinRequest(f.pAuth, f.childId, req!.enrollmentId, false)).status).toBe('LEFT');
    expect((await api.listClassJoinRequests(f.pAuth, f.childId)).requests).toEqual([]);
    expect((await api.studentJoinClass(f.sAuth, code)).status).toBe('PENDING_PARENT');
  }, 30_000);

  it('minting a new code retires the old one; revoked and garbage codes all look the same', async () => {
    const t = await reg(`cj-t3-${stamp}@x.com`, 'TEACHER');
    const tAuth = { bearer: t.bearer, workspace: 'TEACHER' as const };
    await api.teacherClaimClass(tAuth, classroomId);
    const first = await api.teacherCreateJoinCode(tAuth, classroomId);
    const second = await api.teacherCreateJoinCode(tAuth, classroomId);
    expect(second.code).not.toBe(first.code);

    const f = await family('codes');
    await expect(api.studentJoinClass(f.sAuth, first.code)).rejects.toThrow(/chưa đúng hoặc đã hết hạn/);
    await expect(api.studentJoinClass(f.sAuth, 'ZZZZZZZZ')).rejects.toThrow(/chưa đúng hoặc đã hết hạn/);
    await expect(api.studentJoinClass(f.sAuth, 'abc')).rejects.toThrow(/chưa đúng hoặc đã hết hạn/);

    await api.teacherRevokeJoinCode(tAuth, classroomId);
    await expect(api.studentJoinClass(f.sAuth, second.code)).rejects.toThrow(/chưa đúng hoặc đã hết hạn/);
  }, 30_000);

  it('an expired code is refused', async () => {
    const t = await reg(`cj-t4-${stamp}@x.com`, 'TEACHER');
    const tAuth = { bearer: t.bearer, workspace: 'TEACHER' as const };
    await api.teacherClaimClass(tAuth, classroomId);
    const { code } = await api.teacherCreateJoinCode(tAuth, classroomId);
    await pool.query(`UPDATE classroom_join_codes SET expires_at = now() - interval '1 minute' WHERE code = $1`, [code]);
    const f = await family('expired');
    await expect(api.studentJoinClass(f.sAuth, code)).rejects.toThrow(/chưa đúng hoặc đã hết hạn/);
  }, 30_000);

  it('repeated wrong guesses are throttled', async () => {
    const f = await family('brute');
    for (let i = 0; i < 8; i += 1) {
      await expect(api.studentJoinClass(f.sAuth, 'ZZZZZZZZ')).rejects.toThrow(/chưa đúng/);
    }
    await expect(api.studentJoinClass(f.sAuth, 'ZZZZZZZZ')).rejects.toThrow(/nhiều lần/);
  }, 30_000);

  it('workspaces are enforced: a parent cannot redeem, a student cannot approve, a stranger cannot decide', async () => {
    const t = await reg(`cj-t5-${stamp}@x.com`, 'TEACHER');
    const tAuth = { bearer: t.bearer, workspace: 'TEACHER' as const };
    await api.teacherClaimClass(tAuth, classroomId);
    const { code } = await api.teacherCreateJoinCode(tAuth, classroomId);
    const a = await family('wsA');
    const b = await family('wsB');
    await expect(api.studentJoinClass(a.pAuth, code)).rejects.toThrow();
    await api.studentJoinClass(a.sAuth, code);
    const [req] = (await api.listClassJoinRequests(a.pAuth, a.childId)).requests;
    await expect(api.decideClassJoinRequest(a.sAuth, a.childId, req!.enrollmentId, true)).rejects.toThrow();
    await expect(api.decideClassJoinRequest(b.pAuth, a.childId, req!.enrollmentId, true)).rejects.toThrow();
    await expect(api.listClassJoinRequests(b.pAuth, a.childId)).rejects.toThrow();
    await expect(api.teacherCreateJoinCode(a.pAuth, classroomId)).rejects.toThrow();
  }, 30_000);
});
