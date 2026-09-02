import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function TeacherClasses() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  const [children, subjects, years] = await Promise.all([
    getApi().teacherListChildren(teacherAuth()),
    getApi().listSubjects(teacherAuth()),
    getApi().listAcademicYears(teacherAuth()),
  ]);
  const subjectName = new Map(subjects.map((s) => [String(s.id), s.name]));
  const activeYear = years.find((y) => y.status === 'ACTIVE');

  const bySubject = new Map<string, string[]>();
  for (const c of children) {
    const key = c.subjectId
      ? (subjectName.get(String(c.subjectId)) ?? String(c.subjectId))
      : 'Chưa gắn môn';
    bySubject.set(key, [...(bySubject.get(key) ?? []), c.displayName]);
  }

  return (
    <Screen nav={<TeacherNav active="classes" />}>
      <h1 className="h1">Lớp học</h1>
      {activeYear && <p className="muted">Năm học {activeYear.label}</p>}

      {bySubject.size === 0 ? (
        <p className="card" style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>
          Chưa có học sinh nào. Khi phụ huynh chấp thuận kết nối, học sinh sẽ hiện ở đây
          theo môn bạn dạy.
        </p>
      ) : (
        [...bySubject.entries()].map(([subject, names]) => (
          <div key={subject} className="card">
            <span className="overline">{subject}</span>
            {names.map((n, i) => (
              <div key={i} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>• {n}</div>
            ))}
          </div>
        ))
      )}

      <p className="muted">
        Danh sách lớp chính thức lấy từ kết nối trường. Bản thử nghiệm hiển thị học sinh
        theo từng kết nối phụ huynh đã chấp thuận.
      </p>
    </Screen>
  );
}
