'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import { createStudentAccessAction, revokeStudentAccessAction } from '@/lib/server/actions';
import { SubmitButton } from '../../../ui';

type Access = { loginEmail: string; status: string; createdAt: string } | null;

export function StudentAccess({ childId, access }: { childId: string; access: Access }) {
  const [state, formAction] = useFormState(createStudentAccessAction, {});
  const [pending, start] = useTransition();
  const [show, setShow] = useState(false);
  const router = useRouter();

  const active = access?.status === 'ACTIVE';

  return (
    <div className="card" style={{ gap: 10 }}>
      <span className="overline">Tài khoản của con</span>

      {active ? (
        <>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
            Con đăng nhập bằng email: <b>{access!.loginEmail}</b>
          </p>
          <button
            type="button"
            className="cta"
            style={{ background: 'var(--c-attention-text)' }}
            disabled={pending}
            onClick={() =>
              start(async () => {
                await revokeStudentAccessAction(childId);
                router.refresh();
              })
            }
          >
            {pending ? 'Đang thu hồi…' : 'Thu hồi quyền truy cập của con'}
          </button>
          <span className="muted">Thu hồi có hiệu lực ngay. Hồ sơ học tập của con không bị xoá.</span>
        </>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
            Tạo lối đăng nhập riêng để con tự xem bài tập và luyện tập. Con chỉ thấy
            phần dành cho học sinh — không thấy ghi chú của bố mẹ hay đánh giá của giáo viên.
          </p>
          {!show ? (
            <button type="button" className="cta" onClick={() => setShow(true)}>
              Tạo tài khoản cho con
            </button>
          ) : (
            <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input type="hidden" name="childId" value={childId} />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>
                  Tên hiển thị (không bắt buộc)
                </span>
                <input name="displayName" style={inp} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>
                  Mật khẩu cho con (tối thiểu 8 ký tự)
                </span>
                <input name="password" type="password" required style={inp} />
              </label>
              {state?.error && (
                <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{state.error}</p>
              )}
              {access?.status === 'ACTIVE' ? null : (
                <SubmitButton>Tạo lối đăng nhập</SubmitButton>
              )}
            </form>
          )}
          {access && access.status !== 'ACTIVE' && (
            <span className="muted">Quyền truy cập trước đó đã bị thu hồi ({access.createdAt.slice(0, 10)}).</span>
          )}
        </>
      )}
    </div>
  );
}

const inp: React.CSSProperties = {
  height: 44,
  borderRadius: 'var(--r-input)',
  border: '1px solid var(--c-border)',
  padding: '0 12px',
  fontSize: 14.5,
  fontFamily: 'inherit',
  background: 'var(--c-surface)',
  color: 'var(--c-text-heading)',
};
