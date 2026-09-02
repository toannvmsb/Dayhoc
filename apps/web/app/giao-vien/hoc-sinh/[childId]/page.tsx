import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

const PERM_LABEL: Record<string, string> = {
  VIEW_CLASS_CONTEXT: 'Xem bối cảnh lớp học',
  VIEW_LESSON_CONTEXT: 'Xem bài học hiện tại',
  VIEW_ASSIGNMENTS: 'Xem bài giao',
  VIEW_TWIN_SUMMARY: 'Xem tóm tắt mức độ nắm bài',
  VIEW_SELECTED_GAPS: 'Xem điểm cần củng cố (đã chọn)',
  SUBMIT_CURRENT_LESSON: 'Cập nhật bài đang dạy',
  SUBMIT_HOMEWORK: 'Cập nhật bài tập về nhà',
  SUBMIT_EXAM_NOTICE: 'Báo lịch kiểm tra',
};

const BAND_LABEL: Record<string, string> = {
  vững: 'Vững',
  đang_ổn_định: 'Đang ổn định',
  cần_củng_cố: 'Cần củng cố',
};

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export default async function TeacherStudentDetail({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  const children = await getApi().teacherListChildren(teacherAuth());
  const child = children.find((c) => c.childId === params.childId);
  if (!child) redirect('/giao-vien');

  const subjectId = child.subjectId ?? undefined;
  const [perms, twin, gaps] = await Promise.all([
    safe(getApi().teacherGetPermissions(teacherAuth(), params.childId, subjectId)),
    safe(getApi().teacherGetTwinSummary(teacherAuth(), params.childId, subjectId)),
    safe(getApi().teacherGetGaps(teacherAuth(), params.childId, subjectId)),
  ]);

  return (
    <Screen nav={<TeacherNav active="students" />}>
      <h1 className="h1">{child.displayName}</h1>

      <div className="card">
        <span className="overline">Quyền phụ huynh đã cấp</span>
        {(perms?.codes ?? []).length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
            Phụ huynh chưa cấp quyền xem thông tin học tập cá nhân.
          </p>
        ) : (
          perms!.codes.map((c) => (
            <div key={c} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>
              • {PERM_LABEL[c] ?? c}
            </div>
          ))
        )}
      </div>

      {twin ? (
        <div className="card">
          <span className="overline">Mức độ nắm bài</span>
          {twin.skills.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>Chưa đủ dữ liệu.</p>
          ) : (
            twin.skills.map((s) => (
              <div key={s.skillId} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>
                {s.skillId} — <b>{BAND_LABEL[s.band] ?? s.band}</b>
              </div>
            ))
          )}
        </div>
      ) : (
        <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)' }}>
          Bạn chưa được cấp quyền xem tóm tắt mức độ nắm bài.
        </p>
      )}

      {gaps && (
        <div className="card">
          <span className="overline">Điểm cần củng cố (phụ huynh chọn chia sẻ)</span>
          {gaps.gaps.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
              Không có điểm nào được chia sẻ.
            </p>
          ) : (
            gaps.gaps.map((g, i) => (
              <div key={i} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>• {g.skillId}</div>
            ))
          )}
        </div>
      )}

      <Link href="/giao-vien/cap-nhat" className="cta" style={{ textDecoration: 'none' }}>
        Cập nhật nội dung học tập
      </Link>
    </Screen>
  );
}
