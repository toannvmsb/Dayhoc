/**
 * DạyZi pilot / staging seed (hardening §22).
 *
 *   DATABASE_URL=postgres://... DZ_DEV_AUTH=1 NODE_ENV=development \
 *     node scripts/seed-pilot.mjs
 *
 * Idempotent (re-run = same result), clearly non-production, easy to reset:
 *   node scripts/seed-pilot.mjs --reset
 *
 * Creates: 1 parent, a grade-4 + grade-7 child, a student login, a teacher,
 * a school + academic year + PRIMARY class + HSG team, an accepted teacher
 * relationship, sample evidence -> a gap, a practice assignment, and an exam.
 *
 * NO real personal data. Emails are @dayzi.seed. Refuses to run if NODE_ENV=production.
 */
import { Pool } from 'pg';
import { resolveAuthAdapter } from '../packages/identity/dist/index.js';
import { createProductionApi } from '../services/api/dist/index.js';

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to seed a production database');
  process.exit(1);
}
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('set DATABASE_URL');
  process.exit(1);
}

const RESET = process.argv.includes('--reset');
const TAG = 'dayzi.seed';
const pool = new Pool({ connectionString: DATABASE_URL, max: 4 });
const { adapter } = resolveAuthAdapter({ ...process.env, DZ_DEV_AUTH: '1' });
const api = createProductionApi({ pool, authAdapter: adapter });

const bearerOf = async (userId) =>
  (await pool.query('SELECT auth_user_id FROM users WHERE id=$1', [userId])).rows[0].auth_user_id;

async function wipe() {
  const ids = (
    await pool.query(`SELECT id FROM users WHERE lower(primary_email) LIKE '%@${TAG}'`)
  ).rows.map((r) => r.id);
  if (ids.length === 0) return console.log('nothing to reset');
  const children = (
    await pool.query(
      `SELECT c.id FROM child_profiles c JOIN parent_child_relationships r ON r.child_id=c.id WHERE r.parent_user_id = ANY($1::uuid[])`,
      [ids],
    )
  ).rows.map((r) => r.id);
  const fams = (
    await pool.query(`SELECT family_id FROM family_memberships WHERE user_id = ANY($1::uuid[])`, [ids])
  ).rows.map((r) => r.family_id);
  const c = await pool.connect();
  try {
    await c.query('SET session_replication_role = replica');
    for (const t of [
      'attempt_answers', 'attempts', 'assignment_items', 'assignments', 'plan_items', 'learning_plans',
      'gap_prescriptions', 'knowledge_gaps', 'skill_states', 'problem_type_mastery', 'thinking_state',
      'learning_state_snapshots', 'learning_context_snapshots', 'lesson_confirmations', 'generation_specs',
      'exam_results', 'exams', 'upload_analysis', 'uploads', 'evidence', 'teacher_contributions',
      'permission_grants', 'teacher_child_links', 'teacher_parent_links', 'relationship_invite_codes',
      'relationship_requests', 'teacher_invites', 'student_class_enrollments', 'student_school_enrollments',
      'child_school_enrollment', 'enrollment_transitions', 'consent_records', 'privacy_preferences',
      'child_credentials', 'child_quick_access', 'student_account_links', 'parent_child_relationships',
      'audit_events', 'child_deletion_requests', 'child_profiles',
    ]) {
      await c.query(`DELETE FROM ${t} WHERE child_id = ANY($1::uuid[])`, [children]).catch(() => {});
    }
    await c.query(`DELETE FROM family_subscriptions WHERE family_id = ANY($1::uuid[])`, [fams]).catch(() => {});
    await c.query(`DELETE FROM family_memberships WHERE family_id = ANY($1::uuid[])`, [fams]).catch(() => {});
    await c.query(`DELETE FROM families WHERE id = ANY($1::uuid[])`, [fams]).catch(() => {});
    await c.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await c.query(`DELETE FROM parent_profiles WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await c.query(`DELETE FROM teacher_profiles WHERE user_id = ANY($1::uuid[])`, [ids]).catch(() => {});
    await c.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
    await c.query(`DELETE FROM classrooms WHERE class_name LIKE 'SEED-%'`).catch(() => {});
    await c.query(`DELETE FROM schools WHERE official_name LIKE 'DạyZi Seed%'`).catch(() => {});
  } finally {
    await c.query('SET session_replication_role = origin');
    c.release();
  }
  console.log(`reset: removed ${ids.length} seed users + ${children.length} children`);
}

async function ensureUser(email, role, displayName) {
  const existing = (await pool.query('SELECT id FROM users WHERE lower(primary_email)=lower($1)', [email])).rows[0];
  if (existing) return { userId: existing.id, bearer: await bearerOf(existing.id) };
  const me = await api.register({ email, password: 'pilotpass1234', intendedRole: role, displayName });
  return { userId: me.userId, bearer: await bearerOf(me.userId) };
}

async function main() {
  if (RESET) {
    await wipe();
    await pool.end();
    return;
  }

  const parent = await ensureUser(`phuhuynh@${TAG}`, 'PARENT', 'Phụ huynh Pilot');
  const teacher = await ensureUser(`giaovien@${TAG}`, 'TEACHER', 'Cô Pilot');
  const pAuth = { bearer: parent.bearer, workspace: 'PARENT' };
  const tAuth = { bearer: teacher.bearer, workspace: 'TEACHER' };

  let kids = await api.listChildren(pAuth);
  if (!kids.some((k) => k.displayName === 'Bé Lớp 4')) {
    await api.createChild(pAuth, { displayName: 'Bé Lớp 4', schoolGrade: 4 }); // creates the family
  }
  await api.setPlan(pAuth, 'plus').catch(() => {}); // room for a 2nd child
  kids = await api.listChildren(pAuth);
  if (!kids.some((k) => k.displayName === 'Bé Lớp 7')) {
    await api.createChild(pAuth, { displayName: 'Bé Lớp 7', schoolGrade: 7 }).catch(() => {});
  }
  kids = await api.listChildren(pAuth);
  const g4 = kids.find((k) => k.displayName === 'Bé Lớp 4');
  const g7 = kids.find((k) => k.displayName === 'Bé Lớp 7');

  // student login for the grade-7 child
  const access = await api.getStudentAccess(pAuth, g7.childId);
  if (access?.status !== 'ACTIVE') {
    await api.createStudentAccess(pAuth, g7.childId, { password: 'hocsinh1234' }).catch(() => {});
  }
  const studentEmail = (await api.getStudentAccess(pAuth, g7.childId))?.loginEmail;

  // school + year + classes for the grade-7 child
  const school = await api.proposeSchool(pAuth, {
    officialName: 'DạyZi Seed — THCS Thử Nghiệm',
    province: 'Hà Nội',
    district: 'Cầu Giấy',
  });
  const years = await api.listAcademicYears(pAuth);
  const year = years.find((y) => y.status === 'ACTIVE') ?? years[0];
  await api
    .createSchoolEnrollment(pAuth, g7.childId, { schoolId: school.school.id, academicYearId: year.id, grade: 7 })
    .catch(() => {});
  const primary = await api.proposeClass(pAuth, school.school.id, {
    academicYearId: year.id, grade: 7, className: 'SEED-7A1',
  });
  const hsg = await api.proposeClass(pAuth, school.school.id, {
    academicYearId: year.id, grade: 7, className: 'SEED-HSG-Toan',
  });
  await api
    .createClassEnrollment(pAuth, g7.childId, {
      classroomId: primary.id, academicYearId: year.id, enrollmentType: 'PRIMARY', privacyMode: 'LINKED_PRIVATE',
    })
    .catch(() => {});
  await api
    .createClassEnrollment(pAuth, g7.childId, {
      classroomId: hsg.id, academicYearId: year.id, enrollmentType: 'HSG_TEAM', privacyMode: 'PRIVATE_LEARNING',
    })
    .catch(() => {});

  // teacher relationship (accepted) + a sensitive grant
  const reqs = await api.listRelationshipRequests(pAuth);
  let linkId = (await api.listTeacherLinks(pAuth, g7.childId)).find((l) => l.status === 'ACCEPTED')?.id;
  if (!linkId) {
    const invite = await api.createInviteCode(pAuth, { childId: g7.childId });
    const red = await api.redeemInviteCode(tAuth, invite.code);
    await api.acceptRelationshipRequest(pAuth, red.id);
    linkId = (await api.listTeacherLinks(pAuth, g7.childId)).find((l) => l.status === 'ACCEPTED')?.id;
  }
  if (linkId) {
    await api
      .updateTeacherLinkPermissions(pAuth, g7.childId, linkId, {
        grant: ['VIEW_LEARNING_TWIN_SUMMARY', 'VIEW_SELECTED_GAPS'],
      })
      .catch(() => {});
  }
  void reqs;

  // sample evidence -> a gap, for the grade-4 child
  const svc = api._services;
  const evCount = (await svc.ledger.listEvidence(g4.childId)).length;
  if (evCount === 0) {
    for (const [i, sk] of ['M4.FRAC.COMMON_DENOM', 'M4.FRAC.COMMON_DENOM', 'M4.FRAC.EQUIV'].entries()) {
      await svc.ledger.appendEvidence({
        id: `ev_seed_${Date.now()}_${i}`,
        childId: g4.childId,
        source: 'school_test',
        occurredAt: new Date(Date.now() - (6 - i) * 86_400_000).toISOString(),
        recordedAt: new Date().toISOString(),
        skillId: sk,
        result: { correct: false },
        reasoningQuality: 'weak',
        confidenceTier: 'A',
        provenance: 'assessment',
      });
    }
    await svc.learningState.invalidateDerived(g4.childId);
  }

  // a practice assignment + an exam for the grade-4 child
  await api.createPracticeAssignment(pAuth, g4.childId, { minutes: 15 }).catch(() => {});
  const exams = await api.listExams(pAuth, g4.childId);
  if (exams.length === 0) {
    const d = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    await api.createExam(pAuth, g4.childId, { examDate: d, subject: 'Toán', notes: 'Kiểm tra giữa kỳ (seed)' }).catch(() => {});
  }

  console.log('\n=== DạyZi pilot seed complete ===');
  console.log('Parent  :  phuhuynh@' + TAG + '  / pilotpass1234');
  console.log('Teacher :  giaovien@' + TAG + '  / pilotpass1234');
  console.log('Student :  ' + (studentEmail ?? '(pending)') + '  / hocsinh1234');
  console.log('Children:  Bé Lớp 4 (' + g4.childId + '), Bé Lớp 7 (' + g7.childId + ')');
  console.log('School  :  DạyZi Seed — THCS Thử Nghiệm  ·  classes SEED-7A1 (PRIMARY), SEED-HSG-Toan (HSG_TEAM)');
  console.log('Reset   :  node scripts/seed-pilot.mjs --reset');
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
