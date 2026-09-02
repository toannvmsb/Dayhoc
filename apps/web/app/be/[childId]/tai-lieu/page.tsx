import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { UploadForm } from './client';

export const dynamic = 'force-dynamic';

const STATE_LABEL: Record<string, string> = {
  UPLOAD_CREATED: 'Vừa tải lên',
  UPLOADED: 'Đã nhận',
  READING: 'Đang đọc',
  ANALYZING: 'Đang phân tích',
  MAPPED: 'Đã nhận dạng',
  NEEDS_CONFIRMATION: 'Cần bạn xác nhận',
  CONFIRMED: 'Đã xác nhận',
  FAILED: 'Không xử lý được',
};

const KIND_LABEL: Record<string, string> = {
  NOTEBOOK_PAGE: 'Trang vở',
  GRADED_TEST: 'Bài kiểm tra đã chấm',
  HOMEWORK: 'Bài tập về nhà',
  TEACHER_MESSAGE: 'Tin nhắn của giáo viên',
  OTHER: 'Khác',
};

export default async function Uploads({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let list;
  try {
    list = await getApi().listUploads(parentAuth(), params.childId);
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}`} className="chip">‹ Trang chính</Link>
      <h1 className="h1">Tải bài của con</h1>
      <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        Chụp trang vở, bài kiểm tra đã chấm hay bài tập về nhà. DạyZi đọc thử và đề xuất
        — <b>bạn xem lại và xác nhận</b> trước khi nó được ghi nhận vào hồ sơ học tập.
        Nội dung mờ/không chắc sẽ không tự động được coi là đúng.
      </p>

      <UploadForm childId={params.childId} />

      {list.length === 0 ? (
        <p className="muted">Chưa có tài liệu nào.</p>
      ) : (
        list.map((u) => (
          <Link
            key={u.id}
            href={`/be/${params.childId}/tai-lieu/${u.id}`}
            className="card"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, textDecoration: 'none' }}
          >
            <span style={{ flex: 1 }}>
              <b style={{ color: 'var(--c-text-heading)' }}>
                {KIND_LABEL[u.kind] ?? u.kind}
              </b>
              <span className="muted" style={{ display: 'block' }}>
                {STATE_LABEL[u.state] ?? u.state}
                {u.itemCount > 0 ? ` · ${u.itemCount} câu` : ''}
                {u.state === 'FAILED' && u.errorMessage ? ` · ${u.errorMessage}` : ''}
              </span>
            </span>
            <span
              style={{
                color: u.state === 'NEEDS_CONFIRMATION' ? 'var(--c-primary)' : 'var(--c-text-body)',
                fontWeight: 700,
              }}
            >
              {u.state === 'NEEDS_CONFIRMATION' ? 'Xem lại ›' : '›'}
            </span>
          </Link>
        ))
      )}
    </Screen>
  );
}
