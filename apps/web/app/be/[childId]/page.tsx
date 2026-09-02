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

      <AttentionCard items={home.attention} />
      <InsightsRow progressInsights={home.progressInsights} thinkingChallenge={home.thinkingChallenge} />
    </Screen>
  );
}
