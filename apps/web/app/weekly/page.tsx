import { weeklyReportView } from '@/lib/revision-scene';
import { BottomNav, Screen } from '../components';

const MIX_COLORS = ['var(--c-mix-school)', 'var(--c-mix-gap)', 'var(--c-mix-advanced)', 'var(--c-mix-thinking)'];
const MIX_LABELS = ['Bài trên lớp', 'Củng cố', 'Nâng cao', 'Tư duy'];

export default function WeeklyReport() {
  const v = weeklyReportView();
  const mix = [v.nextWeekMix.school, v.nextWeekMix.gapRepair, v.nextWeekMix.advanced, v.nextWeekMix.thinking];
  return (
    <Screen nav={<BottomNav active="more" />}>
      <h1 className="h1" style={{ fontSize: 'var(--fs-screen-title)' }}>
        {v.weekLabel}
      </h1>
      <div style={{ display: 'flex', gap: 10 }}>
        {v.stats.map((s) => (
          <div
            key={s.label}
            className="card"
            style={{ flex: 1, gap: 3, padding: 15, background: s.highlight ? 'var(--c-primary-tint)' : undefined, border: s.highlight ? 'none' : undefined }}
          >
            <span style={{ fontSize: 25, fontWeight: 800, lineHeight: 1.1, color: s.highlight ? 'var(--c-primary-strong)' : 'var(--c-text-heading)' }}>
              {s.value}
            </span>
            <span style={{ fontSize: 12, lineHeight: 1.4, color: s.highlight ? 'var(--c-on-primary-tint)' : 'var(--c-text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <span className="overline">Tiến bộ trong tuần</span>
        {v.progress.map((p, i) => (
          <div key={i} style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: 'var(--c-primary)' }}>↗</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--c-text-body-strong)' }}>{p}</span>
          </div>
        ))}
      </div>

      <div className="card card--attention">
        <span className="overline overline--attention">Cần theo tiếp</span>
        {v.needsFollowUp.map((n, i) => (
          <div key={i} style={{ display: 'flex', gap: 10 }}>
            <span style={{ color: 'var(--c-attention-dot)' }}>•</span>
            <span style={{ fontSize: 13.5, lineHeight: 1.5, color: 'var(--c-attention-heading)' }}>{n}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <span className="overline">Đề xuất phân bổ tuần tới</span>
        <div className="mixbar" style={{ marginTop: 2 }}>
          {mix.map((p, i) => (
            <div key={i} style={{ flex: p || 0.01, background: MIX_COLORS[i] }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 14px', marginTop: 4 }}>
          {MIX_LABELS.map((label, i) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--c-text-body-strong)' }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: MIX_COLORS[i] }} />
              {label} {mix[i]}%
            </span>
          ))}
        </div>
        <span className="muted" style={{ marginTop: 2 }}>
          {v.nextWeekNote}
        </span>
      </div>
    </Screen>
  );
}
