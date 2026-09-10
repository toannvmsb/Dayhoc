import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ParentNav, Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { StudentAccess } from './student-access';

export const dynamic = 'force-dynamic';

const REL_LABEL: Record<string, string> = {
  FATHER: 'Bố',
  MOTHER: 'Mẹ',
  GUARDIAN: 'Người giám hộ',
  OTHER: 'Người thân',
};

export default async function Profile({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let guardians;
  let studentAccess = null;
  try {
    [child, guardians, studentAccess] = await Promise.all([
      getApi().getChild(parentAuth(), params.childId),
      getApi().listGuardians(parentAuth(), params.childId),
      getApi().getStudentAccess(parentAuth(), params.childId),
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
          <div key={g.parentUserId} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>
            {viewer.userId === g.parentUserId ? (viewer.displayName ?? 'Bạn') : REL_LABEL[g.relationshipType] ?? 'Người thân'}
            {' · '}
            {REL_LABEL[g.relationshipType] ?? 'người giám hộ'}
            {g.capabilities.canManagePrivacy && (
              <span className="muted" style={{ display: 'block', fontWeight: 500, fontSize: 12 }}>
                Quản lý toàn bộ quyền riêng tư &amp; dữ liệu của con
              </span>
            )}
          </div>
        ))}
      </div>
      <Link href={`/be/${params.childId}/bat-dau`} className="card" style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none' }}>
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
          Bài con đang học
          <span className="muted" style={{ display: 'block', fontWeight: 500 }}>
            Cập nhật khi con học sang bài mới — DạyZi ra bài ôn đúng mức
          </span>
        </span>
        <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>›</span>
      </Link>

      <Link href={`/be/${params.childId}/truong-lop`} className="card" style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none' }}>
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
          Trường &amp; lớp
          <span className="muted" style={{ display: 'block', fontWeight: 500 }}>
            Khai báo trường/lớp, chế độ chia sẻ
          </span>
        </span>
        <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>›</span>
      </Link>

      <StudentAccess childId={params.childId} access={studentAccess} />

      <p className="card" style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)' }}>
        Không bắt buộc kết nối trường/lớp hay giáo viên — bố mẹ vẫn dùng đầy đủ DạyZi.
      </p>
    </Screen>
  );
}
