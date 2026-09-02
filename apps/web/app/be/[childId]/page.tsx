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

  return (
    <Screen nav={<ParentNav childId={params.childId} active="home" />}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="overline">DạyZi</span>
        <Link href="/be" className="chip">
          {home.child.displayName} · Lớp {home.child.schoolGrade} ›
        </Link>
      </header>

      <LearningContextCard ctx={home.learningContext} />
      <TodayPlanCard plan={home.todayPlan} />

      <Link href={`/be/${params.childId}/bai-tap`} className="cta" style={{ textDecoration: 'none' }}>
        Bắt đầu 20 phút cùng con
      </Link>

      <Link
        href={`/be/${params.childId}/tai-lieu`}
        className="card"
        style={{ flexDirection: 'row', alignItems: 'center', textDecoration: 'none' }}
      >
        <span style={{ flex: 1, fontWeight: 700, color: 'var(--c-text-heading)' }}>
          Tải bài của con
          <span className="muted" style={{ display: 'block', fontWeight: 500 }}>
            Chụp trang vở / bài kiểm tra để DạyZi hiểu con hơn
          </span>
        </span>
        <span style={{ color: 'var(--c-primary)', fontWeight: 700 }}>›</span>
      </Link>

      <AttentionCard items={home.attention} childId={params.childId} />
      <InsightsRow progressInsights={home.progressInsights} thinkingChallenge={home.thinkingChallenge} />
    </Screen>
  );
}
