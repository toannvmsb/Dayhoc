import {
  LEARNING_MIX_DIMENSIONS,
  type ChildLearningTwin,
  type LearningMix,
  type PlanningSituation,
} from '@copilot/domain';
import type { GapEngineResult } from '@copilot/gap-engine';
import type { PlanningConfig } from './config.js';

export interface MixInput {
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly parentGoal?: string;
  readonly daysToExam?: number;
  readonly asOf: Date;
}

/** Classify the current learning situation (Math Core §24). */
export function detectSituation(input: MixInput, config: PlanningConfig): PlanningSituation {
  if (input.daysToExam !== undefined && input.daysToExam <= config.examSoonDays) {
    return 'exam_soon';
  }
  const freshGap = input.gaps.gaps.some((g) => {
    const ageDays = (input.asOf.getTime() - Date.parse(g.detectedAt)) / 86_400_000;
    return g.score.band !== 'low' && ageDays <= config.freshGapDays;
  });
  if (freshGap) return 'after_gap_detected';

  const activeMasteries = [...input.twin.skillMastery.values()]
    .filter((s) => s.evidenceCount > 0)
    .map((s) => s.mastery);
  const avg =
    activeMasteries.length > 0 ? activeMasteries.reduce((a, b) => a + b, 0) / activeMasteries.length : 0;
  const highBandGaps = input.gaps.gaps.filter((g) => g.score.band === 'high').length;
  if (avg >= config.strongStudentMastery && highBandGaps === 0) return 'strong_student';

  return 'normal_week';
}

/** Compose the day's Learning Mix: situation preset + goal nudge, re-normalised to 100. */
export function computeLearningMix(input: MixInput, config: PlanningConfig): {
  mix: LearningMix;
  situation: PlanningSituation;
} {
  const situation = detectSituation(input, config);
  const preset = config.mixPresets[situation];
  const nudge = input.parentGoal ? (config.goalNudge[input.parentGoal] ?? {}) : {};

  const raw: LearningMix = { school: 0, gapRepair: 0, advanced: 0, thinking: 0 };
  let total = 0;
  for (const dim of LEARNING_MIX_DIMENSIONS) {
    raw[dim] = Math.max(0, preset[dim] + (nudge[dim] ?? 0));
    total += raw[dim];
  }
  const mix: LearningMix = { school: 0, gapRepair: 0, advanced: 0, thinking: 0 };
  for (const dim of LEARNING_MIX_DIMENSIONS) {
    mix[dim] = Math.round((raw[dim] / total) * 100);
  }
  // fix rounding drift so it sums to exactly 100
  const drift = 100 - (mix.school + mix.gapRepair + mix.advanced + mix.thinking);
  mix.school += drift;

  return { mix, situation };
}
