import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { SchoolClassManager } from './client';

export const dynamic = 'force-dynamic';

const PRIVACY_LABEL: Record<string, string> = {
  PRIVATE_LEARNING: 'Chỉ mình bố mẹ — không giáo viên nào của lớp thấy dữ liệu học tập',
  LINKED_PRIVATE: 'Gắn với lớp, nhưng dữ liệu học tập vẫn riêng tư cho tới khi bố mẹ cấp quyền',
  LINKED_SHARED: 'Gắn với lớp và cho phép giáo viên phụ trách lớp cập nhật bài học/bài giao',
};

export default async function SchoolClass({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let enrollments;
  let years;
  try {
    [child, enrollments, years] = await Promise.all([
      getApi().getChild(parentAuth(), params.childId),
      getApi().listEnrollments(parentAuth(), params.childId),
      getApi().listAcademicYears(parentAuth()),
    ]);
  } catch {
    notFound();
  }

  const grade = 'schoolGrade' in child ? (child.schoolGrade as number) : 4;
  const activeYear = years.find((y) => y.status === 'ACTIVE') ?? years[0];
  const schoolRows = (enrollments.school ?? []) as unknown as Array<Record<string, unknown>>;
  const classRows = (enrollments.class ?? []) as unknown as Array<Record<string, unknown>>;

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/ho-so`} className="chip">‹ Hồ sơ con</Link>
      <h1 className="h1">Trường & lớp</h1>
      <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        Không bắt buộc. Khai báo trường/lớp giúp DạyZi ước lượng con đang học đến bài nào
        theo lịch năm học.
      </p>

      {schoolRows.length > 0 && (
        <div className="card">
          <span className="overline">Trường đang học</span>
          {schoolRows.map((s, i) => (
            <div key={i} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>
              {String(s.schoolName ?? s.schoolId ?? 'Trường')} · Lớp {String(s.grade ?? grade)} ·{' '}
              {String(s.status ?? '')}
            </div>
          ))}
        </div>
      )}

      {classRows.length > 0 && (
        <div className="card">
          <span className="overline">Lớp học</span>
          {classRows.map((c, i) => (
            <div key={i} style={{ fontSize: 13, color: 'var(--c-text-body)', paddingBottom: 4 }}>
              <b style={{ color: 'var(--c-text-heading)' }}>
                {String(c.className ?? c.classroomId ?? 'Lớp')} · {String(c.enrollmentType ?? 'PRIMARY')}
              </b>
              <span style={{ display: 'block' }}>
                {PRIVACY_LABEL[String(c.privacyMode ?? 'PRIVATE_LEARNING')]}
              </span>
            </div>
          ))}
        </div>
      )}

      <SchoolClassManager
        childId={params.childId}
        grade={grade}
        academicYearId={activeYear ? String(activeYear.id) : ''}
        academicYearLabel={activeYear?.label ?? ''}
        classEnrollments={classRows.map((c, i) => ({
          id: String(c.id ?? i),
          label: String(c.className ?? c.classroomId ?? 'Lớp'),
          privacyMode: String(c.privacyMode ?? 'PRIVATE_LEARNING'),
        }))}
        hasSchool={schoolRows.length > 0}
      />
    </Screen>
  );
}
