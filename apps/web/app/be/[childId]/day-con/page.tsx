import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Screen } from '../../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function TeachingCopilot({
  params,
  searchParams,
}: {
  params: { childId: string };
  searchParams: { gapId?: string };
}) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let plan;
  try {
    plan = await getApi().getParentTeachingPlan(
      parentAuth(),
      params.childId,
      searchParams.gapId,
    );
  } catch {
    notFound();
  }

  return (
    <Screen nav={null}>
      <Link
        href={
          plan.forGapId
            ? `/be/${params.childId}/diem-can-cai-thien/${plan.forGapId}`
            : `/be/${params.childId}`
        }
        className="chip"
      >
        ‹ Quay lại
      </Link>

      <div>
        <span className="overline">DạyZi hướng dẫn bạn dạy con · ~{plan.minutes} phút</span>
        <h1 className="h1">{plan.skillName}</h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--c-text-body)' }}>{plan.focusLine}</p>
      </div>

      <div className="card card--teal" style={{ gap: 6 }}>
        <span className="overline overline--onteal">Hiểu đúng vấn đề</span>
        <p style={{ margin: 0, fontSize: 14, color: '#fff', lineHeight: 1.55 }}>{plan.gapMeaning}</p>
      </div>

      <div className="card" style={{ gap: 4 }}>
        <span className="overline">Trước khi bắt đầu</span>
        {plan.beforeYouStart.map((b, i) => (
          <span key={i} style={{ fontSize: 13, color: 'var(--c-text-body)' }}>• {b}</span>
        ))}
      </div>

      {plan.steps.map((s, i) => (
        <div key={i} className="card" style={{ gap: 6 }}>
          <span style={{ fontWeight: 800, color: 'var(--c-text-heading)' }}>{s.title}</span>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: 'var(--c-text-heading)',
              background: 'var(--c-primary-tint)',
              padding: '8px 10px',
              borderRadius: 10,
            }}
          >
            {s.say}
          </p>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--c-text-faint)' }}>Vì sao: {s.why}</p>
        </div>
      ))}

      {plan.workedExample && (
        <div className="card" style={{ gap: 6 }}>
          <span className="overline">Ví dụ để bạn làm mẫu cho con</span>
          <p style={{ margin: 0, fontWeight: 700, color: 'var(--c-text-heading)' }}>
            {plan.workedExample.prompt}
          </p>
          <ol style={{ margin: '4px 0', paddingLeft: 18, fontSize: 13, color: 'var(--c-text-body)' }}>
            {plan.workedExample.walkthrough.map((w, i) => (
              <li key={i} style={{ marginBottom: 3 }}>{w}</li>
            ))}
          </ol>
          {plan.workedExample.answer && (
            <span style={{ fontSize: 13, color: 'var(--c-text-faint)' }}>
              Đáp số: {plan.workedExample.answer}
            </span>
          )}
        </div>
      )}

      <div className="card" style={{ gap: 4 }}>
        <span className="overline">Kiểm tra con đã hiểu chưa</span>
        {plan.checkUnderstanding.map((c, i) => (
          <span key={i} style={{ fontSize: 13, color: 'var(--c-text-body)' }}>• {c}</span>
        ))}
      </div>

      <div className="card" style={{ gap: 4 }}>
        <span className="overline">Lỗi thường gặp — để ý nhé</span>
        {plan.commonMistakes.map((c, i) => (
          <span key={i} style={{ fontSize: 13, color: 'var(--c-text-body)' }}>• {c}</span>
        ))}
      </div>

      <div className="card" style={{ gap: 4 }}>
        <span className="overline">Khích lệ con</span>
        {plan.praise.map((c, i) => (
          <span key={i} style={{ fontSize: 13, color: 'var(--c-text-body)' }}>• {c}</span>
        ))}
      </div>

      <p className="card" style={{ margin: 0, fontSize: 13, color: 'var(--c-text-body)', lineHeight: 1.55 }}>
        <b>Nếu con vẫn chưa hiểu:</b> {plan.ifStuck}
      </p>
    </Screen>
  );
}
