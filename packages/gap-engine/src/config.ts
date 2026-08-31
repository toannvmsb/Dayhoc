/**
 * Gap-engine thresholds & weights.
 *
 * ⚠️ PROVISIONAL / uncalibrated (Risk R3). Over/under-diagnosis is tuned here,
 * never in the classifier logic. Calibrate against pilot evidence + math-educator
 * review (Decision D5).
 */
export interface GapConfig {
  /** A skill at or above this mastery is considered "not a gap" on its own. */
  readonly masteryTarget: number; // 0..100
  /** Prerequisite mastery below this counts as weak when tracing a root gap. */
  readonly weakPrerequisite: number; // 0..100
  /** Only prerequisite edges at/above this importance are considered blocking. */
  readonly blockingImportance: number; // 0..1
  /** Skill mastery at/above this is "strong" — a failure then points at thinking, not knowledge. */
  readonly strongMastery: number; // 0..100
  /** A careless slip must sit above this skill mastery and below this error streak. */
  readonly carelessMinMastery: number; // 0..100
  readonly carelessMaxStreak: number;
  /** Retention below this + an old lastVerifiedAt ⇒ retention_gap candidate. */
  readonly lowRetention: number; // 0..1
  readonly retentionStaleDays: number;
  /** Thinking-dimension score below this (with strong knowledge) ⇒ reasoning_gap. */
  readonly weakThinking: number; // 0..100
  /** gap_score band cutoffs (post-normalisation, 0..1). */
  readonly scoreBands: { readonly medium: number; readonly high: number };
  /** learning_goal_weight by parent goal, applied to the school-relevance of a gap. */
  readonly goalWeight: Readonly<Record<string, number>>;
}

export const DEFAULT_GAP_CONFIG: GapConfig = {
  masteryTarget: 70,
  weakPrerequisite: 55,
  blockingImportance: 0.6,
  strongMastery: 72,
  carelessMinMastery: 65,
  carelessMaxStreak: 1,
  lowRetention: 0.4,
  retentionStaleDays: 30,
  weakThinking: 50,
  scoreBands: { medium: 0.28, high: 0.55 },
  goalWeight: {
    theo_sat_chuong_trinh: 1.0,
    kha_gioi: 0.9,
    phat_trien_tu_duy: 0.8,
    hsg_thi_chuyen: 0.75,
  },
};
