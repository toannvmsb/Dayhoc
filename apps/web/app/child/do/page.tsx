import { childFirstQuestionView } from '@/lib/child-scene';
import { ChildNav, ChildScreen } from '../components';

export default function ChildDoQuestion() {
  const q = childFirstQuestionView();
  if (!q) {
    return (
      <ChildScreen nav={<ChildNav active="practice" />}>
        <div style={{ padding: 24 }}>Hôm nay chưa có bài tập.</div>
      </ChildScreen>
    );
  }
  return (
    <ChildScreen nav={<ChildNav active="practice" />}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 20px 16px' }}>
        <span style={{ fontSize: 20 }}>✕</span>
        <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--c-border)', overflow: 'hidden' }}>
          <div style={{ width: `${(q.index / q.total) * 100}%`, height: '100%', background: 'var(--c-primary)' }} />
        </div>
        <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--c-text-heading)' }}>
          {q.index}/{q.total}
        </span>
      </div>

      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        <div className="card" style={{ padding: 22, borderRadius: 22 }}>
          <span className="overline">Câu {q.index}</span>
          <span className="child-q">{q.prompt}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--c-text-label)' }}>Câu trả lời của con</span>
          <div
            style={{
              minHeight: 60,
              display: 'flex',
              alignItems: 'center',
              padding: '16px 18px',
              background: 'var(--c-surface)',
              border: '2px solid var(--c-primary)',
              borderRadius: 18,
              color: 'var(--c-text-faint)',
              fontSize: 15,
            }}
          >
            {q.answerKind === 'reasoning' ? 'Viết cách con nghĩ…' : q.answerKind === 'fraction' ? 'Nhập tử số / mẫu số' : 'Nhập câu trả lời'}
          </div>
        </div>

        {q.revealedHints.length > 0 && (
          <div className="card card--attention" style={{ gap: 8 }}>
            <span className="overline overline--attention">Gợi ý cho con</span>
            {q.revealedHints.map((h, i) => (
              <span key={i} style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--c-attention-heading)' }}>
                {h.text}
              </span>
            ))}
          </div>
        )}
        {q.canRequestHint && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: 16,
              background: 'var(--c-attention-bg)',
              border: '1px solid var(--c-attention-border)',
              borderRadius: 18,
            }}
          >
            <span style={{ flex: 1, fontSize: 14.5, fontWeight: 700, color: 'var(--c-attention-heading)' }}>
              Con cần gợi ý tiếp?
            </span>
            <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--c-attention-text)' }}>Mở ›</span>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 20px 30px' }}>
        <a href="/child/result" className="child-cta">
          Kiểm tra
        </a>
      </div>
    </ChildScreen>
  );
}
