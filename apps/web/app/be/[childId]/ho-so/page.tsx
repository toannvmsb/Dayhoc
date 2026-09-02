import { notFound, redirect } from 'next/navigation';
import { ParentNav, Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function Profile({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let guardians;
  try {
    [child, guardians] = await Promise.all([
      getApi().getChild(parentAuth(), params.childId),
      getApi().listGuardians(parentAuth(), params.childId),
    ]);
  } catch {
    notFound();
  }

  const name = child.displayName;
  const grade = 'schoolGrade' in child ? (child.schoolGrade as number) : null;

  return (
    <Screen nav={<ParentNav childId={params.childId} active="profile" />}>
      <h1 className="h1">Hồ sơ {name}</h1>
      <div className="card">
        <span className="overline">Thông tin</span>
        <div style={{ fontSize: 14 }}>Tên: <b>{name}</b></div>
        {grade !== null && <div style={{ fontSize: 14 }}>Lớp: <b>{grade}</b></div>}
      </div>
      <div className="card">
        <span className="overline">Người giám hộ</span>
        {guardians.map((g) => (
          <div key={g.parentUserId} style={{ fontSize: 13.5 }}>
            {g.relationshipType} · {g.authoritySource}
            {g.capabilities.canManagePrivacy ? ' · quản lý quyền riêng tư' : ''}
          </div>
        ))}
      </div>
      <p className="card" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
        Không bắt buộc kết nối trường/lớp hay giáo viên — bố mẹ vẫn dùng đầy đủ DạyZi.
      </p>
    </Screen>
  );
}
