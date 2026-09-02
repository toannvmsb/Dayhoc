import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../components';
import { getViewer } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function TeacherAssignments() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  return (
    <Screen nav={<TeacherNav active="assignments" />}>
      <h1 className="h1">Bài giao</h1>
      <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        Giao bài trực tiếp cho học sinh qua DạyZi chưa được bật trong bản thử nghiệm
        (chức năng sinh đề bằng AI đang tắt). Hiện tại bạn có thể cập nhật <b>bài tập về
        nhà</b> đã giao ở mục “Cập nhật học tập” để phụ huynh biết và đồng hành cùng con.
      </p>
    </Screen>
  );
}
