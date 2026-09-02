'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  cancelChildDeletionAction,
  confirmChildDeletionAction,
  requestChildDeletionAction,
} from '@/lib/server/actions';
import { SubmitButton } from '../../../../ui';

export function DeletionFlow({
  childId,
  childName,
  state,
}: {
  childId: string;
  childName: string;
  state: 'REQUESTED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [formState, formAction] = useFormState(confirmChildDeletionAction, {} as { error?: string; done?: boolean });

  if (formState?.done) {
    return (
      <div className="card card--teal" style={{ gap: 10, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 15, color: '#fff', fontWeight: 700 }}>
          Đã xóa hồ sơ của {childName}.
        </p>
        <button type="button" className="cta cta--onteal" onClick={() => router.push('/be')}>
          Về danh sách con
        </button>
      </div>
    );
  }

  if (state === null || state === 'CANCELLED' || state === 'COMPLETED') {
    return (
      <button
        type="button"
        className="cta"
        style={{ background: 'var(--c-attention-text)' }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await requestChildDeletionAction(childId);
            router.refresh();
          })
        }
      >
        {pending ? 'Đang xử lý…' : 'Bắt đầu quy trình xóa'}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card" style={{ gap: 8 }}>
        <span className="overline">Bước cuối — xác nhận</span>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)' }}>
          Nhập chính xác tên hiển thị của con — <b>{childName}</b> — để xóa vĩnh viễn.
        </p>
        <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input type="hidden" name="childId" value={childId} />
          <input
            name="confirmName"
            placeholder={childName}
            autoComplete="off"
            style={{
              height: 46,
              borderRadius: 'var(--r-input)',
              border: '1px solid var(--c-attention-text)',
              padding: '0 12px',
              fontSize: 15,
              fontFamily: 'inherit',
            }}
          />
          {formState?.error && (
            <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{formState.error}</p>
          )}
          <SubmitButton>Xóa vĩnh viễn</SubmitButton>
        </form>
      </div>

      <button
        type="button"
        style={{
          border: '1px solid var(--c-border)',
          borderRadius: 12,
          padding: '10px 0',
          background: 'var(--c-surface)',
          color: 'var(--c-text-heading)',
          fontWeight: 700,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
        disabled={pending}
        onClick={() =>
          start(async () => {
            await cancelChildDeletionAction(childId);
            router.refresh();
          })
        }
      >
        Hủy — giữ lại hồ sơ của con
      </button>
    </div>
  );
}
