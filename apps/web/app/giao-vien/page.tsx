import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function TeacherStudents() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  const children = await getApi().teacherListChildren(teacherAuth());
  const pending = (await getApi().listRelationshipRequests(teacherAuth())).outbox.filter(
    (r) => r.status === 'PENDING',
  );

  return (
    <Screen nav={<TeacherNav active="students" />}>
      <h1 className="h1">Học sinh</h1>

      {children.length === 0 && (
        <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
          Chưa có học sinh nào được phụ huynh chấp thuận. Dùng mã kết nối phụ huynh gửi
          trong mục Kết nối.
        </p>
      )}

      {children.map((c) => (
        <Link
          key={c.childId}
          href={`/giao-vien/hoc-sinh/${c.childId}`}
          className="card"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, textDecoration: 'none' }}
        >
          <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
            {c.displayName}
            <span className="muted" style={{ display: 'block', fontWeight: 500 }}>
              {c.subjectId ? 'Có phân môn' : 'Chưa gắn môn'}
            </span>
          </span>
          <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>Xem ›</span>
        </Link>
      ))}

      {pending.length > 0 && (
        <p className="muted">{pending.length} yêu cầu kết nối đang chờ phụ huynh duyệt</p>
      )}
    </Screen>
  );
}
