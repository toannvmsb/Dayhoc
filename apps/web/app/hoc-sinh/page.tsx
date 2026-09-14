import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Screen, StudentNav } from '../components';
import { getApi, getViewer, studentAuth } from '@/lib/server/api';
import { logoutAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

const KIND_GLYPH: Record<string, string> = {
  practice: '⌗',
  review: '↻',
  challenge: '✦',
};

export default async function StudentToday() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('STUDENT')) redirect('/');

  const today = await getApi().studentGetToday(studentAuth());

  return (
    <Screen nav={<StudentNav active="home" />}>
      <div className="child-hero">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <span className="overline overline--onteal">Xin chào {today.greetingName}</span>
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="Đăng xuất"
              style={{
                background: 'rgba(255,255,255,.18)',
                border: 'none',
                borderRadius: 999,
                color: '#fff',
                fontSize: 12.5,
                fontWeight: 700,
                padding: '6px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              Đăng xuất
            </button>
          </form>
        </div>
        <h1 className="h1" style={{ color: '#fff' }}>Hôm nay của con</h1>
        <p style={{ margin: 0, color: 'rgba(255,255,255,.9)', fontSize: 14.5 }}>{today.summary}</p>
      </div>

      <div className="screen__body" style={{ gap: 12 }}>
        {today.tasks.length === 0 ? (
          <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
            Hôm nay con không có bài bắt buộc. Con có thể tự luyện thêm ở mục Bài tập nhé!
          </p>
        ) : (
          today.tasks.map((t) => (
            <Link
              key={t.assignmentId}
              href={`/bai/${t.assignmentId}`}
              className="child-task"
              style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}
            >
              <span style={{ fontSize: 22 }}>{KIND_GLYPH[t.kind] ?? '⌗'}</span>
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', color: 'var(--c-text-heading)' }}>{t.title}</b>
                <span className="muted">{t.subtitle}</span>
              </span>
              <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>Làm ›</span>
            </Link>
          ))
        )}

        {today.totalCount > 0 && (
          <p className="muted" style={{ textAlign: 'center' }}>
            Đã xong {today.doneCount}/{today.totalCount} việc hôm nay
          </p>
        )}
      </div>
    </Screen>
  );
}
