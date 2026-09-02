'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  confirmExamScopeAction,
  createExamAction,
  recordExamResultAction,
} from '@/lib/server/actions';
import { SubmitButton } from '../../../ui';

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

export function CreateExamForm({ childId }: { childId: string }) {
  const [state, formAction] = useFormState(createExamAction, {} as { error?: string; examId?: string });
  const router = useRouter();
  useEffect(() => {
    if (state?.examId) router.push(`/be/${childId}/kiem-tra/${state.examId}`);
  }, [state, childId, router]);

  return (
    <form action={formAction} className="card" style={{ gap: 10 }}>
      <span className="overline">Khai báo kỳ kiểm tra</span>
      <input type="hidden" name="childId" value={childId} />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Ngày kiểm tra</span>
        <input name="examDate" type="date" required style={inp} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Môn</span>
        <input name="subject" defaultValue="Toán" style={inp} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--c-text-label)' }}>Ghi chú (phạm vi, hình thức…)</span>
        <textarea name="notes" rows={2} style={{ ...inp, height: 'auto', padding: 10 }} />
      </label>
      {state?.error && (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13 }}>{state.error}</p>
      )}
      <SubmitButton>Tạo bản đồ ôn tập</SubmitButton>
    </form>
  );
}

export function ScopeConfirm({
  childId,
  examId,
  items,
}: {
  childId: string;
  examId: string;
  items: { skillId: string; name: string }[];
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(items.map((i) => i.skillId)));
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="card card--attention" style={{ gap: 8 }}>
      <span className="overline overline--attention">DạyZi đoán phạm vi — bạn xác nhận giúp</span>
      {items.map((it) => (
        <label key={it.skillId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={checked.has(it.skillId)}
            onChange={(e) =>
              setChecked((s) => {
                const n = new Set(s);
                if (e.target.checked) n.add(it.skillId);
                else n.delete(it.skillId);
                return n;
              })
            }
          />
          <span style={{ color: 'var(--c-text-heading)' }}>{it.name}</span>
        </label>
      ))}
      <button
        type="button"
        className="cta"
        disabled={pending || checked.size === 0}
        onClick={() =>
          start(async () => {
            await confirmExamScopeAction(childId, examId, [...checked]);
            router.refresh();
          })
        }
      >
        {pending ? 'Đang lưu…' : 'Xác nhận phạm vi'}
      </button>
    </div>
  );
}

const SCORES = [
  { label: 'Sai', value: 0 },
  { label: 'Được một phần', value: 0.5 },
  { label: 'Đúng', value: 1 },
] as const;

export function RecordResult({
  childId,
  examId,
  items,
}: {
  childId: string;
  examId: string;
  items: { skillId: string; name: string }[];
}) {
  const [rows, setRows] = useState<Record<string, { score: number; reasoning?: 'weak' | 'adequate' | 'strong' }>>(
    () => Object.fromEntries(items.map((i) => [i.skillId, { score: 1 }])),
  );
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () =>
    start(async () => {
      const outcomes = items.map((it, i) => ({
        questionRef: `q${i + 1}`,
        skillId: it.skillId,
        awardedScore: rows[it.skillId]?.score ?? 1,
        ...(rows[it.skillId]?.reasoning ? { reasoningQuality: rows[it.skillId]!.reasoning! } : {}),
      }));
      await recordExamResultAction(childId, examId, outcomes);
      router.refresh();
    });

  return (
    <div className="card" style={{ gap: 10 }}>
      <span className="overline">Nhập kết quả từng phần</span>
      {items.map((it) => (
        <div key={it.skillId} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-heading)' }}>{it.name}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {SCORES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setRows((r) => ({ ...r, [it.skillId]: { ...r[it.skillId]!, score: s.value } }))}
                style={{
                  flex: 1,
                  padding: '7px 0',
                  borderRadius: 10,
                  border: `1px solid ${rows[it.skillId]?.score === s.value ? 'var(--c-primary)' : 'var(--c-border)'}`,
                  background: rows[it.skillId]?.score === s.value ? 'var(--c-primary-tint)' : 'var(--c-surface)',
                  color: 'var(--c-text-heading)',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="cta" disabled={pending} onClick={submit}>
        {pending ? 'Đang chẩn đoán…' : 'Xem chẩn đoán'}
      </button>
    </div>
  );
}
