import { childTodayView } from '@/lib/child-scene';
import { ChildNav, ChildScreen } from './components';

const GLYPH: Record<string, string> = { practice: '✎', review: '◍', challenge: '◆' };

export default function ChildToday() {
  const view = childTodayView();
  return (
    <ChildScreen nav={<ChildNav active="today" />}>
      <div className="child-hero">
        <span style={{ fontSize: 13.5, color: '#bde6e0' }}>{view.dateLabel}</span>
        <span className="child-hero__name">Chào {view.greetingName} 👋</span>
        <span style={{ fontSize: 14.5, lineHeight: 1.5, color: '#cdeae6' }}>{view.summary}</span>
      </div>
      <div style={{ padding: '18px 20px 0', display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {view.tasks.map((t, i) => (
          <div key={t.assignmentId} className="child-task" data-primary={i === 0}>
            <span
              style={{
                width: 46,
                height: 46,
                borderRadius: 14,
                background: t.kind === 'review' ? 'var(--c-attention-bg)' : 'var(--c-primary-tint)',
                color: t.kind === 'review' ? 'var(--c-attention-text)' : 'var(--c-primary-strong)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 19,
                flex: '0 0 auto',
              }}
            >
              {GLYPH[t.kind]}
            </span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span className="child-task__title">{t.title}</span>
              <span className="muted">
                {t.subtitle}
                {t.assignedBy === 'parent' ? ' · Bố mẹ giao' : ''}
              </span>
            </span>
          </div>
        ))}
        <div style={{ marginTop: 6, padding: 18, background: 'var(--c-surface-subtle)', borderRadius: 20, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--c-text-label)' }}>Việc hôm nay</span>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--c-text-heading)' }}>
              {view.doneCount}/{view.totalCount}
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: '#fff', overflow: 'hidden' }}>
            <div
              style={{
                width: `${view.totalCount ? Math.max(6, (view.doneCount / view.totalCount) * 100) : 6}%`,
                height: '100%',
                background: 'var(--c-primary)',
              }}
            />
          </div>
        </div>
      </div>
      <div style={{ padding: '12px 20px 14px' }}>
        <a href="/child/do" className="child-cta">
          Bắt đầu
        </a>
      </div>
    </ChildScreen>
  );
}
