import { examRevisionView } from '@/lib/revision-scene';
import { BottomNav, Screen } from '../components';

export default function ExamRevision() {
  const v = examRevisionView();
  return (
    <Screen nav={<BottomNav active="more" />}>
      <div className="card--teal card" style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'rgba(255,255,255,.16)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>
          <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{v.dayCountdown}</span>
          <span style={{ fontSize: 11, color: '#bde6e0' }}>ngày</span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="overline overline--onteal">Kiểm tra {v.subject}</span>
          <span style={{ fontSize: 17, fontWeight: 800 }}>Thứ Sáu, {v.examDateLabel}</span>
          <span style={{ fontSize: 12.5, color: '#cdeae6' }}>Chế độ ôn tập đang bật</span>
        </div>
      </div>

      <div className="card card--attention">
        <span className="overline overline--attention">
          {v.scopeConfirmed ? 'Phạm vi đã xác nhận' : 'Chưa có phạm vi chính thức'}
        </span>
        <span style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--c-attention-heading)' }}>
          App suy ra phạm vi từ những gì con đã học gần đây. Bố mẹ xác nhận giúp:
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {v.scopeItems.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', background: '#fff', borderRadius: 12 }}>
              <span style={{ width: 19, height: 19, borderRadius: 6, background: s.confirmed ? 'var(--c-primary)' : 'transparent', border: s.confirmed ? 'none' : '2px solid #dcd3c6', color: '#fff', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {s.confirmed ? '✓' : ''}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--c-text-heading)' }}>{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span className="overline">Ưu tiên ôn</span>
          <span className="muted">{v.dailyMinutes} phút/ngày</span>
        </div>
        {v.priorityItems.map((it) => (
          <div key={it.name} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--c-text-heading)' }}>{it.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: it.bandLabel === 'Ưu tiên cao' ? 'var(--c-unstable-text)' : 'var(--c-text-muted)' }}>{it.bandLabel}</span>
            </div>
            <div style={{ height: 7, borderRadius: 4, background: '#f0ede6', overflow: 'hidden' }}>
              <div style={{ width: `${it.fillPercent}%`, height: '100%', background: it.bandLabel === 'Ưu tiên cao' ? 'var(--c-unstable-bar)' : 'var(--c-primary)' }} />
            </div>
          </div>
        ))}
      </div>

      {v.mockTest && (
        <div className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--c-primary-tint)', color: 'var(--c-primary-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>◫</span>
          <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--c-text-heading)' }}>{v.mockTest.label} · {v.mockTest.minutes} phút</span>
            <span className="muted">Giao cho con vào cuối tuần</span>
          </span>
          <span style={{ color: 'var(--c-primary)' }}>›</span>
        </div>
      )}
    </Screen>
  );
}
