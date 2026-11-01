import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { SchoolClassManager } from './client';
import { decideClassJoinAction } from '@/lib/server/actions';

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
  let joinRequests;
  try {
    [child, enrollments, years, joinRequests] = await Promise.all([
      getApi().getChild(parentAuth(), params.childId),
      getApi().listEnrollments(parentAuth(), params.childId),
      getApi().listAcademicYears(parentAuth()),
      getApi().listClassJoinRequests(parentAuth(), params.childId),
    ]);
  } catch {
    notFound();
  }

  const grade = 'schoolGrade' in child ? (child.schoolGrade as number) : 4;
  const activeYear = years.find((y) => y.status === 'ACTIVE') ?? years[0];
  const schoolRows = (enrollments.school ?? []) as unknown as Array<Record<string, unknown>>;
  // a pending join request is decided in its own card below, not listed as a class yet
  const classRows = ((enrollments.class ?? []) as unknown as Array<Record<string, unknown>>).filter(
    (c) => String(c.status ?? '') !== 'PROPOSED',
  );

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/ho-so`} className="chip">‹ Hồ sơ con</Link>
      <h1 className="h1">Trường & lớp</h1>
      <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        Không bắt buộc. Khai báo trường/lớp giúp DạyZi ước lượng con đang học đến bài nào
        theo lịch năm học.
      </p>

      {joinRequests.requests.map((r) => (
        <div key={r.enrollmentId} className="card card--attention" data-testid="join-request" style={{ gap: 8 }}>
          <span className="overline">Con xin vào lớp</span>
          <b style={{ color: 'var(--c-text-heading)', fontSize: 14 }}>{r.classLabel}</b>
          <span style={{ fontSize: 12.5, color: 'var(--c-attention-body)', lineHeight: 1.5 }}>
            Con nhập mã lớp{r.teacherName ? ` của ${r.teacherName}` : ''}. Nếu bố mẹ đồng ý, con được gắn vào lớp này
            ở chế độ riêng tư — giáo viên chưa nhận được dữ liệu học tập nào của con.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { approve: '1', label: 'Đồng ý' },
              { approve: '0', label: 'Từ chối' },
            ].map((b) => (
              <form key={b.approve} action={decideClassJoinAction} style={{ flex: 1 }}>
                <input type="hidden" name="childId" value={params.childId} />
                <input type="hidden" name="enrollmentId" value={r.enrollmentId} />
                <input type="hidden" name="approve" value={b.approve} />
                <button
                  type="submit"
                  className="cta"
                  style={{ height: 40, fontSize: 13.5, ...(b.approve === '0' ? { background: 'var(--c-attention-text)' } : {}) }}
                >
                  {b.label}
                </button>
              </form>
            ))}
          </div>
        </div>
      ))}

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
