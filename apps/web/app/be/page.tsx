import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { logoutAction } from '@/lib/server/actions';
import { BackChip } from '../ui';

export const dynamic = 'force-dynamic';

export default async function Children() {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');
  const children = await getApi().listChildren(parentAuth());

  return (
    <div className="screen">
      <div className="screen__body" style={{ gap: 12 }}>
        <BackChip fallbackHref="/" />
        <span className="overline">DạyZi</span>
        <h1 className="h1">Con của bạn</h1>
        {children.map((c) => (
          <Link key={c.childId} href={`/be/${c.childId}`} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <span
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                background: 'var(--c-primary)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
              }}
            >
              {c.displayName.slice(0, 1)}
            </span>
            <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
              {c.displayName}
              <span className="muted" style={{ display: 'block', fontWeight: 500 }}>Lớp {c.schoolGrade}</span>
            </span>
            <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>›</span>
          </Link>
        ))}
        <Link href="/onboarding" className="cta cta--onteal" style={{ textDecoration: 'none' }}>
          + Thêm con
        </Link>
        <form action={logoutAction} style={{ marginTop: 8 }}>
          <button type="submit" style={{ background: 'none', border: 'none', color: 'var(--c-text-muted)', fontSize: 13, cursor: 'pointer' }}>
            Đăng xuất
          </button>
        </form>
      </div>
    </div>
  );
}
