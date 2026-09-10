'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useState, type ReactNode } from 'react';
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
  const [reveal, setReveal] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword && reveal ? 'text' : type;
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>{label}</span>
      <span style={{ position: 'relative', display: 'flex' }}>
        <input
          name={name}
          type={inputType}
          placeholder={placeholder}
          defaultValue={defaultValue}
          required={required}
          style={{
            flex: 1,
            height: 48,
            borderRadius: 'var(--r-input)',
            border: '1px solid var(--c-border)',
            padding: isPassword ? '0 46px 0 14px' : '0 14px',
            fontSize: 15,
            fontFamily: 'inherit',
            background: 'var(--c-surface)',
            color: 'var(--c-text-heading)',
          }}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
            style={{
              position: 'absolute',
              right: 4,
              top: 0,
              height: 48,
              width: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: 'var(--c-text-muted)',
              padding: 0,
            }}
          >
            <EyeIcon off={!reveal} />
          </button>
        )}
      </span>
    </label>
  );
}

/** Inline eye / eye-off glyph — no icon dependency in the web shell. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="4" y1="20" x2="20" y2="4" />}
    </svg>
  );
}

export interface LessonChapter {
  chapter: number;
  name: string;
  lessons: { lessonId: string; name: string }[];
}

/** "Con đang học đến bài nào?" — native select, grouped by SGK chapter. */
export function LessonPicker({ chapters, name = 'lessonId' }: { chapters: LessonChapter[]; name?: string }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>
        Con đang học đến bài nào? <span style={{ color: 'var(--c-attention-text)' }}>*</span>
      </span>
      <select
        name={name}
        required
        defaultValue=""
        style={{
          height: 48,
          borderRadius: 'var(--r-input)',
          border: '1px solid var(--c-border)',
          padding: '0 12px',
          fontSize: 15,
          fontFamily: 'inherit',
          background: 'var(--c-surface)',
          color: 'var(--c-text-heading)',
        }}
      >
        <option value="" disabled>
          — Chọn bài gần nhất con đã học trên lớp —
        </option>
        {chapters.map((ch) => (
          <optgroup key={ch.chapter} label={`Chương ${ch.chapter}. ${ch.name}`}>
            {ch.lessons.map((l) => (
              <option key={l.lessonId} value={l.lessonId}>
                {l.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="muted">
        DạyZi coi mọi bài trước đó là con đã học, và ra bài ôn tập đúng mức kiến thức hiện tại — không đoán.
      </span>
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
