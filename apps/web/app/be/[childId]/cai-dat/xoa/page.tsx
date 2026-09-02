import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { DeletionFlow } from './client';

export const dynamic = 'force-dynamic';

export default async function DeleteChild({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let status;
  try {
    status = await getApi().getChildDeletionStatus(parentAuth(), params.childId);
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/cai-dat`} className="chip">‹ Cài đặt</Link>
      <h1 className="h1">Xóa hồ sơ của {status.childName}</h1>

      <p className="card card--attention" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
        Thao tác này <b>xóa vĩnh viễn</b>: hồ sơ con, toàn bộ bài đã làm và bằng chứng học
        tập, mức độ nắm bài, điểm cần cải thiện, tài liệu đã tải lên, kỳ kiểm tra, kết nối
        giáo viên và lối đăng nhập của con. Không khôi phục được.
      </p>

      <DeletionFlow
        childId={params.childId}
        childName={status.childName}
        state={status.request?.state ?? null}
      />
    </Screen>
  );
}
