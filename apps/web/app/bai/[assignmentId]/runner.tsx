'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { submitPracticeAction, type PracticeResultItem } from '@/lib/server/actions';

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

function promptTextOf(p: unknown): string {
  const v = p as { text?: string } | string | undefined;
  return typeof v === 'string' ? v : (v?.text ?? '');
}

/** "Con làm đúng X/Y câu" — anh's core-loop spec §4: the child must see
 * correct/incorrect per question, not just a generic "done" message. */
function ResultScreen({ items, results, onFinish }: { items: Item[]; results: readonly PracticeResultItem[]; onFinish: () => void }) {
  const byId = new Map(results.map((r) => [r.assignmentItemId, r]));
  // reasoning items (verificationLevel AI_CROSSCHECK_REQUIRED) have no known
  // right/wrong yet — never claim correctness for those (only count graded ones).
  const graded = results.filter((r) => r.verificationLevel !== 'AI_CROSSCHECK_REQUIRED');
  const correctCount = graded.filter((r) => r.correct === true).length;
  const total = graded.length;
  const headline =
    total === 0 ? 'Con đã gửi cách nghĩ' : correctCount === total ? `Con làm đúng cả ${total} câu` : `Con làm đúng ${correctCount}/${total} câu`;
  const encouragement = total === 0 || correctCount === total ? 'Rất tốt! Con nắm chắc phần này rồi.' : 'Cùng xem lại vài câu để lần sau chắc hơn nhé.';

  return (
    <div className="screen">
      <div className="screen__body" style={{ gap: 14 }}>
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <div style={{ fontSize: 44 }}>{total === 0 || correctCount === total ? '✓' : '✍️'}</div>
          <h1 className="h1">{headline}</h1>
          <p style={{ color: 'var(--c-text-body)', margin: '4px 0 0' }}>{encouragement}</p>
        </div>

        {items.map((it, idx) => {
          const r = byId.get(it.id);
          if (!r || r.verificationLevel === 'AI_CROSSCHECK_REQUIRED') return null;
          const ok = r.correct === true;
          return (
            <div key={it.id} className="card" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 18, lineHeight: 1.4 }}>{ok ? '✓' : '✗'}</span>
              <span style={{ flex: 1 }}>
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>Câu {idx + 1}</span>
                <span style={{ fontSize: 14, color: 'var(--c-text-heading)', display: 'block' }}>{promptTextOf(it.prompt)}</span>
                {!ok && r.expectedAnswer && (
                  <span style={{ fontSize: 13.5, color: 'var(--c-primary-strong)', fontWeight: 700, display: 'block', marginTop: 4 }}>
                    Đáp án đúng: {r.expectedAnswer}
                  </span>
                )}
              </span>
            </div>
          );
        })}

        <button className="cta" type="button" onClick={onFinish}>
          Về trang chính
        </button>
      </div>
    </div>
  );
}

export function PracticeRunner({ assignmentId, detail }: { assignmentId: string; detail: Detail }) {
  const router = useRouter();
  const items = detail.items;
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Record<string, { answer: string; hintsUsed: number }>>({});
  const [hintOpen, setHintOpen] = useState(0);
  const [pending, start] = useTransition();
  const [results, setResults] = useState<readonly PracticeResultItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const item = items[i];
  const promptText = useMemo(() => promptTextOf(item?.prompt), [item]);

  if (results) {
    return <ResultScreen items={items} results={results} onFinish={() => router.push('/')} />;
  }

  if (!item || failed) {
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
        const res = await submitPracticeAction(
          assignmentId,
          items.map((it) => ({
            assignmentItemId: it.id,
            answer: (answers[it.id]?.answer ?? '').trim(),
            hintsUsed: answers[it.id]?.hintsUsed ?? 0,
          })),
        );
        setResults(res.results);
        router.refresh();
      } catch {
        setFailed(true);
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
