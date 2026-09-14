import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { logoutAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

const PLAN_LABEL: Record<string, string> = {
  free: 'Miễn phí',
  basic: 'Cơ bản',
  plus: 'Plus',
  pro: 'Pro',
};

function Row({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <Link
      href={href}
      className="card"
      style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none' }}
    >
      <span style={{ flex: 1 }}>
        <b style={{ color: 'var(--c-text-heading)', fontSize: 13.5 }}>{title}</b>
        <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>{sub}</span>
      </span>
      <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>›</span>
    </Link>
  );
}

export default async function ChildSettings({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let me;
  let child;
  let ent;
  let teacherLinks;
  let studentAccess;
  let deletion;
  try {
    [me, child, ent, teacherLinks, studentAccess, deletion] = await Promise.all([
      getApi().getMe(parentAuth()),
      getApi().getChild(parentAuth(), params.childId),
      getApi().getEntitlements(parentAuth()),
      getApi().listTeacherLinks(parentAuth(), params.childId),
      getApi().getStudentAccess(parentAuth(), params.childId),
      getApi().getChildDeletionStatus(parentAuth(), params.childId),
    ]);
  } catch {
    notFound();
  }

  const name = 'displayName' in child ? child.displayName : 'con';
  const acceptedTeachers = teacherLinks.filter((l) => l.status === 'ACCEPTED').length;

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/ho-so`} className="chip">‹ Hồ sơ con</Link>
      <h1 className="h1">Cài đặt</h1>

      <div className="card" style={{ gap: 8 }}>
        <span className="overline">Tài khoản</span>
        <span style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>{me.displayName ?? '—'}</span>
        <span className="muted" style={{ fontSize: 12 }}>{me.roles.join(' · ')}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="cta"
            style={{ background: 'var(--c-attention-text)', height: 40, fontSize: 13.5 }}
          >
            Đăng xuất
          </button>
        </form>
      </div>

      <Row href={`/be/${params.childId}/ho-so`} title="Hồ sơ con" sub={`${name} · lớp ${'schoolGrade' in child ? child.schoolGrade : '—'}`} />
      <Row href={`/be/${params.childId}/truong-lop`} title="Trường & lớp" sub="Khai báo trường/lớp, chế độ chia sẻ" />
      <Row
        href={`/be/${params.childId}/ho-so`}
        title="Tài khoản của con"
        sub={studentAccess?.status === 'ACTIVE' ? `Đang bật · ${studentAccess.username ?? studentAccess.loginEmail}` : 'Chưa tạo'}
      />
      <Row
        href={`/be/${params.childId}/ket-noi`}
        title="Giáo viên đã kết nối"
        sub={acceptedTeachers > 0 ? `${acceptedTeachers} giáo viên` : 'Chưa kết nối'}
      />
      <Row href={`/be/${params.childId}/ket-noi`} title="Quyền chia sẻ" sub="Bật/tắt từng quyền cho từng giáo viên" />

      <div className="card" style={{ gap: 4 }}>
        <span className="overline">Quyền riêng tư & dữ liệu</span>
        <span style={{ fontSize: 12.5, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
          Bài con làm và bằng chứng học tập là nhật ký chỉ-thêm. Dữ liệu suy ra (mức độ
          nắm bài, điểm cần cải thiện) được tính lại từ nhật ký đó. DạyZi không dùng dữ
          liệu của con để huấn luyện mô hình AI.
        </span>
      </div>

      <Link href="/goi-dich-vu" className="card" style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none' }}>
        <span style={{ flex: 1 }}>
          <b style={{ color: 'var(--c-text-heading)', fontSize: 13.5 }}>Gói dịch vụ</b>
          <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
            Đang dùng: {PLAN_LABEL[ent.plan] ?? ent.plan}
          </span>
        </span>
        <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>›</span>
      </Link>

      <Link
        href={`/be/${params.childId}/cai-dat/xoa`}
        className="card"
        style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none' }}
      >
        <span style={{ flex: 1 }}>
          <b style={{ color: 'var(--c-attention-text)', fontSize: 13.5 }}>Xóa hồ sơ của con</b>
          <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
            {deletion.request ? 'Đang trong quy trình xóa' : 'Xóa vĩnh viễn toàn bộ dữ liệu'}
          </span>
        </span>
        <span style={{ color: 'var(--c-attention-text)', fontWeight: 700 }}>›</span>
      </Link>
    </Screen>
  );
}
