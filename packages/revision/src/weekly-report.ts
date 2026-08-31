import {
  LEARNING_MIX_DIMENSIONS,
  type ChildId,
  type ChildLearningTwin,
  type Evidence,
  type LearningMix,
  type WeeklyReport,
} from '@copilot/domain';
import type { GapEngineResult } from '@copilot/gap-engine';
import type { KnowledgeBase } from '@copilot/math-data';

export interface WeeklyReportInput {
  readonly childId: ChildId;
  readonly weekOf: string; // Monday, YYYY-MM-DD
  readonly weekEvidence: readonly Evidence[];
  readonly twinBefore: ChildLearningTwin;
  readonly twinAfter: ChildLearningTwin;
  readonly gapsAfter: GapEngineResult;
  readonly knowledgeBase: KnowledgeBase;
  readonly baseMix?: LearningMix;
}

const BASE: LearningMix = { school: 40, gapRepair: 20, advanced: 25, thinking: 15 };

/**
 * Weekly report (Blueprint §10). Summarises the week and proposes next week's
 * Learning Mix: more gap repair while gaps are open, more advanced/thinking once
 * they close.
 */
export function buildWeeklyReport(input: WeeklyReportInput): WeeklyReport {
  const { twinBefore, twinAfter, gapsAfter, knowledgeBase: kb } = input;
  const base = input.baseMix ?? BASE;

  const sessions = new Set(
    input.weekEvidence.map((e) => e.occurredAt.slice(0, 10)),
  ).size;
  const totalMinutes = Math.round(
    input.weekEvidence.reduce((s, e) => s + (e.timeSpentSeconds ?? 0), 0) / 60,
  );

  const progress: string[] = [];
  let steady = 0;
  for (const [skillId, after] of twinAfter.skillMastery) {
    const before = twinBefore.skillMastery.get(skillId)?.mastery ?? 0;
    const name = kb.skills.get(skillId)?.name ?? skillId;
    if (after.mastery >= 70 && before < 70) {
      progress.push(`${name} đã đạt mức mục tiêu.`);
    }
    if (after.mastery >= 70) steady += 1;
  }
  if (progress.length === 0 && input.weekEvidence.length > 0) {
    progress.push('Con duy trì được nhịp học đều trong tuần.');
  }

  const openGaps = gapsAfter.gaps.filter((g) => g.type !== 'careless_error' && g.score.band !== 'low');
  const needsFollowUp = openGaps
    .slice(0, 2)
    .map((g) => `${kb.skills.get(g.rootSkillId)?.name ?? g.rootSkillId}: ${g.rationale}`);

  // next-week mix
  const nextWeekMix: LearningMix = { ...base };
  if (openGaps.length > 0) {
    const shift = Math.min(20, openGaps.length * 12);
    nextWeekMix.gapRepair += shift;
    nextWeekMix.advanced = Math.max(5, nextWeekMix.advanced - shift);
  } else if (steady >= 3) {
    nextWeekMix.advanced += 10;
    nextWeekMix.thinking += 5;
    nextWeekMix.school = Math.max(15, nextWeekMix.school - 15);
  }
  normalise(nextWeekMix);

  const nextWeekNote =
    openGaps.length > 0
      ? 'Tăng phần củng cố vì vẫn còn điểm cần xử lý.'
      : steady >= 3
        ? 'Con đang vững, tăng phần nâng cao và tư duy.'
        : 'Giữ nhịp hiện tại.';

  return {
    childId: input.childId,
    weekOf: input.weekOf,
    stats: { sessions, totalMinutes, skillsSteady: steady },
    progress,
    needsFollowUp: needsFollowUp.length > 0 ? needsFollowUp : ['Không có điểm cần theo tiếp trong tuần.'],
    nextWeekMix,
    nextWeekNote,
  };
}

function normalise(mix: LearningMix): void {
  let total = 0;
  for (const d of LEARNING_MIX_DIMENSIONS) total += mix[d];
  for (const d of LEARNING_MIX_DIMENSIONS) mix[d] = Math.round((mix[d] / total) * 100);
  const drift = 100 - LEARNING_MIX_DIMENSIONS.reduce((s, d) => s + mix[d], 0);
  mix.school += drift;
}
