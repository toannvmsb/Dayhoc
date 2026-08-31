import { childResultView } from '@/lib/child-scene';
import { ChildNav, ChildScreen } from '../components';

export default function ChildResult() {
  const v = childResultView();
  return (
    <ChildScreen nav={<ChildNav active="practice" />}>
      <div style={{ padding: '20px 20px 0', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            padding: '26px 20px',
            background: 'var(--c-primary-tint)',
            borderRadius: 24,
          }}
        >
          <span
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--c-primary)',
              color: '#fff',
              fontSize: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✓
          </span>
          <span style={{ fontSize: 23, fontWeight: 800, color: 'var(--c-text-heading)', textAlign: 'center' }}>
            {v.headline}
          </span>
          <span style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--c-on-primary-tint)', textAlign: 'center' }}>
            {v.encouragement}
          </span>
        </div>

        {v.reviewItems.map((r) => (
          <div key={r.questionId} className="card" style={{ gap: 12 }}>
            <span className="overline overline--attention">Xem lại</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--c-text-heading)' }}>{r.prompt}</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {r.steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--c-primary)' }}>{i + 1}</span>
                  <span style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--c-text-body-strong)' }}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {v.reasoningPrompt && (
          <div className="card" style={{ gap: 11 }}>
            <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--c-text-heading)' }}>{v.reasoningPrompt}</span>
            {['Con tìm mẫu chung trước', 'Con nhân chéo rồi cộng', 'Con làm theo cách khác'].map((o) => (
              <span
                key={o}
                style={{
                  padding: '13px 14px',
                  background: 'var(--c-bg)',
                  border: '1px solid var(--c-border)',
                  borderRadius: 13,
                  fontSize: 14,
                  color: 'var(--c-text-body-strong)',
                }}
              >
                {o}
              </span>
            ))}
          </div>
        )}
      </div>
      <div style={{ padding: '12px 20px 30px', display: 'flex', gap: 10 }}>
        <a href="/child/do" style={{ width: 118 }} className="child-cta">
          Làm lại
        </a>
        <a href="/child" className="child-cta" style={{ flex: 1 }}>
          {v.nextLabel}
        </a>
      </div>
    </ChildScreen>
  );
}
