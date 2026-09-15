import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';
import type { LessonChapter } from '../../ui';
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

  // "Bài đang dạy" / "Tiến độ chương trình" need a real SGK lesson picker
  // (not free text) so the contribution actually carries taughtSkillIds —
  // fetch the program for every grade among this teacher's accepted students.
  const grades = [...new Set(children.map((c) => c.schoolGrade))];
  const programs = await Promise.all(
    grades.map(async (g) => [g, (await getApi().teacherGetCurriculumProgram(teacherAuth(), g)) as { chapters: LessonChapter[] }] as const),
  );
  const programsByGrade: Record<number, LessonChapter[]> = Object.fromEntries(programs.map(([g, p]) => [g, p.chapters]));

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
            schoolGrade: c.schoolGrade,
          }))}
          subjects={subjects.map((s) => ({ id: s.id, name: s.name }))}
          programsByGrade={programsByGrade}
        />
      )}
    </Screen>
  );
}
