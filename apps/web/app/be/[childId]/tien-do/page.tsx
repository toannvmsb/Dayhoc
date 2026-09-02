import { notFound, redirect } from 'next/navigation';
import { ParentNav, ProgressRow, Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function Progress({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let view;
  try {
    view = await getApi().getParentProgress(parentAuth(), params.childId);
  } catch {
    notFound();
  }

  const Section = ({ title, rows }: { title: string; rows: typeof view.axes.knowledge }) =>
    rows.length === 0 ? null : (
      <div className="card">
        <span className="overline">{title}</span>
        {rows.map((r) => (
          <ProgressRow key={r.skillId} row={r} />
        ))}
      </div>
    );

  return (
    <Screen nav={<ParentNav childId={params.childId} active="progress" />}>
      <h1 className="h1">Tiến độ của {view.child.displayName}</h1>
      <p className="card" style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--c-text-body)' }}>
        {view.frontierInsight}
      </p>
      <Section title="Kiến thức" rows={view.axes.knowledge} />
      <Section title="Dạng bài" rows={view.axes.problemTypes} />
      <Section title="Tư duy" rows={view.axes.thinking} />
      {view.recentEvidence.length > 0 && (
        <div className="card">
          <span className="overline">Gần đây</span>
          {view.recentEvidence.map((e, i) => (
            <div key={i} style={{ fontSize: 13.5 }}>
              <b>{e.label}</b> — {e.detail} <span className="muted">· {e.source}</span>
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
