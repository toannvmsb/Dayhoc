import Link from 'next/link';
import { getViewer } from '@/lib/server/api';
import { redirect } from 'next/navigation';
import { ActionForm, Field } from '../ui';
import { loginAction, registerAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

export default async function Welcome({
  searchParams,
}: {
  searchParams: { mode?: string };
}) {
  if (await getViewer()) redirect('/');
  const mode = searchParams.mode;
  const login = mode === 'login';
  const teacher = mode === 'teacher';

  return (
    <div className="screen">
      <div className="screen__body" style={{ justifyContent: 'center', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="overline">DạyZi</span>
          <h1 className="h1">{teacher ? 'DạyZi cho giáo viên' : 'Hôm nay dạy con gì?'}</h1>
          <p style={{ margin: 0, color: 'var(--c-text-body)', fontSize: 15, lineHeight: 1.55 }}>
            {teacher
              ? 'Cập nhật nội dung đã dạy và bài đã giao để phụ huynh đồng hành cùng con ở nhà. Giáo viên chỉ thấy phần phụ huynh cho phép.'
              : 'Hiểu con. Dạy đúng. Cùng con tiến bộ mỗi ngày. DạyZi giúp bố mẹ biết con đang học gì, đang vướng ở đâu, và hôm nay nên dạy như thế nào.'}
          </p>
        </div>

        {login ? (
          <ActionForm action={loginAction} submitLabel="Đăng nhập">
            <Field name="email" label="Email" type="email" required />
            <Field name="password" label="Mật khẩu" type="password" required />
          </ActionForm>
        ) : teacher ? (
          <ActionForm action={registerAction} submitLabel="Tạo tài khoản giáo viên">
            <input type="hidden" name="role" value="TEACHER" />
            <Field name="displayName" label="Tên giáo viên" placeholder="Thầy Nam" />
            <Field name="email" label="Email" type="email" required />
            <Field name="password" label="Mật khẩu (tối thiểu 8 ký tự)" type="password" required />
          </ActionForm>
        ) : (
          <ActionForm action={registerAction} submitLabel="Tạo tài khoản">
            <Field name="displayName" label="Tên bố / mẹ" placeholder="Chị Thu Hà" />
            <Field name="email" label="Email" type="email" required />
            <Field name="password" label="Mật khẩu (tối thiểu 8 ký tự)" type="password" required />
          </ActionForm>
        )}

        <p className="muted" style={{ textAlign: 'center' }}>
          {login ? (
            <>
              Chưa có tài khoản? <Link href="/welcome">Đăng ký</Link>
            </>
          ) : (
            <>
              Đã có tài khoản? <Link href="/welcome?mode=login">Đăng nhập</Link>
            </>
          )}
        </p>
        <p className="muted" style={{ textAlign: 'center' }}>
          {teacher ? (
            <Link href="/welcome">Tôi là phụ huynh</Link>
          ) : (
            <Link href="/welcome?mode=teacher">Tôi là giáo viên</Link>
          )}
        </p>
      </div>
    </div>
  );
}
