import type { ChildLearningTwin, Question, SkillId } from '@copilot/domain';

/**
 * Stretch-zone selection (Math Core §17): a practice set that is
 * ~70–80% solvable with current mastery and ~20–30% productive struggle.
 * Pure & deterministic given the candidate pool ordering.
 */
export interface StretchConfig {
  readonly solvableShare: number; // 0..1 target for "comfortable" items
  readonly struggleShare: number; // 0..1 target for "stretch" items
  /** A question is "solvable now" when skill mastery ≥ this for its knowledge level. */
  readonly comfortableMasteryByK: Readonly<Record<string, number>>;
}

export const DEFAULT_STRETCH_CONFIG: StretchConfig = {
  solvableShare: 0.75,
  struggleShare: 0.25,
  comfortableMasteryByK: { K0: 30, K1: 40, K2: 55, K3: 68, K4: 80, K5: 88 },
};

export function selectStretchSet(
  twin: ChildLearningTwin,
  pool: readonly Question[],
  count: number,
  config: StretchConfig = DEFAULT_STRETCH_CONFIG,
): Question[] {
  const masteryOf = (id: SkillId): number => twin.skillMastery.get(id)?.mastery ?? 40;

  const graded = pool.map((q) => {
    const threshold = config.comfortableMasteryByK[q.knowledgeLevel] ?? 60;
    const comfortable = masteryOf(q.skillId) >= threshold;
    return { q, comfortable };
  });

  const comfortable = graded.filter((g) => g.comfortable).map((g) => g.q);
  const stretch = graded.filter((g) => !g.comfortable).map((g) => g.q);

  const nComfort = Math.max(1, Math.round(count * config.solvableShare));
  const nStretch = Math.max(1, count - nComfort);

  const chosen = [...take(comfortable, nComfort), ...take(stretch, nStretch)];
  // top up from whichever pool still has items if one ran short
  const remaining = count - chosen.length;
  if (remaining > 0) {
    const rest = graded.map((g) => g.q).filter((q) => !chosen.includes(q));
    chosen.push(...take(rest, remaining));
  }
  return chosen.slice(0, count);
}

function take<T>(xs: readonly T[], n: number): T[] {
  return xs.slice(0, Math.max(0, n));
}
