import type { ChildLearningTwin, DailyPlanResult, PlannedAction } from '@copilot/domain';
import type { ChildSummary, StatusWord, TodayPlanView } from '@copilot/api-contract';
import type { KnowledgeBase } from '@copilot/math-data';

export interface ChildProfileInput {
  readonly childId: string;
  readonly displayName: string;
  readonly schoolGrade: number;
  readonly schoolContext: string;
}

export const childSummary = (p: ChildProfileInput): ChildSummary => ({
  childId: p.childId,
  displayName: p.displayName,
  schoolGrade: p.schoolGrade,
  schoolContext: p.schoolContext,
});

/** Mastery/target → a word, never a percentile (UI/UX Spec §20). */
export function statusWord(current: number, target: number): StatusWord {
  if (current >= target + 8) return 'trên_mức_mục_tiêu';
  if (current >= target - 6) return 'đúng_mức_mục_tiêu';
  if (current >= target - 22) return 'đang_củng_cố';
  return 'chưa_ổn_định';
}

const BUCKET_LABEL: Record<PlannedAction['mixBucket'], string> = {
  school: 'Bài trên lớp',
  gapRepair: 'Củng cố',
  advanced: 'Nâng cao',
  thinking: 'Tư duy',
};

export function todayPlanView(plan: DailyPlanResult): TodayPlanView | { kind: 'no_plan_needed'; reason: string } {
  if (plan.kind === 'no_plan_needed') return { kind: 'no_plan_needed', reason: plan.reason };
  return {
    kind: 'plan',
    totalMinutes: plan.orderedActions.reduce((s, a) => s + a.estimatedMinutes, 0),
    mix: plan.mix,
    steps: plan.orderedActions.map((a, i) => ({
      index: i + 1,
      title: a.parentFacingTitle,
      minutes: a.estimatedMinutes,
      bucketLabel: BUCKET_LABEL[a.mixBucket],
      parentInvolved: a.mixBucket === 'school' || a.mixBucket === 'gapRepair',
      ...(a.gapId ? { whyLabel: 'Vì sao app đề xuất?' } : {}),
    })),
  };
}

export function activeSkillHeadline(
  activeSkillIds: readonly string[],
  kb: KnowledgeBase,
): string {
  const names = activeSkillIds
    .map((id) => kb.skills.get(id as never)?.name)
    .filter((n): n is string => Boolean(n))
    .slice(0, 2);
  return names.length > 0 ? names.join(' & ') : 'Chưa có thông tin bài đang học';
}

export function masteryTargetFor(): number {
  return 70; // aligned with gap-engine masteryTarget; per-goal tuning later
}

export function twinAverageActiveMastery(twin: ChildLearningTwin): number {
  const xs = [...twin.skillMastery.values()].filter((s) => s.evidenceCount > 0).map((s) => s.mastery);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
