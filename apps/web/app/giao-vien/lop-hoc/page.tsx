import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';
import { teacherCreateJoinCodeAction, teacherRevokeJoinCodeAction } from '@/lib/server/actions';
import { ClaimClass } from './claim-class';

export const dynamic = 'force-dynamic';

export default async function TeacherClasses() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  const [children, subjects, years, myClasses] = await Promise.all([
    getApi().teacherListChildren(teacherAuth()),
    getApi().listSubjects(teacherAuth()),
    getApi().listAcademicYears(teacherAuth()),
    getApi().teacherListClasses(teacherAuth()),
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

      <span className="overline">Mã tham gia lớp</span>
      {myClasses.classes.map((c) => (
        <div key={c.classroomId} className="card" data-testid="class-card" style={{ gap: 8 }}>
          <b style={{ color: 'var(--c-text-heading)', fontSize: 14 }}>{c.label}</b>
          {c.code ? (
            <>
              <span
                data-testid="join-code"
                style={{ fontSize: 28, fontWeight: 800, letterSpacing: 3, color: 'var(--c-primary)' }}
              >
                {c.code.display}
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Hết hạn {new Date(c.code.expiresAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}. Học sinh nhập mã ở mục
                &quot;Vào lớp&quot;; bố mẹ phải đồng ý thì con mới vào lớp.
              </span>
            </>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>Chưa có mã đang dùng.</span>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Đang chờ bố mẹ duyệt: {c.pendingRequests} · Đã vào lớp: {c.approvedViaCode}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <form action={teacherCreateJoinCodeAction} style={{ flex: 1 }}>
              <input type="hidden" name="classroomId" value={c.classroomId} />
              <button type="submit" className="cta" style={{ height: 40, fontSize: 13.5 }}>
                {c.code ? 'Tạo mã mới' : 'Tạo mã lớp'}
              </button>
            </form>
            {c.code ? (
              <form action={teacherRevokeJoinCodeAction}>
                <input type="hidden" name="classroomId" value={c.classroomId} />
                <button type="submit" className="chip" style={{ height: 40 }}>Thu hồi</button>
              </form>
            ) : null}
          </div>
        </div>
      ))}
      <ClaimClass />

      <p className="muted">
        Danh sách lớp chính thức lấy từ kết nối trường. Bản thử nghiệm hiển thị học sinh
        theo từng kết nối phụ huynh đã chấp thuận.
      </p>
    </Screen>
  );
}
