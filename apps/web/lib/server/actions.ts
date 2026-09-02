'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Pool } from 'pg';
import { getApi, parentAuth, preferredAuth, studentAuth, SESSION_COOKIE } from './api';

function db(): Pool {
  return (globalThis as unknown as { __dzPool: Pool }).__dzPool;
}

async function bearerFor(userId: string): Promise<string> {
  // dev + in-memory adapters use the users.auth_user_id as the bearer directly
  const r = await db().query<{ auth_user_id: string | null }>(
    'SELECT auth_user_id FROM users WHERE id = $1',
    [userId],
  );
  const b = r.rows[0]?.auth_user_id;
  if (!b) throw new Error('no auth token for this user (real IdP required — set SUPABASE_*)');
  return b;
}

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
  if (!email || password.length < 8) {
    return { error: 'Email hợp lệ và mật khẩu tối thiểu 8 ký tự.' };
  }
  try {
    const me = await getApi().register({ email, password, intendedRole: 'PARENT', displayName });
    setSession(await bearerFor(me.userId));
  } catch (e) {
    return { error: friendly(e) };
  }
  redirect('/');
}

export async function loginAction(_prev: FormState, form: FormData): Promise<FormState> {
  // Dev/local: resolve an existing account by email (no password store yet — real
  // auth is Supabase, ENV_REQUIRED). Production requires SUPABASE_* + a real login.
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_URL) {
    return { error: 'Đăng nhập cần cấu hình Supabase (ENV_REQUIRED).' };
  }
  const r = await db().query<{ id: string }>(
    'SELECT id FROM users WHERE lower(primary_email) = $1',
    [email],
  );
  if (!r.rows[0]) return { error: 'Không tìm thấy tài khoản với email này.' };
  try {
    setSession(await bearerFor(r.rows[0].id));
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
  const displayName = String(form.get('displayName') ?? '').trim() || undefined;
  if (!childId || password.length < 8) {
    return { error: 'Mật khẩu cho con tối thiểu 8 ký tự.' };
  }
  try {
    await getApi().createStudentAccess(parentAuth(), childId, {
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

function friendly(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/already exists|duplicate/i.test(msg)) return 'Email này đã được đăng ký.';
  if (/NO_SESSION/.test(msg)) return 'Phiên đăng nhập đã hết hạn.';
  if (/password too short/i.test(msg)) return 'Mật khẩu tối thiểu 8 ký tự.';
  return 'Có lỗi xảy ra, thử lại sau.';
}
