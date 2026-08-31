import { demoScene } from '@/lib/demo-scene';
import { BottomNav, ProgressRow, Screen } from '../components';

export default function ParentProgress() {
  const { progress } = demoScene();
  const sections: { title: string; rows: typeof progress.axes.knowledge }[] = [
    { title: 'Kiến thức', rows: progress.axes.knowledge },
    { title: 'Dạng bài', rows: progress.axes.problemTypes },
    { title: 'Tư duy', rows: progress.axes.thinking },
  ];
  return (
    <Screen nav={<BottomNav active="progress" />}>
      <h1 className="h1" style={{ fontSize: 'var(--fs-screen-title)' }}>
        Tiến bộ · {progress.child.displayName}
      </h1>
      <div className="card" style={{ background: 'var(--c-primary-tint)', border: 'none' }}>
        <span style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--c-text-heading)' }}>
          {progress.frontierInsight}
        </span>
      </div>
      {sections
        .filter((s) => s.rows.length > 0)
        .map((s) => (
          <div key={s.title} className="card" style={{ gap: 13 }}>
            <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
              {s.title}
            </span>
            {s.rows.map((row) => (
              <ProgressRow key={row.skillId} row={row} />
            ))}
          </div>
        ))}
      <div className="card">
        <span className="overline" style={{ color: 'var(--c-text-faint)' }}>
          Căn cứ gần đây
        </span>
        {progress.recentEvidence.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
            <span
              style={{
                width: 8,
                height: 8,
                marginTop: 5,
                borderRadius: '50%',
                background: e.source === 'app' ? 'var(--c-primary)' : 'var(--c-text-disabled)',
                flex: '0 0 auto',
              }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--c-text-heading)' }}>{e.label}</span>
              <span className="muted">{e.detail}</span>
            </span>
          </div>
        ))}
      </div>
    </Screen>
  );
}
