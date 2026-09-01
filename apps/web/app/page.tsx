import { demoScene } from '@/lib/demo-scene';
import {
  AttentionCard,
  BottomNav,
  ChildSwitcher,
  InsightsRow,
  LearningContextCard,
  Screen,
  TodayPlanCard,
} from './components';

export default function ParentHome() {
  const { home } = demoScene();
  return (
    <Screen nav={<BottomNav active="home" />}>
      <ChildSwitcher
        name={home.child.displayName}
        sub={`Lớp ${home.child.schoolGrade} · ${home.child.schoolContext}`}
      />
      <LearningContextCard ctx={home.learningContext} />
      <TodayPlanCard plan={home.todayPlan} />
      <AttentionCard items={home.attention} />
      <InsightsRow
        progressInsights={home.progressInsights}
        thinkingChallenge={home.thinkingChallenge}
      />
    </Screen>
  );
}
