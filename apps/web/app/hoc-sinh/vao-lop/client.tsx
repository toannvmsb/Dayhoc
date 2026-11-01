'use client';

import { useFormState } from 'react-dom';
import { studentJoinClassAction, type JoinClassState } from '@/lib/server/actions';
import { SubmitButton } from '../../ui';

export function JoinClassForm() {
  const [state, action] = useFormState(studentJoinClassAction, {} as JoinClassState);
  return (
    <form action={action} className="card" style={{ gap: 12 }}>
      <label htmlFor="code" className="overline">Mã lớp</label>
      <input
        id="code"
        name="code"
        autoComplete="off"
        autoCapitalize="characters"
        placeholder="ABCD-EFGH"
        maxLength={12}
        style={{
          height: 48,
          borderRadius: 'var(--r-input)',
          border: '1px solid var(--c-border)',
          padding: '0 12px',
          fontSize: 20,
          letterSpacing: 2,
          textTransform: 'uppercase',
          fontFamily: 'inherit',
          background: 'var(--c-surface)',
          color: 'var(--c-text-heading)',
        }}
      />
      {state.error ? (
        <p role="alert" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-attention-text)' }}>{state.error}</p>
      ) : null}
      {state.message ? (
        <p role="status" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-heading)' }}>{state.message}</p>
      ) : null}
      <SubmitButton>Gửi cho bố mẹ</SubmitButton>
    </form>
  );
}
