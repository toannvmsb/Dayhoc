import { randomBytes } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * Student joins a classroom with a teacher's code (backlog B3-02, identity architecture §4.3 / §5).
 *
 * The code never enrols anyone by itself. Redeeming it creates a PROPOSED class enrolment with privacy
 * PRIVATE_LEARNING (the teacher receives nothing); the child's guardian approves or rejects it. The
 * teacher only ever sees aggregate counts, never which children asked.
 */

/** Unambiguous alphabet (no 0/O, 1/I): codes are read aloud and copied from a board. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;
export const JOIN_CODE_TTL_DAYS = 14;

export function newJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < JOIN_CODE_LENGTH; i += 1) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

/** "abcd-ef gh" → "ABCDEFGH". Returns null when it cannot be a code. */
export function normalizeJoinCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return c.length === JOIN_CODE_LENGTH && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export const formatJoinCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`;

export class ClassJoinError extends Error {
  constructor(
    readonly code: 'INVALID_CODE' | 'NOT_YOUR_CLASS' | 'NOT_FOUND' | 'ALREADY_DECIDED' | 'TOO_MANY_ATTEMPTS',
    message: string,
  ) {
    super(message);
    this.name = 'ClassJoinError';
  }
}

interface ClassroomLabelRow {
  classroom_id: string;
  grade: number;
  class_name: string;
  display_name: string | null;
  school_name: string;
}

const labelOf = (r: ClassroomLabelRow): string => `Lớp ${r.display_name ?? r.class_name} · ${r.school_name}`;

// ---------------------------------------------------------------------------
// teacher side
// ---------------------------------------------------------------------------

export interface TeacherClassRow {
  readonly classroomId: string;
  readonly label: string;
  readonly grade: number;
  readonly role: string;
  readonly code: { readonly code: string; readonly display: string; readonly expiresAt: string } | null;
  readonly pendingRequests: number;
  readonly approvedViaCode: number;
}

export async function teacherListClasses(pool: Pool, teacherUserId: string, now: Date): Promise<TeacherClassRow[]> {
  const { rows } = await pool.query<ClassroomLabelRow & { role: string }>(
    `SELECT c.id AS classroom_id, c.grade, c.class_name, c.display_name, s.official_name AS school_name, a.role
       FROM teacher_class_assignments a
       JOIN classrooms c ON c.id = a.classroom_id AND c.status = 'ACTIVE'
       JOIN schools s ON s.id = c.school_id
      WHERE a.teacher_user_id = $1 AND a.status = 'ACTIVE'
      ORDER BY s.official_name, c.grade, c.class_name`,
    [teacherUserId],
  );
  const out: TeacherClassRow[] = [];
  for (const r of rows) {
    const code = (
      await pool.query<{ code: string; expires_at: Date }>(
        `SELECT code, expires_at FROM classroom_join_codes
          WHERE classroom_id = $1 AND teacher_user_id = $2 AND revoked_at IS NULL AND expires_at > $3
          ORDER BY created_at DESC LIMIT 1`,
        [r.classroom_id, teacherUserId, now],
      )
    ).rows[0];
    const counts = (
      await pool.query<{ pending: string; approved: string }>(
        `SELECT count(*) FILTER (WHERE e.status = 'PROPOSED') AS pending,
                count(*) FILTER (WHERE e.status = 'ACTIVE')   AS approved
           FROM student_class_enrollments e
           JOIN classroom_join_codes j ON j.id = e.join_code_id
          WHERE e.classroom_id = $1 AND j.teacher_user_id = $2`,
        [r.classroom_id, teacherUserId],
      )
    ).rows[0]!;
    out.push({
      classroomId: r.classroom_id,
      label: labelOf(r),
      grade: r.grade,
      role: r.role,
      code: code ? { code: code.code, display: formatJoinCode(code.code), expiresAt: code.expires_at.toISOString() } : null,
      pendingRequests: Number(counts.pending),
      approvedViaCode: Number(counts.approved),
    });
  }
  return out;
}

/**
 * A teacher declares "I teach this class". It is SELF_DECLARED on purpose: it can only ever lead to a
 * PROPOSED enrolment that a parent must approve, and the parent sees the school + class it names.
 */
export async function teacherClaimClass(pool: Pool, teacherUserId: string, classroomId: string): Promise<{ assignmentId: string }> {
  const room = (
    await pool.query<{ academic_year_id: string }>(`SELECT academic_year_id FROM classrooms WHERE id = $1 AND status = 'ACTIVE'`, [classroomId])
  ).rows[0];
  if (!room) throw new ClassJoinError('NOT_FOUND', 'Không tìm thấy lớp.');
  const subject = (await pool.query<{ id: string }>(`SELECT id FROM subjects WHERE code = 'MATH' LIMIT 1`)).rows[0];
  if (!subject) throw new ClassJoinError('NOT_FOUND', 'Chưa có môn Toán trong hệ thống.');

  const existing = (
    await pool.query<{ id: string }>(
      `SELECT id FROM teacher_class_assignments
        WHERE teacher_user_id = $1 AND classroom_id = $2 AND subject_id = $3 AND status = 'ACTIVE' LIMIT 1`,
      [teacherUserId, classroomId, subject.id],
    )
  ).rows[0];
  if (existing) return { assignmentId: existing.id };

  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO teacher_class_assignments (teacher_user_id, classroom_id, academic_year_id, subject_id, role, status, verification_status)
     VALUES ($1, $2, $3, $4, 'SUBJECT_TEACHER', 'ACTIVE', 'SELF_DECLARED') RETURNING id`,
    [teacherUserId, classroomId, room.academic_year_id, subject.id],
  );
  return { assignmentId: inserted.rows[0]!.id };
}

async function assertTeachesClass(pool: Pool, teacherUserId: string, classroomId: string): Promise<void> {
  const r = await pool.query(
    `SELECT 1 FROM teacher_class_assignments WHERE teacher_user_id = $1 AND classroom_id = $2 AND status = 'ACTIVE' LIMIT 1`,
    [teacherUserId, classroomId],
  );
  if (r.rowCount === 0) throw new ClassJoinError('NOT_YOUR_CLASS', 'Bạn chưa được gắn với lớp này.');
}

/** One live code per (class, teacher): minting a new one retires the previous. */
export async function teacherCreateJoinCode(
  pool: Pool,
  teacherUserId: string,
  classroomId: string,
  now: Date,
): Promise<{ code: string; display: string; expiresAt: string }> {
  await assertTeachesClass(pool, teacherUserId, classroomId);
  await pool.query(
    `UPDATE classroom_join_codes SET revoked_at = $3
      WHERE classroom_id = $1 AND teacher_user_id = $2 AND revoked_at IS NULL`,
    [classroomId, teacherUserId, now],
  );
  const expiresAt = new Date(now.getTime() + JOIN_CODE_TTL_DAYS * 86_400_000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newJoinCode();
    const r = await pool.query(
      `INSERT INTO classroom_join_codes (code, classroom_id, teacher_user_id, expires_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO NOTHING`,
      [code, classroomId, teacherUserId, expiresAt],
    );
    if (r.rowCount === 1) return { code, display: formatJoinCode(code), expiresAt: expiresAt.toISOString() };
  }
  throw new Error('could not mint a unique join code');
}

export async function teacherRevokeJoinCode(pool: Pool, teacherUserId: string, classroomId: string, now: Date): Promise<void> {
  await assertTeachesClass(pool, teacherUserId, classroomId);
  await pool.query(
    `UPDATE classroom_join_codes SET revoked_at = $3
      WHERE classroom_id = $1 AND teacher_user_id = $2 AND revoked_at IS NULL`,
    [classroomId, teacherUserId, now],
  );
}

// ---------------------------------------------------------------------------
// student side
// ---------------------------------------------------------------------------

export interface JoinOutcome {
  readonly status: 'PENDING_PARENT' | 'ALREADY_PENDING' | 'ALREADY_MEMBER';
  readonly classLabel: string;
}

export async function studentRedeemCode(pool: Pool, childId: string, rawCode: string, now: Date): Promise<JoinOutcome> {
  const code = normalizeJoinCode(rawCode);
  // one message for every failure shape — a wrong guess must not reveal which part was wrong
  const invalid = new ClassJoinError('INVALID_CODE', 'Mã lớp chưa đúng hoặc đã hết hạn. Hỏi lại thầy/cô nhé.');
  if (!code) throw invalid;

  const row = (
    await pool.query<ClassroomLabelRow & { code_id: string; academic_year_id: string }>(
      `SELECT j.id AS code_id, c.id AS classroom_id, c.grade, c.class_name, c.display_name, c.academic_year_id,
              s.official_name AS school_name
         FROM classroom_join_codes j
         JOIN classrooms c ON c.id = j.classroom_id AND c.status = 'ACTIVE'
         JOIN schools s ON s.id = c.school_id
        WHERE j.code = $1 AND j.revoked_at IS NULL AND j.expires_at > $2`,
      [code, now],
    )
  ).rows[0];
  if (!row) throw invalid;
  const classLabel = labelOf(row);

  const existing = (
    await pool.query<{ status: string }>(
      `SELECT status FROM student_class_enrollments
        WHERE child_id = $1 AND classroom_id = $2 AND status IN ('PROPOSED','ACTIVE') LIMIT 1`,
      [childId, row.classroom_id],
    )
  ).rows[0];
  if (existing) return { status: existing.status === 'ACTIVE' ? 'ALREADY_MEMBER' : 'ALREADY_PENDING', classLabel };

  const hasPrimary = await childHasActivePrimary(pool, childId, row.academic_year_id);
  await pool.query(
    `INSERT INTO student_class_enrollments
       (child_id, classroom_id, academic_year_id, enrollment_type, privacy_mode, status, joined_at, source, join_code_id)
     VALUES ($1, $2, $3, $4, 'PRIVATE_LEARNING', 'PROPOSED', $5, 'STUDENT_JOIN_CODE', $6)`,
    [childId, row.classroom_id, row.academic_year_id, hasPrimary ? 'SUPPLEMENTARY' : 'PRIMARY', now, row.code_id],
  );
  return { status: 'PENDING_PARENT', classLabel };
}

async function childHasActivePrimary(pool: Pool, childId: string, academicYearId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM student_class_enrollments
      WHERE child_id = $1 AND academic_year_id = $2 AND enrollment_type = 'PRIMARY' AND status = 'ACTIVE' LIMIT 1`,
    [childId, academicYearId],
  );
  return (r.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// parent side
// ---------------------------------------------------------------------------

export interface JoinRequestRow {
  readonly enrollmentId: string;
  readonly classLabel: string;
  readonly grade: number;
  readonly teacherName: string | null;
  readonly requestedAt: string;
}

export async function parentListJoinRequests(pool: Pool, childId: string): Promise<JoinRequestRow[]> {
  const { rows } = await pool.query<ClassroomLabelRow & { id: string; joined_at: Date; teacher_name: string | null }>(
    `SELECT e.id, e.joined_at, c.id AS classroom_id, c.grade, c.class_name, c.display_name,
            s.official_name AS school_name, u.display_name AS teacher_name
       FROM student_class_enrollments e
       JOIN classrooms c ON c.id = e.classroom_id
       JOIN schools s ON s.id = c.school_id
       LEFT JOIN classroom_join_codes j ON j.id = e.join_code_id
       LEFT JOIN users u ON u.id = j.teacher_user_id
      WHERE e.child_id = $1 AND e.status = 'PROPOSED' AND e.source = 'STUDENT_JOIN_CODE'
      ORDER BY e.joined_at DESC`,
    [childId],
  );
  return rows.map((r) => ({
    enrollmentId: r.id,
    classLabel: labelOf(r),
    grade: r.grade,
    teacherName: r.teacher_name,
    requestedAt: r.joined_at.toISOString(),
  }));
}

/**
 * Approve → ACTIVE (re-checking the one-primary-class-per-year rule at decision time and falling back
 * to SUPPLEMENTARY if a primary class was added meanwhile). Reject → LEFT. Either way the enrolment
 * stays PRIVATE_LEARNING; sharing is a separate, explicit parent choice.
 */
export async function parentDecideJoinRequest(
  pool: Pool,
  childId: string,
  enrollmentId: string,
  approve: boolean,
  now: Date,
): Promise<{ status: 'ACTIVE' | 'LEFT' }> {
  const e = (
    await pool.query<{ status: string; enrollment_type: string; academic_year_id: string }>(
      `SELECT status, enrollment_type, academic_year_id FROM student_class_enrollments
        WHERE id = $1 AND child_id = $2 AND source = 'STUDENT_JOIN_CODE'`,
      [enrollmentId, childId],
    )
  ).rows[0];
  if (!e) throw new ClassJoinError('NOT_FOUND', 'Không tìm thấy yêu cầu này.');
  if (e.status !== 'PROPOSED') throw new ClassJoinError('ALREADY_DECIDED', 'Yêu cầu này đã được xử lý.');

  if (!approve) {
    await pool.query(`UPDATE student_class_enrollments SET status = 'LEFT', left_at = $2 WHERE id = $1`, [enrollmentId, now]);
    return { status: 'LEFT' };
  }
  const type =
    e.enrollment_type === 'PRIMARY' && (await childHasActivePrimary(pool, childId, e.academic_year_id)) ? 'SUPPLEMENTARY' : e.enrollment_type;
  await pool.query(`UPDATE student_class_enrollments SET status = 'ACTIVE', enrollment_type = $2, verified_at = NULL WHERE id = $1`, [
    enrollmentId,
    type,
  ]);
  return { status: 'ACTIVE' };
}
