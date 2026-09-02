'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { confirmUploadAction } from '@/lib/server/actions';

type Candidate = { skillId: string; skillName: string; confidence: number };
type Item = {
  index: number;
  prompt: string;
  childAnswer: string | null;
  markedCorrect: boolean | null;
  autoSelected: boolean;
  skillCandidates: Candidate[];
};

type ItemState = { confirm: boolean; skillId: string; correct: boolean | null };

export function ReviewExtraction({
  childId,
  uploadId,
  documentType,
  items,
}: {
  childId: string;
  uploadId: string;
  documentType: string | null;
  items: Item[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const allSkills = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) for (const c of it.skillCandidates) m.set(c.skillId, c.skillName);
    return [...m.entries()];
  }, [items]);

  const [rows, setRows] = useState<Record<number, ItemState>>(() =>
    Object.fromEntries(
      items.map((it) => [
        it.index,
        {
          confirm: it.autoSelected,
          skillId: it.skillCandidates[0]?.skillId ?? '',
          correct: it.markedCorrect,
        } satisfies ItemState,
      ]),
    ),
  );

  const patch = (i: number, p: Partial<ItemState>) =>
    setRows((r) => ({ ...r, [i]: { ...r[i]!, ...p } }));

  const confirmedCount = Object.values(rows).filter((r) => r.confirm && r.skillId).length;

  const submit = () =>
    start(async () => {
      const corrections = items.map((it) => {
        const r = rows[it.index]!;
        return {
          index: it.index,
          confirm: r.confirm && !!r.skillId,
          ...(r.skillId ? { skillId: r.skillId } : {}),
          correct: r.correct,
        };
      });
      await confirmUploadAction(childId, uploadId, corrections);
      router.push(`/be/${childId}/tai-lieu/${uploadId}`);
      router.refresh();
    });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((it) => {
        const r = rows[it.index]!;
        return (
          <div key={it.index} className="card" style={{ gap: 8, opacity: r.confirm ? 1 : 0.62 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={r.confirm}
                onChange={(e) => patch(it.index, { confirm: e.target.checked })}
              />
              <span style={{ color: 'var(--c-text-heading)' }}>Câu {it.index + 1}</span>
            </label>
            <span style={{ fontSize: 13, color: 'var(--c-text-body)' }}>{it.prompt}</span>
            {it.childAnswer && (
              <span style={{ fontSize: 13, color: 'var(--c-text-body)' }}>
                Con trả lời: <b>{it.childAnswer}</b>
              </span>
            )}

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text-label)' }}>Kỹ năng</span>
              <select
                value={r.skillId}
                onChange={(e) => patch(it.index, { skillId: e.target.value })}
                style={{
                  height: 40,
                  borderRadius: 'var(--r-input)',
                  border: '1px solid var(--c-border)',
                  padding: '0 10px',
                  fontSize: 13,
                  fontFamily: 'inherit',
                }}
              >
                <option value="">— chọn kỹ năng —</option>
                {allSkills.map(([id, name]) => (
                  <option key={id} value={id}>{name}</option>
                ))}
              </select>
              {it.skillCandidates[0] && (
                <span className="muted" style={{ fontSize: 11.5 }}>
                  DạyZi đoán: {it.skillCandidates[0].skillName} (
                  {Math.round(it.skillCandidates[0].confidence * 100)}%)
                </span>
              )}
            </label>

            {documentType === 'GRADED_TEST' && (
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5 }}>
                {(
                  [
                    ['Đúng', true],
                    ['Sai', false],
                    ['Không rõ', null],
                  ] as const
                ).map(([label, val]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => patch(it.index, { correct: val })}
                    style={{
                      flex: 1,
                      padding: '6px 0',
                      borderRadius: 10,
                      border: `1px solid ${r.correct === val ? 'var(--c-primary)' : 'var(--c-border)'}`,
                      background: r.correct === val ? 'var(--c-primary-tint)' : 'var(--c-surface)',
                      color: 'var(--c-text-heading)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <button type="button" className="cta" onClick={submit} disabled={pending}>
        {pending ? 'Đang ghi nhận…' : `Xác nhận ${confirmedCount} mục`}
      </button>
      <span className="muted">
        Bạn có thể xác nhận 0 mục — khi đó không có gì được ghi vào hồ sơ.
      </span>
    </div>
  );
}
