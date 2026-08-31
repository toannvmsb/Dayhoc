import type { ConfidenceTier } from '@copilot/domain';

/**
 * Mastery-engine coefficients.
 *
 * ⚠️ PROVISIONAL — these numbers are NOT calibrated against real student data
 * (Risk R3). They are deliberately isolated here so calibration is a config
 * change, never a code change. Every derived value carries a `confidence` so
 * downstream consumers know not to over-trust an uncalibrated estimate.
 */
export interface MasteryConfig {
  /** Evidence confidence tier → weight in the mastery average (Math Core §3: A>B>C>D). */
  readonly tierWeight: Readonly<Record<ConfidenceTier, number>>;
  /** Half-life (days) for recency weighting of evidence. */
  readonly recencyHalfLifeDays: number;
  /** Half-life (days) for retention decay since last verification. */
  readonly retentionHalfLifeDays: number;
  /** How much full hint dependency erodes the credit for a correct answer (0..1). */
  readonly hintDependencyPenalty: number;
  /** Credit floor for a WRONG answer backed by strong reasoning (likely a slip, not a gap). */
  readonly carelessCushionStrong: number;
  /** Credit floor for a wrong answer with adequate reasoning. */
  readonly carelessCushionAdequate: number;
  /** Σweight at which estimate confidence reaches ~0.63 (1 - e^-1). */
  readonly confidenceWeightScale: number;
  /** A confirming (A/B tier, correct) evidence is required for `lastVerifiedAt`. */
  readonly verifyingTiers: readonly ConfidenceTier[];
  /** Minimum mastery for a skill to count toward its domain frontier. */
  readonly frontierMasteryThreshold: number;
}

export const DEFAULT_MASTERY_CONFIG: MasteryConfig = {
  tierWeight: { A: 1.0, B: 0.8, C: 0.55, D: 0.3 },
  recencyHalfLifeDays: 30,
  retentionHalfLifeDays: 45,
  hintDependencyPenalty: 0.6,
  carelessCushionStrong: 0.55,
  carelessCushionAdequate: 0.25,
  confidenceWeightScale: 2.5,
  verifyingTiers: ['A', 'B'],
  frontierMasteryThreshold: 50,
};

export const PROVISIONAL_NOTE =
  'Mastery coefficients are provisional and uncalibrated (Risk R3). Treat low-confidence estimates as directional only.';
