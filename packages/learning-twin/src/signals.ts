import type { Evidence } from '@copilot/domain';
import type { MasteryConfig } from './config.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** exp decay to 0.5 after `halfLifeDays`. Clamped so future-dated evidence ≤ 1. */
export function decay(ageDays: number, halfLifeDays: number): number {
  const a = Math.max(0, ageDays);
  return Math.pow(0.5, a / halfLifeDays);
}

export function ageInDays(occurredAtIso: string, asOf: Date): number {
  return (asOf.getTime() - Date.parse(occurredAtIso)) / DAY_MS;
}

/**
 * The multi-signal contribution of ONE evidence record (Math Core §5).
 * Never raw accuracy: hint dependency erodes credit for a correct answer, and a
 * wrong answer with strong reasoning is cushioned (a slip, not a knowledge gap).
 */
export interface EvidenceSignal {
  /** Adjusted performance in [0,1]. */
  readonly performance: number;
  /** Weight of this record in the average: tier weight × recency decay. */
  readonly weight: number;
  readonly correct: boolean | null;
  readonly isVerifying: boolean;
  readonly ageDays: number;
}

export function evidenceSignal(e: Evidence, config: MasteryConfig, asOf: Date): EvidenceSignal {
  const ageDays = ageInDays(e.occurredAt, asOf);
  const recency = decay(ageDays, config.recencyHalfLifeDays);
  const weight = config.tierWeight[e.confidenceTier] * recency;

  const correct = e.result.correct ?? null;
  const rawScore = e.result.correct === true ? 1 : (e.result.score ?? 0);

  let performance: number;
  if (rawScore > 0) {
    // Correct (or partial): full hint dependency erodes credit toward the floor.
    const hintFactor = 1 - config.hintDependencyPenalty * (e.hintDependency ?? 0);
    performance = rawScore * hintFactor;
  } else if (e.reasoningQuality === 'strong') {
    performance = config.carelessCushionStrong;
  } else if (e.reasoningQuality === 'adequate') {
    performance = config.carelessCushionAdequate;
  } else {
    performance = 0;
  }
  performance = clamp01(performance);

  const isVerifying =
    e.result.correct === true && config.verifyingTiers.includes(e.confidenceTier);

  return { performance, weight, correct, isVerifying, ageDays };
}

/** Weighted mean of performance; 0 when there is no evidence weight. */
export function weightedMastery(signals: readonly EvidenceSignal[]): {
  mastery: number;
  totalWeight: number;
} {
  let num = 0;
  let den = 0;
  for (const s of signals) {
    num += s.weight * s.performance;
    den += s.weight;
  }
  return { mastery: den > 0 ? (num / den) * 100 : 0, totalWeight: den };
}

/**
 * Confidence in a derived estimate: grows with total evidence weight and shrinks
 * with inconsistency (high spread between observations).
 */
export function estimateConfidence(
  signals: readonly EvidenceSignal[],
  totalWeight: number,
  scale: number,
): number {
  if (signals.length === 0 || totalWeight <= 0) return 0;
  const evidenceConfidence = 1 - Math.exp(-totalWeight / scale);
  const mean =
    signals.reduce((acc, s) => acc + s.weight * s.performance, 0) / totalWeight;
  const variance =
    signals.reduce((acc, s) => acc + s.weight * (s.performance - mean) ** 2, 0) / totalWeight;
  const consistency = 1 - Math.min(1, variance * 4); // variance 0.25 → consistency 0
  return clamp01(evidenceConfidence * (0.5 + 0.5 * consistency));
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
