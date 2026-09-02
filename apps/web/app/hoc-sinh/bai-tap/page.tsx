import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Screen, StudentNav } from '../../components';
import { getApi, getViewer, studentAuth } from '@/lib/server/api';
import { StartPracticeButton } from './start-button';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Chưa làm',
  IN_PROGRESS: 'Đang làm',
  COMPLETED: 'Đã xong',
  CANCELLED: 'Đã huỷ',
};

export default async function StudentAssignments() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('STUDENT')) redirect('/');

  const list = await getApi().studentGetAssignments(studentAuth());
  const open = list.filter((a) => a.status !== 'COMPLETED' && a.status !== 'CANCELLED');
  const done = list.filter((a) => a.status === 'COMPLETED');

  return (
    <Screen nav={<StudentNav active="practice" />}>
      <h1 className="h1">Bài tập</h1>
      <StartPracticeButton />

      {open.length === 0 && (
        <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
          Con chưa có bài nào đang làm dở. Nhấn “Luyện 15 phút” để DạyZi soạn một buổi ngắn nhé.
        </p>
      )}

      {open.map((a) => (
        <Link
          key={a.id}
          href={`/bai/${a.id}`}
          className="child-task"
          style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
            Buổi luyện tập
            <span className="muted" style={{ display: 'block', fontWeight: 500 }}>
              {a.targetSkillIds.length} kỹ năng · {STATUS_LABEL[a.status] ?? a.status}
            </span>
          </span>
          <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>Làm ›</span>
        </Link>
      ))}

      {done.length > 0 && (
        <div className="card">
          <span className="overline">Đã hoàn thành</span>
          {done.map((a) => (
            <div key={a.id} style={{ fontSize: 13.5, color: 'var(--c-text-body)' }}>
              Buổi luyện tập — {a.completedAt?.slice(0, 10) ?? 'xong'}
            </div>
          ))}
        </div>
      )}
    </Screen>
  );
}
