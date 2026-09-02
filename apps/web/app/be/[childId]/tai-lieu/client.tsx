'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useFormState } from 'react-dom';
import { createUploadAction } from '@/lib/server/actions';
import { SubmitButton } from '../../../ui';

const KINDS = [
  { value: 'NOTEBOOK_PAGE', label: 'Trang vở' },
  { value: 'GRADED_TEST', label: 'Bài kiểm tra đã chấm' },
  { value: 'HOMEWORK', label: 'Bài tập về nhà' },
  { value: 'TEACHER_MESSAGE', label: 'Tin nhắn của giáo viên' },
  { value: 'OTHER', label: 'Khác' },
];

export function UploadForm({ childId }: { childId: string }) {
  const [state, formAction] = useFormState(createUploadAction, {} as { error?: string; uploadId?: string });
  const router = useRouter();

  useEffect(() => {
    if (state?.uploadId) router.push(`/be/${childId}/tai-lieu/${state.uploadId}`);
  }, [state, childId, router]);

  return (
    <form action={formAction} className="card" style={{ gap: 10 }}>
      <span className="overline">Tải tài liệu mới</span>
      <input type="hidden" name="childId" value={childId} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Loại tài liệu</span>
        <select
          name="kind"
          defaultValue="NOTEBOOK_PAGE"
          style={{
            height: 44,
            borderRadius: 'var(--r-input)',
            border: '1px solid var(--c-border)',
            padding: '0 12px',
            fontSize: 14.5,
            fontFamily: 'inherit',
          }}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>{k.label}</option>
          ))}
        </select>
      </label>
      <input
        type="file"
        name="file"
        accept="image/*,application/pdf"
        required
        style={{ fontSize: 13.5 }}
      />
      {state?.error && (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{state.error}</p>
      )}
      <SubmitButton>Tải lên &amp; đọc thử</SubmitButton>
    </form>
  );
}
