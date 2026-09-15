'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getApi, parentAuth, preferredAuth, studentAuth, teacherAuth, SESSION_COOKIE } from './api';

function setSession(bearer: string): void {
  cookies().set(SESSION_COOKIE, bearer, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export interface FormState {
  readonly error?: string;
}

export async function registerAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const displayName = String(form.get('displayName') ?? '').trim() || undefined;
  const intendedRole = String(form.get('role') ?? '') === 'TEACHER' ? 'TEACHER' : 'PARENT';
  if (!email || password.length < 8) {
    return { error: 'Email hợp lệ và mật khẩu tối thiểu 8 ký tự.' };
  }
  try {
    await getApi().register({ email, password, intendedRole, displayName });
    const { bearer } = await getApi().signIn({ email, password });
    setSession(bearer);
  } catch (e) {
    return { error: friendly(e) };
  }
  redirect('/');
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  const typed = String(form.get('email') ?? '').trim().toLowerCase();
  // `password` is optional on the wire (dev/in-memory backends still log in by
  // email alone); a real Supabase backend needs it and `signIn` says so.
  const password = form.get('password') !== null ? String(form.get('password')) : undefined;
  if (!typed) return { error: 'Nhập email hoặc tên đăng nhập.' };
  // a child logs in with a plain username the parent chose (P-03) — the
  // identity core is email-shaped internally, so a bare username (no "@")
  // is the student login form; parents/teachers still type a real email.
  const email = typed.includes('@') ? typed : `${typed}@dayzi.local`;
  if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL) {
    return { error: 'Đăng nhập cần cấu hình Supabase (ENV_REQUIRED).' };
  }
  try {
    const { bearer } = await getApi().signIn({ email, ...(password !== undefined ? { password } : {}) });
    setSession(bearer);
  } catch (e) {
    return { error: friendly(e) };
  }
  redirect('/');
}

export async function logoutAction(): Promise<void> {
  cookies().delete(SESSION_COOKIE);
  redirect('/welcome');
}

export async function createChildAction(_prev: FormState, form: FormData): Promise<FormState> {
  const displayName = String(form.get('displayName') ?? '').trim();
  const schoolGrade = Number(form.get('schoolGrade'));
  if (!displayName || !(schoolGrade === 4 || schoolGrade === 7)) {
    return { error: 'Nhập tên con và chọn lớp (pilot: lớp 4 hoặc lớp 7).' };
  }
  let childId: string;
  try {
    const child = await getApi().createChild(parentAuth(), { displayName, schoolGrade });
    childId = child.childId;
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath('/');
  // onboarding step 2 — pin where the child actually is before showing "hôm nay".
  redirect(`/be/${childId}/bat-dau`);
}

export async function setLearningStartAction(_prev: FormState, form: FormData): Promise<FormState> {
  const childId = String(form.get('childId') ?? '');
  const lessonId = String(form.get('lessonId') ?? '').trim();
  const schoolName = String(form.get('schoolName') ?? '').trim();
  const className = String(form.get('className') ?? '').trim();
  if (!childId || !lessonId) {
    return { error: 'Chọn bài con đang học đến để DạyZi tính đúng nội dung ôn tập.' };
  }
  try {
    await getApi().setChildLearningStart(parentAuth(), childId, {
      lessonId,
      ...(schoolName ? { schoolName } : {}),
      ...(className ? { className } : {}),
    });
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath(`/be/${childId}`);
  redirect(`/be/${childId}`);
}

export async function createPracticeAction(childId: string, minutes: number): Promise<void> {
  await getApi().createPracticeAssignment(parentAuth(), childId, { minutes });
  revalidatePath(`/be/${childId}/bai-tap`);
  revalidatePath(`/be/${childId}`);
}

export async function submitPracticeAction(
  assignmentId: string,
  answers: ReadonlyArray<{ assignmentItemId: string; answer: string; hintsUsed?: number }>,
): Promise<{ ok: true }> {
  await getApi().submitPractice(await preferredAuth(), assignmentId, answers);
  return { ok: true };
}

export async function createStudentAccessAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const childId = String(form.get('childId') ?? '');
  const password = String(form.get('password') ?? '');
  const username = String(form.get('username') ?? '').trim().toLowerCase();
  const displayName = String(form.get('displayName') ?? '').trim() || undefined;
  if (!childId || password.length < 8) {
    return { error: 'Mật khẩu cho con tối thiểu 8 ký tự.' };
  }
  if (!username || !/^[a-z][a-z0-9_]{2,19}$/.test(username)) {
    return { error: 'Tên đăng nhập cần 3-20 ký tự (chữ/số/gạch dưới), bắt đầu bằng chữ cái.' };
  }
  try {
    await getApi().createStudentAccess(parentAuth(), childId, {
      username,
      password,
      ...(displayName ? { displayName } : {}),
    });
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath(`/be/${childId}/ho-so`);
  return {};
}

export async function revokeStudentAccessAction(childId: string): Promise<void> {
  await getApi().revokeStudentAccess(parentAuth(), childId);
  revalidatePath(`/be/${childId}/ho-so`);
}

/** Student builds their own short practice session. Returns the assignment to open. */
export async function createStudentPracticeAction(
  minutes: number,
): Promise<{ assignmentId: string | null }> {
  const me = await getApi().studentGetMe(studentAuth());
  const res = await getApi().createPracticeAssignment(studentAuth(), me.childId, { minutes });
  revalidatePath('/hoc-sinh');
  revalidatePath('/hoc-sinh/bai-tap');
  return { assignmentId: res.assignmentIds[0] ?? null };
}

// ---- PARENT: plan & child-profile deletion (M7) -------------------------

export async function setPlanAction(plan: string): Promise<void> {
  await getApi().setPlan(parentAuth(), plan);
  revalidatePath('/goi-dich-vu');
  revalidatePath('/');
}

export async function requestChildDeletionAction(childId: string): Promise<void> {
  await getApi().requestChildDeletion(parentAuth(), childId);
  revalidatePath(`/be/${childId}/cai-dat`);
}

export async function cancelChildDeletionAction(childId: string): Promise<void> {
  await getApi().cancelChildDeletion(parentAuth(), childId);
  revalidatePath(`/be/${childId}/cai-dat`);
}

export async function confirmChildDeletionAction(
  _prev: FormState & { done?: boolean },
  form: FormData,
): Promise<FormState & { done?: boolean }> {
  const childId = String(form.get('childId') ?? '');
  const confirmName = String(form.get('confirmName') ?? '');
  if (!childId || !confirmName) return { error: 'Nhập đúng tên của con để xác nhận.' };
  try {
    await getApi().confirmChildDeletion(parentAuth(), childId, confirmName);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/does not match|chưa khớp/.test(msg)) return { error: 'Tên không khớp. Nhập đúng tên hiển thị của con.' };
    return { error: friendly(e) };
  }
  return { done: true };
}

// ---- PARENT: exam intelligence (M6) -------------------------------------

export async function createExamAction(
  _prev: FormState & { examId?: string },
  form: FormData,
): Promise<FormState & { examId?: string }> {
  const childId = String(form.get('childId') ?? '');
  const examDate = String(form.get('examDate') ?? '').trim();
  const subject = String(form.get('subject') ?? '').trim() || 'Toán';
  const notes = String(form.get('notes') ?? '').trim() || undefined;
  if (!childId || !examDate) return { error: 'Chọn ngày kiểm tra.' };
  try {
    const res = await getApi().createExam(parentAuth(), childId, {
      examDate,
      subject,
      ...(notes ? { notes } : {}),
    });
    revalidatePath(`/be/${childId}/kiem-tra`);
    return { examId: res.examId };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export async function confirmExamScopeAction(
  childId: string,
  examId: string,
  skillIds: string[],
): Promise<void> {
  await getApi().confirmExamScope(parentAuth(), childId, examId, skillIds);
  revalidatePath(`/be/${childId}/kiem-tra/${examId}`);
}

export async function recordExamResultAction(
  childId: string,
  examId: string,
  outcomes: ReadonlyArray<{
    questionRef: string;
    skillId: string;
    awardedScore: number;
    reasoningQuality?: 'weak' | 'adequate' | 'strong';
  }>,
): Promise<{ ok: true }> {
  await getApi().recordExamResult(parentAuth(), childId, examId, outcomes);
  revalidatePath(`/be/${childId}/kiem-tra/${examId}`);
  revalidatePath(`/be/${childId}`);
  return { ok: true };
}

// ---- PARENT: evidence upload (M4) ----------------------------------------

const UPLOAD_KINDS = ['NOTEBOOK_PAGE', 'GRADED_TEST', 'HOMEWORK', 'TEACHER_MESSAGE', 'OTHER'] as const;

export async function createUploadAction(
  _prev: FormState & { uploadId?: string },
  form: FormData,
): Promise<FormState & { uploadId?: string }> {
  const childId = String(form.get('childId') ?? '');
  const kindRaw = String(form.get('kind') ?? 'NOTEBOOK_PAGE');
  const kind = (UPLOAD_KINDS as readonly string[]).includes(kindRaw)
    ? (kindRaw as (typeof UPLOAD_KINDS)[number])
    : 'NOTEBOOK_PAGE';
  const file = form.get('file');
  if (!childId || !(file instanceof File) || file.size === 0) {
    return { error: 'Chọn một ảnh hoặc file PDF của con.' };
  }
  if (file.size > 12 * 1024 * 1024) return { error: 'File tối đa 12MB.' };
  const contentBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');
  try {
    const res = await getApi().createUpload(parentAuth(), childId, {
      kind,
      filename: file.name || 'upload',
      mimeType: file.type || 'application/octet-stream',
      contentBase64,
    });
    // kick off the (mock, free) analysis immediately
    await getApi().runUploadAnalysis(parentAuth(), childId, res.uploadId).catch(() => undefined);
    revalidatePath(`/be/${childId}/tai-lieu`);
    return { uploadId: res.uploadId };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export async function runUploadAnalysisAction(childId: string, uploadId: string): Promise<void> {
  await getApi().runUploadAnalysis(parentAuth(), childId, uploadId);
  revalidatePath(`/be/${childId}/tai-lieu/${uploadId}`);
  revalidatePath(`/be/${childId}/tai-lieu`);
}

export async function confirmUploadAction(
  childId: string,
  uploadId: string,
  corrections: ReadonlyArray<{ index: number; confirm: boolean; skillId?: string; correct?: boolean | null }>,
): Promise<{ evidenceRecorded: number }> {
  const res = await getApi().confirmUploadAnalysis(parentAuth(), childId, uploadId, corrections);
  revalidatePath(`/be/${childId}/tai-lieu`);
  revalidatePath(`/be/${childId}`);
  return { evidenceRecorded: res.evidenceRecorded };
}

// ---- PARENT: relationships & permissions ----------------------------------

export async function createInviteCodeAction(
  _prev: FormState & { code?: string },
  form: FormData,
): Promise<FormState & { code?: string }> {
  const childId = String(form.get('childId') ?? '');
  const subjectId = String(form.get('subjectId') ?? '') || undefined;
  if (!childId) return { error: 'Thiếu hồ sơ con.' };
  try {
    const res = await getApi().createInviteCode(parentAuth(), {
      childId,
      ...(subjectId ? { subjectId } : {}),
    });
    revalidatePath(`/be/${childId}/ket-noi`);
    return { code: res.code };
  } catch (e) {
    return { error: friendly(e) };
  }
}

export async function revokeTeacherLinkAction(childId: string, linkId: string): Promise<void> {
  await getApi().revokeTeacherChildLink(parentAuth(), linkId);
  revalidatePath(`/be/${childId}/ket-noi`);
}

export async function updateTeacherPermissionsAction(
  childId: string,
  linkId: string,
  grant: string[],
  revoke: string[],
): Promise<void> {
  await getApi().updateTeacherLinkPermissions(parentAuth(), childId, linkId, {
    grant: grant as never,
    revoke: revoke as never,
  });
  revalidatePath(`/be/${childId}/ket-noi`);
}

export async function acceptRequestAsParentAction(childId: string, requestId: string): Promise<void> {
  await getApi().acceptRelationshipRequest(parentAuth(), requestId);
  revalidatePath(`/be/${childId}/ket-noi`);
}

export async function rejectRequestAsParentAction(childId: string, requestId: string): Promise<void> {
  await getApi().rejectRelationshipRequest(parentAuth(), requestId);
  revalidatePath(`/be/${childId}/ket-noi`);
}

// ---- PARENT: school / class ----------------------------------------------

export async function proposeSchoolAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const officialName = String(form.get('officialName') ?? '').trim();
  const province = String(form.get('province') ?? '').trim() || undefined;
  const district = String(form.get('district') ?? '').trim() || undefined;
  const childId = String(form.get('childId') ?? '');
  if (!officialName) return { error: 'Nhập tên trường.' };
  try {
    await getApi().proposeSchool(parentAuth(), {
      officialName,
      ...(province ? { province } : {}),
      ...(district ? { district } : {}),
    });
  } catch (e) {
    return { error: friendly(e) };
  }
  if (childId) revalidatePath(`/be/${childId}/truong-lop`);
  return {};
}

export async function searchSchoolsAction(
  nameFragment: string,
): Promise<{ id: string; officialName: string; province: string | null; district: string | null }[]> {
  if (nameFragment.trim().length < 2) return [];
  const rows = await getApi().searchSchools(parentAuth(), { nameFragment: nameFragment.trim() });
  return rows.map((s) => ({
    id: String(s.id),
    officialName: s.officialName,
    province: s.province ?? null,
    district: s.district ?? null,
  }));
}

export async function listClassroomsAction(
  schoolId: string,
  academicYearId: string,
): Promise<{ id: string; grade: number; className: string; displayName: string }[]> {
  const rows = await getApi().listClasses(parentAuth(), schoolId, academicYearId);
  return rows.map((c) => ({
    id: String(c.id),
    grade: c.grade,
    className: c.className,
    displayName: c.displayName ?? c.className,
  }));
}

export async function createSchoolEnrollmentAction(
  childId: string,
  input: { schoolId: string; academicYearId: string; grade: number },
): Promise<void> {
  await getApi().createSchoolEnrollment(parentAuth(), childId, input);
  revalidatePath(`/be/${childId}/truong-lop`);
  revalidatePath(`/be/${childId}`);
}

export async function proposeClassAction(
  schoolId: string,
  academicYearId: string,
  grade: number,
  className: string,
): Promise<{ id: string; className: string }> {
  const res = await getApi().proposeClass(parentAuth(), schoolId, { academicYearId, grade, className });
  return { id: res.id, className: res.className };
}

export async function createClassEnrollmentAction(
  childId: string,
  input: {
    classroomId: string;
    academicYearId: string;
    enrollmentType: 'PRIMARY' | 'SUPPLEMENTARY' | 'HSG_TEAM' | 'TUTOR_GROUP';
    privacyMode: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED';
  },
): Promise<void> {
  await getApi().createClassEnrollment(parentAuth(), childId, input);
  revalidatePath(`/be/${childId}/truong-lop`);
}

export async function setClassPrivacyAction(
  childId: string,
  classEnrollmentId: string,
  privacyMode: 'PRIVATE_LEARNING' | 'LINKED_PRIVATE' | 'LINKED_SHARED',
): Promise<void> {
  await getApi().setClassPrivacy(parentAuth(), childId, classEnrollmentId, privacyMode);
  revalidatePath(`/be/${childId}/truong-lop`);
}

// ---- TEACHER ---------------------------------------------------------------

export async function teacherSubmitContributionAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const childId = String(form.get('childId') ?? '');
  const subjectId = String(form.get('subjectId') ?? '');
  const contributionType = String(form.get('contributionType') ?? 'CURRENT_LESSON') as
    | 'CURRENT_LESSON'
    | 'CURRICULUM_PROGRESS'
    | 'HOMEWORK'
    | 'EXAM_NOTICE';
  const note = String(form.get('note') ?? '').trim();
  const examDate = String(form.get('examDate') ?? '').trim();
  const taughtSkillIds = String(form.get('taughtSkillIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!childId || !subjectId) return { error: 'Chọn học sinh và môn học.' };
  if ((contributionType === 'CURRENT_LESSON' || contributionType === 'CURRICULUM_PROGRESS') && taughtSkillIds.length === 0) {
    return { error: 'Chọn bài lớp đang học.' };
  }

  const observedAt = new Date().toISOString();
  try {
    await getApi().teacherSubmitContribution(teacherAuth(), childId, {
      subjectId,
      contributionType,
      observedAt,
      ...((contributionType === 'CURRENT_LESSON' || contributionType === 'CURRICULUM_PROGRESS') && taughtSkillIds.length > 0
        ? { taughtSkillIds }
        : {}),
      ...(contributionType === 'HOMEWORK' && note
        ? { homeworkRefs: note.split(',').map((s) => s.trim()).filter(Boolean) }
        : {}),
      ...(contributionType === 'EXAM_NOTICE' && examDate
        ? { examRef: { date: examDate, ...(note ? { scopeNote: note } : {}) } }
        : {}),
    });
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath('/giao-vien/cap-nhat');
  return {};
}

export async function acceptRelationshipRequestAction(requestId: string): Promise<void> {
  await getApi().acceptRelationshipRequest(teacherAuth(), requestId);
  revalidatePath('/giao-vien/ket-noi');
  revalidatePath('/giao-vien');
}

export async function rejectRelationshipRequestAction(requestId: string): Promise<void> {
  await getApi().rejectRelationshipRequest(teacherAuth(), requestId);
  revalidatePath('/giao-vien/ket-noi');
}

export async function redeemInviteCodeAction(_prev: FormState, form: FormData): Promise<FormState> {
  const code = String(form.get('code') ?? '').trim().toUpperCase();
  if (!code) return { error: 'Nhập mã kết nối từ phụ huynh.' };
  try {
    await getApi().redeemInviteCode(teacherAuth(), code);
  } catch (e) {
    return { error: friendly(e) };
  }
  revalidatePath('/giao-vien/ket-noi');
  return {};
}

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/already exists|duplicate/i.test(msg)) return 'Email này đã được đăng ký.';
  if (/NO_SESSION/.test(msg)) return 'Phiên đăng nhập đã hết hạn.';
  if (/password too short/i.test(msg)) return 'Mật khẩu tối thiểu 8 ký tự.';
  // `signIn` already returns user-safe Vietnamese for the credential cases
  // (wrong password, cần mật khẩu, tài khoản không tồn tại) — pass those
  // through instead of flattening them to the generic line below.
  if (/mật khẩu|tài khoản|đăng nhập/i.test(msg)) return msg;
  return 'Có lỗi xảy ra, thử lại sau.';
}
