import { redirect } from 'next/navigation';
import { Screen, StudentNav } from '../../components';
import { getApi, getViewer, studentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function StudentProgress() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('STUDENT')) redirect('/');

  const p = await getApi().studentGetProgress(studentAuth());

  return (
    <Screen nav={<StudentNav active="progress" />}>
      <h1 className="h1">Tiến bộ của con</h1>

      <div className="card card--teal">
        <span className="overline overline--onteal">Cố gắng đều đặn</span>
        <p style={{ margin: 0, fontSize: 15, color: '#fff', fontWeight: 600 }}>{p.line}</p>
        <span style={{ color: 'rgba(255,255,255,.85)', fontSize: 13.5 }}>
          Đã hoàn thành {p.streakDone} buổi luyện
        </span>
      </div>

      <div className="card">
        <span className="overline">Con làm chắc</span>
        {p.solid.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
            Làm thêm vài bài để DạyZi thấy rõ điểm mạnh của con nhé.
          </p>
        ) : (
          p.solid.map((s, i) => (
            <div key={i} style={{ fontSize: 14, color: 'var(--c-text-heading)' }}>✓ {s}</div>
          ))
        )}
      </div>

      {p.growing.length > 0 && (
        <div className="card">
          <span className="overline">Đang tiến bộ</span>
          {p.growing.map((s, i) => (
            <div key={i} style={{ fontSize: 14, color: 'var(--c-text-body)' }}>→ {s}</div>
          ))}
        </div>
      )}
    </Screen>
  );
}
