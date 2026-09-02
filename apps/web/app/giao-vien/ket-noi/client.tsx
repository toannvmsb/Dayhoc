'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  acceptRelationshipRequestAction,
  redeemInviteCodeAction,
  rejectRelationshipRequestAction,
} from '@/lib/server/actions';
import { SubmitButton } from '../../ui';

export function RedeemCode() {
  const [state, formAction] = useFormState(redeemInviteCodeAction, {} as { error?: string });
  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
      <input
        name="code"
        placeholder="VD: 9F3A2C7B1E4D"
        required
        style={{
          height: 46,
          borderRadius: 'var(--r-input)',
          border: '1px solid var(--c-border)',
          padding: '0 12px',
          fontSize: 15,
          fontFamily: 'inherit',
          letterSpacing: 1,
          textTransform: 'uppercase',
        }}
      />
      {state?.error && (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{state.error}</p>
      )}
      <SubmitButton>Gửi yêu cầu kết nối</SubmitButton>
    </form>
  );
}

export function RequestRow({
  id,
  label,
  actionable,
}: {
  id: string;
  label: string;
  actionable: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: (id: string) => Promise<void>) =>
    start(async () => {
      await fn(id);
      router.refresh();
    });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}>
      <span style={{ flex: 1, color: 'var(--c-text-heading)' }}>{label}</span>
      {actionable && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(acceptRelationshipRequestAction)}
            style={btn('var(--c-primary)')}
          >
            Chấp thuận
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => run(rejectRelationshipRequestAction)}
            style={btn('var(--c-border)')}
          >
            Từ chối
          </button>
        </>
      )}
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    border: 'none',
    borderRadius: 10,
    padding: '6px 10px',
    background: bg,
    color: bg === 'var(--c-border)' ? 'var(--c-text-heading)' : '#fff',
    fontWeight: 700,
    fontSize: 12.5,
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
