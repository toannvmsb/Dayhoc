'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import type { FormState } from '@/lib/server/actions';

export function SubmitButton({ children, onTeal }: { children: ReactNode; onTeal?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={onTeal ? 'cta cta--onteal' : 'cta'} type="submit" disabled={pending}>
      {pending ? 'Đang xử lý…' : children}
    </button>
  );
}

export function ActionForm({
  action,
  children,
  submitLabel,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  submitLabel: string;
}) {
  const [state, formAction] = useFormState(action, {});
  return (
    <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {children}
      {state?.error ? (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-attention-body)' }}>
          {state.error}
        </p>
      ) : null}
      <SubmitButton>{submitLabel}</SubmitButton>
    </form>
  );
}

export function Field({
  name,
  label,
  type = 'text',
  placeholder,
  defaultValue,
  required,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>{label}</span>
      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        style={{
          height: 48,
          borderRadius: 'var(--r-input)',
          border: '1px solid var(--c-border)',
          padding: '0 14px',
          fontSize: 15,
          fontFamily: 'inherit',
          background: 'var(--c-surface)',
          color: 'var(--c-text-heading)',
        }}
      />
    </label>
  );
}

export function GradePicker() {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Lớp của con</span>
      <div style={{ display: 'flex', gap: 8 }}>
        {[4, 7].map((g, i) => (
          <label key={g} style={{ flex: 1 }}>
            <input
              type="radio"
              name="schoolGrade"
              value={g}
              defaultChecked={i === 0}
              style={{ position: 'absolute', opacity: 0 }}
            />
            <span
              style={{
                display: 'block',
                textAlign: 'center',
                padding: '12px 0',
                borderRadius: 'var(--r-control)',
                border: '1px solid var(--c-border)',
                fontWeight: 700,
                color: 'var(--c-text-heading)',
              }}
            >
              Lớp {g}
            </span>
          </label>
        ))}
      </div>
      <span className="muted">Bản thử nghiệm hỗ trợ lớp 4 và lớp 7.</span>
    </fieldset>
  );
}
