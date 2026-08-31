import type { LearningMix, PlanningSituation } from '@copilot/domain';

/**
 * Planning coefficients & mix presets (Math Core §16, §24).
 * ⚠️ PROVISIONAL (Risk R3). The Learning Mix (school/gapRepair/advanced/thinking)
 * and the Adaptive Practice ladder default (basic .45 / variation .30 / thinking .25)
 * are DIFFERENT axes — see 07_MATH_ENGINE_PLAN §11 / 11_RISKS N1.
 */
export interface PlanningConfig {
  readonly mixPresets: Readonly<Record<PlanningSituation, LearningMix>>;
  /** Days-to-exam at or below which the situation becomes `exam_soon`. */
  readonly examSoonDays: number;
  /** A gap detected within this many days makes the situation `after_gap_detected`. */
  readonly freshGapDays: number;
  /** Average active-skill mastery at or above which a child counts as `strong_student`. */
  readonly strongStudentMastery: number;
  /** Goal → mix nudge (added to the situation preset, then re-normalised). */
  readonly goalNudge: Readonly<Record<string, Partial<LearningMix>>>;
  /** Minutes assumed per practice item when estimating action cost. */
  readonly minutesPerItem: number;
}

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  mixPresets: {
    normal_week: { school: 40, gapRepair: 20, advanced: 25, thinking: 15 },
    after_gap_detected: { school: 25, gapRepair: 50, advanced: 15, thinking: 10 },
    strong_student: { school: 20, gapRepair: 10, advanced: 40, thinking: 30 },
    exam_soon: { school: 30, gapRepair: 40, advanced: 10, thinking: 20 },
  },
  examSoonDays: 14,
  freshGapDays: 10,
  strongStudentMastery: 78,
  goalNudge: {
    theo_sat_chuong_trinh: { school: 12 },
    kha_gioi: { advanced: 8, gapRepair: 4 },
    phat_trien_tu_duy: { thinking: 14 },
    hsg_thi_chuyen: { advanced: 10, thinking: 10 },
  },
  minutesPerItem: 2.5,
};
