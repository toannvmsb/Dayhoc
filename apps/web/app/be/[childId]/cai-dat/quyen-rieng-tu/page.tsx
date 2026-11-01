import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';
import { setConsentAction } from '@/lib/server/actions';

export const dynamic = 'force-dynamic';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'medium', timeStyle: 'short' });

export default async function PrivacyCenter({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let child;
  let center;
  try {
    [child, center] = await Promise.all([
      getApi().getChild(parentAuth(), params.childId),
      getApi().getConsentCenter(parentAuth(), params.childId),
    ]);
  } catch {
    notFound();
  }
  const name = 'displayName' in child ? child.displayName : 'con';
  const titleOf = new Map(center.consents.map((c) => [c.kind, c.title]));

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}/cai-dat`} className="chip">‹ Cài đặt</Link>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span className="overline">Quyền riêng tư</span>
        <h1 className="h1" style={{ margin: 0 }}>Đồng ý & dữ liệu của {name}</h1>
        <p className="muted" style={{ margin: 0 }}>
          Bố mẹ quyết định dữ liệu của con được dùng thế nào. Mọi lần bật/tắt đều được ghi lại.
        </p>
      </div>

      {center.consents.map((c) => (
        <div key={c.kind} className="card" style={{ gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <b style={{ flex: 1, color: 'var(--c-text-heading)', fontSize: 14 }}>{c.title}</b>
            <span className="chip" data-testid={`consent-state-${c.kind}`} style={{ fontWeight: 700 }}>
              {c.active ? 'Đang bật' : 'Đang tắt'}
            </span>
          </div>
          <span style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--c-text-body)' }}>{c.summary}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            <b>Nếu tắt:</b> {c.ifOff}
          </span>
          <form action={setConsentAction}>
            <input type="hidden" name="childId" value={params.childId} />
            <input type="hidden" name="kind" value={c.kind} />
            <input type="hidden" name="granted" value={c.active ? '0' : '1'} />
            <button type="submit" className="cta" style={{ height: 40, fontSize: 13.5 }}>
              {c.active ? 'Tắt đồng ý' : 'Đồng ý bật'}
            </button>
          </form>
        </div>
      ))}

      <div className="card" style={{ gap: 6 }}>
        <span className="overline">DạyZi cam kết</span>
        {center.dataNotes.map((n, i) => (
          <span key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--c-text-body)' }}>• {n}</span>
        ))}
      </div>

      <div className="card" style={{ gap: 8 }}>
        <span className="overline">Dữ liệu của con</span>
        <span style={{ fontSize: 12.5, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
          Tải một bản sao toàn bộ dữ liệu DạyZi đang lưu về {name} (tệp JSON, không gồm mật khẩu).
        </span>
        <a
          href={`/be/${params.childId}/cai-dat/quyen-rieng-tu/xuat`}
          className="cta"
          style={{ height: 40, fontSize: 13.5, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          Tải dữ liệu của con
        </a>
        <Link href={`/be/${params.childId}/cai-dat/xoa`} className="muted" style={{ fontSize: 12.5 }}>
          Muốn xoá hẳn hồ sơ? Xoá vĩnh viễn ›
        </Link>
      </div>

      <div className="card" style={{ gap: 6 }}>
        <span className="overline">Lịch sử đồng ý</span>
        {center.history.length === 0 ? (
          <span className="muted" style={{ fontSize: 12.5 }}>Chưa có thay đổi nào.</span>
        ) : (
          center.history.map((h, i) => (
            <span key={i} style={{ fontSize: 12.5, color: 'var(--c-text-body)' }}>
              {fmt(h.at)} · {h.action === 'GRANTED' ? 'Đã đồng ý' : 'Đã rút đồng ý'} · {titleOf.get(h.kind) ?? h.kind}
            </span>
          ))
        )}
      </div>
    </Screen>
  );
}
