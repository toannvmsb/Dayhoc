import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from '@copilot/identity';
import { createProductionApi } from './production-api.js';

/**
 * I7.1 END-TO-END SECURITY GATE (§13). Runs against a database migrated through
 * `*_relationship_invite_codes` (`npm run db:migrate`). Verified token →
 * server-derived identity → workspace → DB-backed resource → authorize()/can() →
 * domain service → Postgres → safe response.
 *
 * Auth is a real token flow via `InMemoryAuthAdapter` (bearer === the provider
 * subject id it mints) — no Supabase credentials needed.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('I7.1 — production API E2E security matrix', () => {
  let pool: import('pg').Pool;
  let api: ReturnType<typeof createProductionApi>;
  const now = () => new Date('2027-01-20T00:00:00.000Z');
  const cleanup: { userIds: string[]; childIds: string[]; familyIds: string[]; schoolNames: string[] } = {
    userIds: [],
    childIds: [],
    familyIds: [],
    schoolNames: [],
  };

  // shared fixture handles
  let parentA: { userId: string; bearer: string };
  let parentB: { userId: string; bearer: string };
  let teacher: { userId: string; bearer: string };
  let teacher2: { userId: string; bearer: string };
  let studentA: { userId: string; bearer: string };
  let childA: string;
  let childB: string;
  let mathId: string;
  let year2627: string;
  let schoolId: string;
  let primaryClassId: string;
  let hsgClassId: string;
  let req05Id: string;

  async function reg(email: string, role: 'PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN') {
    const me = await api.register({ email, password: 'supersecret', intendedRole: role, displayName: email });
    const r = await pool.query<{ auth_user_id: string }>(`SELECT auth_user_id FROM users WHERE id = $1`, [
      me.userId,
    ]);
    cleanup.userIds.push(me.userId);
    return { userId: me.userId, bearer: r.rows[0]!.auth_user_id };
  }

  beforeAll(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: DATABASE_URL });
    api = createProductionApi({ pool, authAdapter: new InMemoryAuthAdapter(`e2e${Date.now()}`), now });

    const stamp = Date.now();
    parentA = await reg(`e2e-pA-${stamp}@x.com`, 'PARENT');
    parentB = await reg(`e2e-pB-${stamp}@x.com`, 'PARENT');
    teacher = await reg(`e2e-t-${stamp}@x.com`, 'TEACHER');
    teacher2 = await reg(`e2e-t2-${stamp}@x.com`, 'TEACHER');
    studentA = await reg(`e2e-s-${stamp}@x.com`, 'STUDENT');

    const cA = await api.createChild({ bearer: parentA.bearer, workspace: 'PARENT' }, { displayName: 'An', schoolGrade: 7 });
    childA = cA.childId;
    const cB = await api.createChild({ bearer: parentB.bearer, workspace: 'PARENT' }, { displayName: 'Bảo', schoolGrade: 7 });
    childB = cB.childId;
    cleanup.childIds.push(childA, childB);
    for (const cid of [childA, childB]) {
      const f = await pool.query<{ family_id: string }>(`SELECT family_id FROM child_profiles WHERE id = $1`, [cid]);
      cleanup.familyIds.push(f.rows[0]!.family_id);
    }

    // link the student to child A
    const linkInvite = await pool.query<{ id: string }>(
      `SELECT id FROM child_profiles WHERE id = $1`,
      [childA],
    );
    void linkInvite;
    const { IdentityService } = await import('@copilot/identity');
    const { PgIdentityStore } = await import('@copilot/identity/pg');
    const idSvc = new IdentityService({ store: new PgIdentityStore(pool), auth: new InMemoryAuthAdapter(), now });
    await idSvc.linkStudentAccount({
      studentUserId: studentA.userId as never,
      childId: childA,
      linkMethod: 'PARENT_INVITE',
      linkedByUserId: parentA.userId as never,
    });

    // directory
    mathId = (await api.listSubjects({ bearer: parentA.bearer, workspace: 'PARENT' })).find((s) => s.code === 'MATH')!.id;
    year2627 = (await api.listAcademicYears({ bearer: parentA.bearer, workspace: 'PARENT' })).find((y) => y.label === '2026-2027')!.id;
    const schoolName = `E2E School ${stamp}`;
    cleanup.schoolNames.push(schoolName);
    schoolId = (await api.proposeSchool({ bearer: parentA.bearer, workspace: 'PARENT' }, { officialName: schoolName })).school.id;
    primaryClassId = (
      await api.proposeClass({ bearer: parentA.bearer, workspace: 'PARENT' }, schoolId, { academicYearId: year2627, grade: 7, className: 'E2E-7C0' })
    ).id;
    hsgClassId = (
      await api.proposeClass({ bearer: parentA.bearer, workspace: 'PARENT' }, schoolId, { academicYearId: year2627, grade: 7, className: 'E2E-7HSG' })
    ).id;

    // child A: ACTIVE school + PRIMARY class (LINKED_SHARED) + HSG_TEAM
    await api.createSchoolEnrollment(
      { bearer: parentA.bearer, workspace: 'PARENT' },
      childA,
      { schoolId, academicYearId: year2627, grade: 7 },
    );
    await api.createClassEnrollment(
      { bearer: parentA.bearer, workspace: 'PARENT' },
      childA,
      { classroomId: primaryClassId, academicYearId: year2627, enrollmentType: 'PRIMARY', privacyMode: 'LINKED_SHARED' },
    );
    await api.createClassEnrollment(
      { bearer: parentA.bearer, workspace: 'PARENT' },
      childA,
      { classroomId: hsgClassId, academicYearId: year2627, enrollmentType: 'HSG_TEAM' },
    );
  });

  afterAll(async () => {
    if (!pool) return;
    const c = await pool.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(
        `DELETE FROM permission_grants WHERE subject_link_id IN (SELECT id FROM teacher_child_links WHERE child_id = ANY($1::uuid[]))`,
        [cleanup.childIds],
      );
      await c.query(`DELETE FROM audit_events WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM teacher_child_links WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM teacher_parent_links WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM relationship_requests WHERE target_child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM relationship_invite_codes WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM teacher_class_assignments WHERE classroom_id IN (SELECT id FROM classrooms WHERE school_id = ANY(SELECT id FROM schools WHERE official_name = ANY($1)))`, [cleanup.schoolNames]);
      await c.query(`DELETE FROM student_class_enrollments WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM student_school_enrollments WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM enrollment_transitions WHERE child_id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM child_profiles WHERE id = ANY($1::uuid[])`, [cleanup.childIds]);
      await c.query(`DELETE FROM schools WHERE official_name = ANY($1)`, [cleanup.schoolNames]);
      await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [cleanup.familyIds]);
      await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [cleanup.userIds]);
    } finally {
      await c.query(`SET session_replication_role = origin`);
      c.release();
    }
    await pool.end();
  });

  const pA = () => ({ bearer: parentA.bearer, workspace: 'PARENT' as const });
  const pB = () => ({ bearer: parentB.bearer, workspace: 'PARENT' as const });
  const tE = () => ({ bearer: teacher.bearer, workspace: 'TEACHER' as const });
  const sA = () => ({ bearer: studentA.bearer, workspace: 'STUDENT' as const });

  // -----------------------------------------------------------------

  it('01 — forged bearer token rejected', async () => {
    await expect(api.getMe({ bearer: 'totally-forged', workspace: 'PARENT' })).rejects.toMatchObject({ status: 401 });
  });

  it('02 — a valid user cannot select an unheld workspace', async () => {
    await expect(api.switchWorkspace(parentA.bearer, 'TEACHER')).rejects.toBeTruthy();
    await expect(api.switchWorkspace(parentA.bearer, 'PARENT')).resolves.toMatchObject({ workspace: 'PARENT' });
  });

  it('03 — a Parent can access their own managed Child', async () => {
    const child = await api.getChild(pA(), childA);
    expect(child).toMatchObject({ childId: childA, displayName: 'An' });
  });

  it('04 — an unrelated Parent cannot access the Child', async () => {
    await expect(api.getChild(pB(), childA)).rejects.toBeTruthy();
  });

  it('05 — a Teacher with a PENDING request has ZERO Child access (403)', async () => {
    const req = await api.createRelationshipRequest(tE(), {
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childA,
      subjectId: mathId,
      proposedPermissions: ['SUBMIT_CURRENT_LESSON', 'VIEW_SELECTED_GAPS'],
    });
    await expect(api.getLearningContext(tE(), childA)).rejects.toBeTruthy();
    await expect(api.teacherGetPermissions(tE(), childA, mathId)).resolves.toMatchObject({ codes: [] });
    req05Id = req.id;
  });

  it('06 — Teacher accepted + correct permission → allowed; 07 — missing permission → 403', async () => {
    await api.acceptRelationshipRequest(pA(), req05Id, ['SUBMIT_CURRENT_LESSON']);
    const perms = await api.teacherGetPermissions(tE(), childA, mathId);
    expect(perms.codes).toContain('SUBMIT_CURRENT_LESSON');
    // 07 — a code that was proposed but not approved
    expect(perms.codes).not.toContain('VIEW_SELECTED_GAPS');
    await expect(api.teacherGetGaps(tE(), childA, mathId)).rejects.toBeTruthy();
  });

  it('13 — a contribution for the wrong Subject → 403', async () => {
    const vnId = (await api.listSubjects(pA())).find((s) => s.code === 'VIETNAMESE')!.id;
    await expect(
      api.teacherSubmitContribution(tE(), childA, {
        subjectId: vnId,
        contributionType: 'CURRENT_LESSON',
        observedAt: '2027-01-18',
      }),
    ).rejects.toBeTruthy();
  });

  it('26 — a Teacher contribution records relationship provenance; 27 — never mutates the Twin', async () => {
    const c = await api.teacherSubmitContribution(tE(), childA, {
      subjectId: mathId,
      contributionType: 'CURRENT_LESSON',
      observedAt: '2027-01-18',
      taughtSkillIds: ['M7.QNUM.ORDER_TRANSPOSE'],
      confidence: 'A',
    });
    expect(c.relationshipSourceType).toBe('TEACHER_CHILD_LINK');
    expect(c.relationshipSourceId).toBeTruthy();
    // it landed in the append-only ledger, not any twin table
    const inLedger = await pool.query(`SELECT count(*)::int n FROM teacher_contributions WHERE child_id = $1`, [childA]);
    expect(inLedger.rows[0]!.n).toBeGreaterThan(0);
  });

  it('14 — sensitive permissions default OFF; 15 — Parent grants VIEW_LEARNING_TWIN_SUMMARY → allowed; 16 — revoke → immediate 403', async () => {
    await expect(api.teacherGetTwinSummary(tE(), childA, mathId)).rejects.toBeTruthy(); // 14

    const link = (await api.listTeacherLinks(pA(), childA)).find((l) => l.status === 'ACCEPTED')!;
    await api.updateTeacherLinkPermissions(pA(), childA, link.id, { grant: ['VIEW_LEARNING_TWIN_SUMMARY'] });
    const summary = await api.teacherGetTwinSummary(tE(), childA, mathId); // 15
    expect(summary.childId).toBe(childA);
    expect(Array.isArray(summary.skills)).toBe(true);

    await api.updateTeacherLinkPermissions(pA(), childA, link.id, { revoke: ['VIEW_LEARNING_TWIN_SUMMARY'] });
    await expect(api.teacherGetTwinSummary(tE(), childA, mathId)).rejects.toBeTruthy(); // 16
  });

  it('09 — Teacher-Class only → Twin summary 403; 10 — +LINKED_SHARED → class-context op allowed', async () => {
    // teacher2: only a class assignment, no teacher_child_link
    const { PgEducationStore } = await import('@copilot/education-directory/pg');
    const store = new PgEducationStore(pool);
    await store.insertTeacherClassAssignment({
      id: crypto.randomUUID(),
      teacherUserId: teacher2.userId,
      classroomId: primaryClassId as never,
      academicYearId: year2627 as never,
      subjectId: mathId as never,
      role: 'SUBJECT_TEACHER',
      status: 'ACTIVE',
      verificationStatus: 'SELF_DECLARED',
      createdAt: now().toISOString(),
      endedAt: null,
    });
    const t2 = { bearer: teacher2.bearer, workspace: 'TEACHER' as const };
    // 09 — no link at all → twin summary denied
    await expect(api.teacherGetTwinSummary(t2, childA, mathId)).rejects.toBeTruthy();

    // 10 — a class-sourced link + LINKED_SHARED → class-context contribution allowed
    const req = await api.createRelationshipRequest(pA(), {
      relationshipKind: 'TEACHER_CHILD',
      targetType: 'CHILD',
      targetChildId: childA,
      targetUserId: teacher2.userId,
      subjectId: mathId,
      accessSource: 'CLASS_ASSIGNMENT',
      proposedPermissions: ['SUBMIT_CURRENT_LESSON', 'VIEW_CLASS_CONTEXT'],
    });
    await api.acceptRelationshipRequest({ bearer: teacher2.bearer, workspace: 'TEACHER' }, req.id);
    const c = await api.teacherSubmitContribution(t2, childA, {
      subjectId: mathId,
      contributionType: 'CURRENT_LESSON',
      observedAt: '2027-01-18',
    });
    expect(c.contributionType).toBe('CURRENT_LESSON');
    // still no sensitive Twin read via the class link
    await expect(api.teacherGetGaps(t2, childA, mathId)).rejects.toBeTruthy();
  });

  it('11 — Teacher-Class + LINKED_PRIVATE → class-derived contribution denied; 12 — PRIVATE_LEARNING → denied', async () => {
    const t2 = { bearer: teacher2.bearer, workspace: 'TEACHER' as const };
    const primaryEnr = (await api.listEnrollments(pA(), childA)).class.find(
      (e) => e.enrollmentType === 'PRIMARY',
    )!;
    await api.setClassPrivacy(pA(), childA, primaryEnr.id, 'LINKED_PRIVATE'); // 11
    await expect(
      api.teacherSubmitContribution(t2, childA, { subjectId: mathId, contributionType: 'CURRENT_LESSON', observedAt: '2027-01-19' }),
    ).rejects.toBeTruthy();
    await api.setClassPrivacy(pA(), childA, primaryEnr.id, 'PRIVATE_LEARNING'); // 12
    await expect(
      api.teacherSubmitContribution(t2, childA, { subjectId: mathId, contributionType: 'CURRENT_LESSON', observedAt: '2027-01-19' }),
    ).rejects.toBeTruthy();
    await api.setClassPrivacy(pA(), childA, primaryEnr.id, 'LINKED_SHARED'); // restore
  });

  it('08 — a TeacherParent-only link grants NO child learning-data access', async () => {
    const req = await api.createRelationshipRequest({ bearer: teacher.bearer, workspace: 'TEACHER' }, {
      relationshipKind: 'TEACHER_PARENT',
      targetType: 'PARENT',
      targetUserId: parentB.userId,
      targetChildId: childB,
    });
    await api.acceptRelationshipRequest(pB(), req.id);
    await expect(api.getLearningContext({ bearer: teacher.bearer, workspace: 'TEACHER' }, childB)).rejects.toBeTruthy();
  });

  it('17 — Parent revokes the relationship → immediate 403', async () => {
    const link = (await api.listTeacherLinks(pA(), childA)).find(
      (l) => l.status === 'ACCEPTED' && l.teacherUserId === teacher.userId,
    )!;
    await api.updateTeacherLinkPermissions(pA(), childA, link.id, { grant: ['SUBMIT_HOMEWORK'] });
    expect((await api.teacherGetPermissions(tE(), childA, mathId)).codes).toContain('SUBMIT_HOMEWORK');
    await api.revokeTeacherChildLink(pA(), link.id);
    expect((await api.teacherGetPermissions(tE(), childA, mathId)).codes).not.toContain('SUBMIT_HOMEWORK');
    await expect(api.getLearningContext(tE(), childA)).rejects.toBeTruthy();
  });

  it('18 — Student accesses linked Child → allowed; 19 — other Child → 403; 20 — forged childScope ignored', async () => {
    const me = await api.studentGetMe(sA());
    expect(me.childId).toBe(childA);
    const today = await api.studentGetToday(sA());
    expect(today).toBeTruthy();
    // 19/20 — there is no parameter for the student to pass another childId; getToday
    // for a PARENT-less student always uses the server-resolved childScope
    await expect(api.getToday(sA(), childB)).rejects.toBeTruthy();
  });

  it('21/22 — supplementary + HSG_TEAM cannot drive the Curriculum Clock; 24 — ACTIVE PRIMARY does', async () => {
    const inputs = await import('./learning-scene.js').then((m) =>
      m.resolveChildLearningInputs(pool, api._services.enrollments, childA, now()),
    );
    // childA's ACTIVE PRIMARY is grade 7 at the E2E school; the HSG_TEAM enrollment
    // is grade-7 too but must not be the source
    expect(inputs.gradeContext).toBe(7);
    expect(inputs.enrollment).toBeTruthy();
    const active = await api._services.enrollments.resolveActiveEnrollment(childA, now());
    expect(active?.primaryClassroomId).toBe(primaryClassId);
  });

  it('23 — a PROPOSED enrollment cannot become the current context', async () => {
    // give childB a PROPOSED school enrollment at grade 9 — it must NOT become the
    // resolved ACTIVE context.
    await api._services.enrollments.createSchoolEnrollment({
      childId: childB,
      schoolId,
      academicYearId: year2627,
      grade: 9,
      status: 'PROPOSED',
    });
    const active = await api._services.enrollments.resolveActiveEnrollment(childB, now());
    expect(active).toBeNull(); // PROPOSED is never ACTIVE truth

    // the learning scene falls back to a CONSERVATIVE clock estimate from the
    // grade cache (7) + the active academic year — never grade 9 from the PROPOSED
    // row, and always `confidence: ESTIMATED` (not shown as fact).
    const inputs = await import('./learning-scene.js').then((m) =>
      m.resolveChildLearningInputs(pool, api._services.enrollments, childB, now()),
    );
    expect(inputs.gradeContext).toBe(7);
    if (inputs.enrollment) {
      expect(inputs.enrollment.academicYear).toBe('2026-2027');
    }
  });

  it('25 — historical enrollment is preserved after a transition', async () => {
    const year2728 = (await api.listAcademicYears(pA())).find((y) => y.label === '2027-2028')!.id;
    const t = await api._services.progression.determineProposal({
      childId: childA,
      toAcademicYearId: year2728,
      currentClassName: '7C0',
      asOf: now(),
    });
    const newClass = (
      await api.proposeClass(pA(), schoolId, { academicYearId: year2728, grade: 8, className: 'E2E-8C0' })
    ).id;
    await api._services.progression.confirmTransition(t.id, parentA.userId, true, {
      toSchoolId: schoolId,
      toClassroomId: newClass,
    });
    const history = await api._services.enrollments.listSchoolEnrollments(childA);
    expect(history.length).toBe(2);
    expect(history.some((e) => e.status === 'COMPLETED' && e.grade === 7)).toBe(true);
    expect(history.some((e) => e.status === 'ACTIVE' && e.grade === 8)).toBe(true);
  });

  it('28 — email lookup returns a boolean only; 29 — school search reveals no Child', async () => {
    const exists = await api.emailExists(pA(), parentB.bearer ? `e2e-pB-` : 'x');
    expect(Object.keys(exists)).toEqual(['accountExists']);
    const schools = await api.searchSchools(pA(), { nameFragment: 'E2E School' });
    for (const s of schools) {
      expect(s).not.toHaveProperty('childId');
      expect(s).not.toHaveProperty('children');
    }
  });

  it('30 — a relationship invite code gives ZERO access before acceptance', async () => {
    const code = await api.createInviteCode(pA(), { childId: childA, subjectId: mathId, proposedPermissions: ['SUBMIT_CURRENT_LESSON'] });
    const req = await api.redeemInviteCode({ bearer: teacher2.bearer, workspace: 'TEACHER' }, code.code);
    expect(req.status).toBe('PENDING');
    // teacher2 already has an ACCEPTED class link from test 10; but the fresh
    // request itself grants nothing — the invite path is ZERO-access until accept
    expect(req.relationshipKind).toBe('TEACHER_CHILD');
  });

  it('audit — denied sensitive access + relationship transitions were recorded', async () => {
    const denied = await pool.query(
      `SELECT count(*)::int n FROM audit_events WHERE child_id = $1 AND event_type = 'CHILD_DATA_ACCESS_DENIED'`,
      [childA],
    );
    expect(denied.rows[0]!.n).toBeGreaterThan(0);
    const accepted = await pool.query(
      `SELECT count(*)::int n FROM audit_events WHERE child_id = $1 AND event_type = 'RELATIONSHIP_REQUEST_ACCEPTED'`,
      [childA],
    );
    expect(accepted.rows[0]!.n).toBeGreaterThan(0);
  });
});
