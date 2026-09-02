import { redirect } from 'next/navigation';
import { Screen, TeacherNav } from '../../components';
import { getApi, getViewer, teacherAuth } from '@/lib/server/api';
import { RedeemCode, RequestRow } from './client';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Đang chờ',
  ACCEPTED: 'Đã chấp thuận',
  REJECTED: 'Bị từ chối',
  CANCELLED: 'Đã huỷ',
  EXPIRED: 'Hết hạn',
};

export default async function TeacherConnect() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  if (!viewer.roles.includes('TEACHER')) redirect('/');

  const { inbox, outbox } = await getApi().listRelationshipRequests(teacherAuth());

  return (
    <Screen nav={<TeacherNav active="connect" />}>
      <h1 className="h1">Kết nối</h1>

      <div className="card">
        <span className="overline">Nhập mã kết nối từ phụ huynh</span>
        <RedeemCode />
        <span className="muted">
          Nhập mã sẽ tạo yêu cầu kết nối. Phụ huynh vẫn phải chấp thuận trước khi bạn thấy
          bất kỳ thông tin nào.
        </span>
      </div>

      <div className="card">
        <span className="overline">Yêu cầu bạn gửi</span>
        {outbox.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>Chưa có yêu cầu nào.</p>
        ) : (
          outbox.map((r) => (
            <div key={r.id} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>
              {r.relationshipType ?? r.relationshipKind} — {STATUS_LABEL[r.status] ?? r.status}
            </div>
          ))
        )}
      </div>

      <div className="card">
        <span className="overline">Yêu cầu gửi tới bạn</span>
        {inbox.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>Không có yêu cầu nào.</p>
        ) : (
          inbox.map((r) => (
            <RequestRow
              key={r.id}
              id={r.id}
              label={`${r.relationshipType ?? r.relationshipKind} — ${STATUS_LABEL[r.status] ?? r.status}`}
              actionable={r.status === 'PENDING'}
            />
          ))
        )}
      </div>
    </Screen>
  );
}
