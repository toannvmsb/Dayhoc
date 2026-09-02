import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';
import { ContributionForm } from './form';

export const dynamic = 'force-dynamic';

export default async function TeacherUpdates() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  const [children, subjects] = await Promise.all([
    getApi().teacherListChildren(teacherAuth()),
    getApi().listSubjects(teacherAuth()),
  ]);

  return (
    <Screen nav={<TeacherNav active="updates" />}>
      <h1 className="h1">Cập nhật học tập</h1>
      <p className="muted">
        Thông tin bạn gửi là tín hiệu tham khảo giúp DạyZi hiểu lớp đang học đến đâu —
        không ghi đè hồ sơ học tập của học sinh.
      </p>
      {children.length === 0 ? (
        <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
          Chưa có học sinh nào được phụ huynh chấp thuận.
        </p>
      ) : (
        <ContributionForm
          students={children.map((c) => ({
            childId: c.childId,
            displayName: c.displayName,
            subjectId: c.subjectId,
          }))}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
        />
      )}
    </Screen>
  );
}
