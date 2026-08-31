import { childChallengeView } from '@/lib/child-scene';

export default function ChildChallenge() {
  const v = childChallengeView();
  return (
    <div className="child-dark">
      <div className="screen" style={{ background: 'transparent' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 18px' }}>
          <a href="/child" style={{ fontSize: 20, color: '#fff' }}>
            ‹
          </a>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Thử thách hôm nay</span>
          <span style={{ width: 20 }} />
        </div>
        <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          <div style={{ padding: 22, background: 'var(--c-surface-inverse-alt)', borderRadius: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span
              style={{
                alignSelf: 'flex-start',
                padding: '5px 11px',
                background: 'rgba(127,209,196,.16)',
                borderRadius: 9,
                fontSize: 11.5,
                fontWeight: 800,
                letterSpacing: '.06em',
                color: '#7fd1c4',
              }}
            >
              {v.badge}
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.55, color: '#fff' }}>{v.prompt}</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'rgba(255,255,255,.55)' }}>{v.instruction}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'rgba(255,255,255,.65)' }}>Con nghĩ thế nào?</span>
            <div
              style={{
                minHeight: 120,
                padding: 16,
                background: 'rgba(255,255,255,.07)',
                border: '1px solid rgba(255,255,255,.16)',
                borderRadius: 18,
                fontSize: 14.5,
                color: 'rgba(255,255,255,.45)',
              }}
            >
              Vì a = 2k, b = 3k nên…
            </div>
          </div>
        </div>
        <div style={{ padding: '12px 20px 30px' }}>
          <a href="/child/result" className="child-cta">
            Gửi cách nghĩ
          </a>
        </div>
      </div>
    </div>
  );
}
