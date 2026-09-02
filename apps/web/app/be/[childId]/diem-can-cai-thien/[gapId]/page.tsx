import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

const PRIORITY_LABEL: Record<string, string> = {
  ưu_tiên_cao: 'Ưu tiên cao',
  ưu_tiên_trung_bình: 'Ưu tiên vừa',
  ưu_tiên_thấp: 'Ưu tiên thấp',
};

export default async function GapDetail({
  params,
}: {
  params: { childId: string; gapId: string };
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let detail;
  try {
    detail = await getApi().getParentGapDetail(parentAuth(), params.childId, params.gapId);
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link href={`/be/${params.childId}`} className="chip">‹ Trang chính</Link>
      <div>
        <span className="overline">{PRIORITY_LABEL[detail.priorityLabel] ?? detail.priorityLabel}</span>
        <h1 className="h1">{detail.title}</h1>
        <span className="muted">{detail.lifecycleLabel}</span>
      </div>

      <div className="card" style={{ gap: 6 }}>
        <span className="overline">Vì sao DạyZi nghĩ vậy</span>
        {detail.whyAppThinks.map((w, i) => (
          <p key={i} style={{ margin: 0, fontSize: 13.5, color: 'var(--c-text-body)', lineHeight: 1.5 }}>
            {w}
          </p>
        ))}
      </div>

      {detail.affects.length > 0 && (
        <div className="card" style={{ gap: 4 }}>
          <span className="overline">Ảnh hưởng tới</span>
          {detail.affects.map((a, i) => (
            <span key={i} style={{ fontSize: 13.5, color: 'var(--c-text-heading)' }}>• {a}</span>
          ))}
        </div>
      )}

      <div className="card" style={{ gap: 6 }}>
        <span className="overline">Tiến trình khắc phục</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {detail.lifecycleStep.map((s, i) => (
            <span
              key={i}
              className="chip"
              style={{
                background:
                  s.state === 'current'
                    ? 'var(--c-primary-tint)'
                    : s.state === 'done'
                      ? 'var(--c-mint-bg, #E7F8F1)'
                      : 'var(--c-surface)',
                fontWeight: s.state === 'current' ? 700 : 500,
              }}
            >
              {s.label}
            </span>
          ))}
        </div>
      </div>

      {detail.prescription && (
        <div className="card" style={{ gap: 6 }}>
          <span className="overline">Kế hoạch luyện tập gợi ý</span>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--c-text-heading)' }}>
            {detail.prescription.summary}
          </p>
          {detail.prescription.perSession.map((p, i) => (
            <span key={i} style={{ fontSize: 13, color: 'var(--c-text-body)' }}>
              {p.label}: {p.count}
            </span>
          ))}
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--c-text-faint)' }}>
            {detail.prescription.rationale}
          </p>
        </div>
      )}

      <Link
        href={`/be/${params.childId}/day-con?gapId=${params.gapId}`}
        className="cta"
        style={{ textDecoration: 'none' }}
      >
        DạyZi hướng dẫn bạn dạy con phần này
      </Link>
    </Screen>
  );
}
