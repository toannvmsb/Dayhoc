import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { CreateExamForm } from './client';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: 'Sắp tới',
  SCOPE_CONFIRMED: 'Đã xác nhận phạm vi',
  COMPLETED: 'Đã có kết quả',
  CANCELLED: 'Đã huỷ',
};

export default async function Exams({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let list;
  try {
    list = await getApi().listExams(parentAuth(), params.childId);
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}`} className="chip">‹ Trang chính</Link>
      <h1 className="h1">Kiểm tra &amp; ôn thi</h1>
      <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        Khai báo ngày kiểm tra, DạyZi lập bản đồ ôn tập theo mức độ ưu tiên. Sau kiểm tra,
        nhập điểm từng câu để biết con mất điểm vì <b>bất cẩn</b>, <b>hổng kiến thức</b>,
        hay <b>lập luận</b>…
      </p>

      <CreateExamForm childId={params.childId} />

      {list.length === 0 ? (
        <p className="muted">Chưa có kỳ kiểm tra nào.</p>
      ) : (
        list.map((e) => (
          <Link
            key={e.id}
            href={`/be/${params.childId}/kiem-tra/${e.id}`}
            className="card"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, textDecoration: 'none' }}
          >
            <span style={{ flex: 1 }}>
              <b style={{ color: 'var(--c-text-heading)' }}>{e.subject} · {e.examDate}</b>
              <span className="muted" style={{ display: 'block' }}>{STATUS_LABEL[e.status] ?? e.status}</span>
            </span>
            <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>
              {e.hasResult ? 'Xem chẩn đoán ›' : 'Bản đồ ôn tập ›'}
            </span>
          </Link>
        ))
      )}
    </Screen>
  );
}
