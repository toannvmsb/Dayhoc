import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { ReviewExtraction } from './client';

export const dynamic = 'force-dynamic';

export default async function UploadReview({
  params,
}: {
  params: { childId: string; uploadId: string };
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let analysis;
  try {
    analysis = await getApi().getUploadAnalysis(parentAuth(), params.childId, params.uploadId);
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/tai-lieu`} className="chip">‹ Tài liệu</Link>
      <h1 className="h1">Xem lại nội dung</h1>

      {analysis.state === 'FAILED' && (
        <p className="card card--attention" style={{ margin: 0, fontSize: 13.5 }}>
          Không đọc được tài liệu này ({analysis.errorMessage ?? 'lỗi xử lý'}). Bạn thử
          chụp lại rõ hơn và tải lên lần nữa nhé.
        </p>
      )}

      {['READING', 'ANALYZING', 'UPLOADED', 'MAPPED'].includes(analysis.state) && (
        <p className="card" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
          DạyZi đang đọc tài liệu… tải lại trang sau vài giây.
        </p>
      )}

      {analysis.state === 'CONFIRMED' && (
        <p className="card card--teal" style={{ margin: 0, fontSize: 14, color: '#fff' }}>
          Đã xác nhận. {analysis.evidenceRecorded} mục được ghi vào hồ sơ học tập của con
          (mức &ldquo;hỗ trợ / khá chắc&rdquo;, không phải &ldquo;đã kiểm chứng&rdquo;).
        </p>
      )}

      {analysis.state === 'NEEDS_CONFIRMATION' && (
        <>
          <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
            DạyZi đọc được {analysis.items.length} câu. Ô đã tích là phần DạyZi khá chắc.
            Bỏ tích những câu không đúng, hoặc chọn lại kỹ năng. Chỉ mục bạn xác nhận mới
            được ghi nhận.
          </p>
          {analysis.teacherNote && (
            <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)' }}>
              Ghi chú của giáo viên trên trang: &ldquo;{analysis.teacherNote}&rdquo;
            </p>
          )}
          <ReviewExtraction
            childId={params.childId}
            uploadId={params.uploadId}
            documentType={analysis.documentType}
            items={analysis.items}
          />
        </>
      )}
    </Screen>
  );
}
