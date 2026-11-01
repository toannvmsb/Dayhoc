import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import {
  AttentionCard,
  InsightsRow,
  LearningContextCard,
  ParentNav,
  Screen,
  TodayPlanCard,
} from '../../components';
import { getApi, getViewer, parentAuth } from '@/lib/server/api';

export const dynamic = 'force-dynamic';

export default async function ParentHome({ params }: { params: { childId: string } }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/welcome');

  let home;
  try {
    home = await getApi().getParentHome(parentAuth(), params.childId);
  } catch {
    notFound();
  }
  // the banner is a courtesy: never let it break the home screen
  const idle = await getApi()
    .getInactivityStatus(parentAuth(), params.childId)
    .catch(() => null);

  return (
    <Screen nav={<ParentNav childId={params.childId} active="home" />}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="overline">DạyZi</span>
        <Link href="/be" className="chip">
          {home.child.displayName} · Lớp {home.child.schoolGrade} ›
        </Link>
      </header>

      {idle?.needsNudge && idle.inactiveDays !== null ? (
        <Link
          href={`/be/${params.childId}/bai-tap`}
          className="card card--attention"
          data-testid="idle-banner"
          style={{ textDecoration: 'none', gap: 2 }}
        >
          <b style={{ color: 'var(--c-attention-text)', fontSize: 13.5 }}>
            {home.child.displayName} chưa làm bài {idle.inactiveDays} ngày rồi
          </b>
          <span style={{ fontSize: 12.5, color: 'var(--c-attention-body)' }}>
            Vài phút hôm nay là con giữ được nhịp học — mở bài hôm nay ›
          </span>
        </Link>
      ) : null}

      <LearningContextCard ctx={home.learningContext} childId={params.childId} />
      <TodayPlanCard plan={home.todayPlan} />

      <Link href={`/be/${params.childId}/bai-tap`} className="cta" style={{ textDecoration: 'none' }}>
        Bắt đầu 20 phút cùng con
      </Link>

      <div style={{ display: 'flex', gap: 10 }}>
        <Link
          href={`/be/${params.childId}/tai-lieu`}
          className="card"
          style={{ flex: 1, textDecoration: 'none', gap: 2 }}
        >
          <span style={{ fontWeight: 700, color: 'var(--c-text-heading)', fontSize: 13.5 }}>Tải bài của con</span>
          <span className="muted" style={{ fontSize: 11.5 }}>Chụp vở / bài kiểm tra</span>
        </Link>
        <Link
          href={`/be/${params.childId}/kiem-tra`}
          className="card"
          style={{ flex: 1, textDecoration: 'none', gap: 2 }}
        >
          <span style={{ fontWeight: 700, color: 'var(--c-text-heading)', fontSize: 13.5 }}>Kiểm tra &amp; ôn thi</span>
          <span className="muted" style={{ fontSize: 11.5 }}>Bản đồ ôn tập + chẩn đoán</span>
        </Link>
      </div>

      <AttentionCard items={home.attention} childId={params.childId} />
      <InsightsRow progressInsights={home.progressInsights} thinkingChallenge={home.thinkingChallenge} />
    </Screen>
  );
}
