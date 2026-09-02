'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPracticeAction } from '@/lib/server/actions';

export function CreatePracticeButton({ childId }: { childId: string }) {
  const [minutes, setMinutes] = useState(20);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="card" style={{ gap: 10 }}>
      <span className="overline">Tạo buổi luyện tập</span>
      <div style={{ display: 'flex', gap: 8 }}>
        {[10, 20, 30, 45].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMinutes(m)}
            style={{
              flex: 1,
              padding: '10px 0',
              borderRadius: 'var(--r-control)',
              border: `1px solid ${m === minutes ? 'var(--c-primary)' : 'var(--c-border)'}`,
              background: m === minutes ? 'var(--c-primary-tint)' : 'var(--c-surface)',
              color: 'var(--c-text-heading)',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {m}′
          </button>
        ))}
      </div>
      {err && <p style={{ margin: 0, fontSize: 13, color: 'var(--c-attention-text)' }}>{err}</p>}
      <button
        type="button"
        className="cta"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            try {
              await createPracticeAction(childId, minutes);
              router.refresh();
            } catch {
              setErr('Không tạo được bài. Thử lại sau.');
            }
          })
        }
      >
        {pending ? 'Đang soạn bài…' : `Tạo bài luyện tập ${minutes} phút`}
      </button>
      <span className="muted">
        DạyZi chọn nội dung theo trạng thái học của con. Bản thử nghiệm dùng ngân hàng
        câu hỏi soạn sẵn (chưa bật sinh đề bằng AI).
      </span>
    </div>
  );
}
