import { redirect } from 'next/navigation';
import { ParentNav, Screen } from '../../../components';
import { getViewer } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function Connect({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  return (
    <Screen nav={<ParentNav childId={params.childId} active="connect" />}>
      <h1 className="h1">Kết nối giáo viên</h1>
      <p className="card" style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--c-text-body)' }}>
        Bố mẹ vẫn có thể sử dụng đầy đủ DạyZi mà không cần kết nối giáo viên.
      </p>
      <div className="card">
        <span className="overline">Cách kết nối</span>
        <div style={{ fontSize: 13.5, color: 'var(--c-text-body)', lineHeight: 1.6 }}>
          Bố mẹ mời giáo viên (chọn môn + quyền), hoặc giáo viên gửi yêu cầu và bố mẹ
          duyệt. Trước khi bố mẹ duyệt, giáo viên <b>không</b> xem được bất kỳ dữ liệu
          học tập nào của con.
        </div>
      </div>
      <p className="muted">
        Màn hình mời/duyệt giáo viên và quản lý quyền đang được hoàn thiện — API phía
        sau đã sẵn sàng (relationship requests + permission scoping).
      </p>
    </Screen>
  );
}
