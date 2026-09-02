'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitPracticeAction } from '@/lib/server/actions';

type Item = {
  id: string;
  orderIndex: number;
  prompt: unknown;
  answerKind: string;
  options: string[] | null;
  hintCount: number;
};
type Detail = { id: string; status: string; mode: string; items: Item[] };

const HINT_LABEL = ['Gợi ý định hướng', 'Câu hỏi dẫn', 'Ví dụ đơn giản hơn', 'Thử lại', 'Lời giải đầy đủ', 'Lời giải đầy đủ'];

export function PracticeRunner({ assignmentId, detail }: { assignmentId: string; detail: Detail }) {
  const router = useRouter();
  const items = detail.items;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { answer: string; hintsUsed: number }>>({});
  const [hintOpen, setHintOpen] = useState(0);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  const item = items[i];
  const promptText = useMemo(() => {
    const p = item?.prompt as { text?: string } | string | undefined;
    return typeof p === 'string' ? p : (p?.text ?? '');
  }, [item]);

  if (!item || done) {
    return (
      <div className="screen">
        <div className="screen__body" style={{ justifyContent: 'center', textAlign: 'center', gap: 14 }}>
          <div style={{ fontSize: 44 }}>✓</div>
          <h1 className="h1">Xong rồi!</h1>
          <p style={{ color: 'var(--c-text-body)' }}>
            Con đã hoàn thành buổi luyện tập. DạyZi đã ghi nhận và sẽ cập nhật tiến độ.
          </p>
          <button className="cta" type="button" onClick={() => router.push('/')}>
            Về trang chính
          </button>
        </div>
      </div>
    );
  }

  const cur = answers[item.id] ?? { answer: '', hintsUsed: 0 };
  const setAns = (patch: Partial<{ answer: string; hintsUsed: number }>) =>
    setAnswers((a) => ({ ...a, [item.id]: { ...cur, ...patch } }));

  const isLast = i === items.length - 1;

  const submit = () =>
    start(async () => {
      try {
        await submitPracticeAction(
          assignmentId,
          items.map((it) => ({
            assignmentItemId: it.id,
            answer: (answers[it.id]?.answer ?? '').trim(),
            hintsUsed: answers[it.id]?.hintsUsed ?? 0,
          })),
        );
        setDone(true);
        router.refresh();
      } catch {
        setDone(true);
      }
    });

  return (
    <div className="screen">
      <div className="child-hero">
        <span className="overline overline--onteal">Câu {i + 1} / {items.length}</span>
        <div className="mixbar" style={{ background: 'rgba(255,255,255,.25)' }}>
          <div style={{ flex: i + 1, background: '#fff' }} />
          <div style={{ flex: items.length - i - 1 || 0.01, background: 'transparent' }} />
        </div>
      </div>
      <div className="screen__body" style={{ gap: 16 }}>
        <p className="child-q">{promptText}</p>

        {item.answerKind === 'choice' && item.options ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {item.options.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setAns({ answer: opt })}
                className="child-task"
                data-primary={cur.answer === opt}
                style={{ cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}
              >
                {opt}
              </button>
            ))}
          </div>
        ) : (
          <input
            value={cur.answer}
            onChange={(e) => setAns({ answer: e.target.value })}
            placeholder="Câu trả lời của con…"
            inputMode={item.answerKind === 'numeric' ? 'decimal' : 'text'}
            style={{
              height: 56,
              borderRadius: 16,
              border: '1px solid var(--c-border)',
              padding: '0 16px',
              fontSize: 19,
              fontFamily: 'inherit',
            }}
          />
        )}

        {item.hintCount > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {hintOpen > 0 && (
              <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
                {HINT_LABEL[Math.min(hintOpen - 1, HINT_LABEL.length - 1)]} — thử suy nghĩ theo hướng
                đơn giản hơn một chút.
              </p>
            )}
            {hintOpen < Math.min(item.hintCount, 2) && (
              <button
                type="button"
                onClick={() => {
                  setHintOpen((h) => h + 1);
                  setAns({ hintsUsed: hintOpen + 1 });
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--c-primary)',
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                Cần gợi ý?
              </button>
            )}
          </div>
        )}

        <button
          className="child-cta"
          type="button"
          disabled={pending || !cur.answer.trim()}
          onClick={() => {
            setHintOpen(0);
            if (isLast) submit();
            else setI((n) => n + 1);
          }}
        >
          {pending ? 'Đang lưu…' : isLast ? 'Nộp bài' : 'Câu tiếp theo'}
        </button>
      </div>
    </div>
  );
}
