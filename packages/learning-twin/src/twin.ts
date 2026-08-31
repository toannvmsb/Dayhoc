import {
  asProblemTypeId,
  type ChildId,
  type ChildLearningTwin,
  type DomainFrontier,
  type Domain,
  type Evidence,
  type GradeContext,
  type MasteryState,
  type ProblemTypeId,
  type SkillId,
  type SkillMasteryState,
  type ThinkingDimension,
  type ThinkingDimensionState,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { DEFAULT_MASTERY_CONFIG, type MasteryConfig } from './config.js';
import {
  clamp01,
  decay,
  estimateConfidence,
  evidenceSignal,
  round,
  weightedMastery,
  type EvidenceSignal,
} from './signals.js';

export interface BuildTwinInput {
  readonly childId: ChildId;
  readonly gradeContext: GradeContext;
  readonly evidence: readonly Evidence[];
  readonly knowledgeBase: KnowledgeBase;
  readonly asOf?: Date;
  readonly config?: MasteryConfig;
}

const THINKING_ORDER: readonly ThinkingLevel[] = ['T1', 'T2', 'T3', 'T4', 'T5'];

/**
 * Build the Child Learning Twin from the evidence stream (Phase 3).
 * Pure & deterministic over its inputs — rebuilding from the same evidence yields
 * an identical twin. No I/O, no AI, no global "level".
 */
export function buildLearningTwin(input: BuildTwinInput): ChildLearningTwin {
  const { childId, gradeContext, evidence, knowledgeBase: kb } = input;
  const asOf = input.asOf ?? new Date();
  const config = input.config ?? DEFAULT_MASTERY_CONFIG;

  // Deterministic processing order: oldest evidence first, id as tiebreaker.
  const ordered = [...evidence].sort(
    (a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
  );

  const skillMastery = computeSkillMastery(ordered, kb, config, asOf);
  const problemTypeMastery = computeProblemTypeMastery(ordered, kb, config, asOf);
  const thinkingProfile = computeThinkingProfile(ordered, kb, config, asOf);
  const frontier = computeFrontier(skillMastery, kb, gradeContext, config);

  return {
    childId,
    computedAt: asOf.toISOString(),
    computedFromEvidenceCount: ordered.length,
    skillMastery,
    problemTypeMastery,
    thinkingProfile,
    frontier,
  };
}

function groupBy<T, K>(items: readonly T[], key: (item: T) => K | undefined): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === undefined) continue;
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function computeSkillMastery(
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
  config: MasteryConfig,
  asOf: Date,
): Map<SkillId, SkillMasteryState> {
  const out = new Map<SkillId, SkillMasteryState>();
  const bySkill = groupBy(evidence, (e) => (e.skillId && kb.skills.has(e.skillId) ? e.skillId : undefined));

  for (const [skillId, records] of [...bySkill.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const signals = records.map((e) => evidenceSignal(e, config, asOf));
    const { mastery, totalWeight } = weightedMastery(signals);
    const confidence = estimateConfidence(signals, totalWeight, config.confidenceWeightScale);

    const last = records[records.length - 1]!;
    const verifying = records.filter(
      (e) => e.result.correct === true && config.verifyingTiers.includes(e.confidenceTier),
    );
    const lastVerified = verifying[verifying.length - 1];
    const retention = lastVerified
      ? decay(
          (asOf.getTime() - Date.parse(lastVerified.occurredAt)) / 86_400_000,
          config.retentionHalfLifeDays,
        )
      : 0;

    out.set(skillId, {
      mastery: round(mastery, 1),
      confidence: round(confidence, 3),
      evidenceCount: records.length,
      lastObservedAt: last.occurredAt,
      retention: round(retention, 3),
      recentErrorStreak: trailingErrorStreak(records),
      lastVerifiedAt: lastVerified?.occurredAt ?? null,
    });
  }
  return out;
}

function trailingErrorStreak(records: readonly Evidence[]): number {
  let streak = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i]!.result.correct === false) streak++;
    else break;
  }
  return streak;
}

function computeProblemTypeMastery(
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
  config: MasteryConfig,
  asOf: Date,
): Map<ProblemTypeId, MasteryState> {
  const out = new Map<ProblemTypeId, MasteryState>();
  const known = new Set(kb.problemTypes.map((pt) => pt.id));
  const byType = groupBy(evidence, (e) =>
    e.problemTypeId && known.has(e.problemTypeId) ? e.problemTypeId : undefined,
  );

  for (const [ptId, records] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const signals = records.map((e) => evidenceSignal(e, config, asOf));
    const { mastery, totalWeight } = weightedMastery(signals);
    out.set(asProblemTypeId(ptId), {
      mastery: round(mastery, 1),
      confidence: round(estimateConfidence(signals, totalWeight, config.confidenceWeightScale), 3),
      evidenceCount: records.length,
      lastObservedAt: records[records.length - 1]!.occurredAt,
    });
  }
  return out;
}

/**
 * Thinking profile — SEPARATE from knowledge mastery. For each dimension, look at
 * evidence on skills that exercise it; `demonstratedLevel` is the highest thinking
 * level at which the child has positive evidence (can't claim T5 from T2 items).
 */
function computeThinkingProfile(
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
  config: MasteryConfig,
  asOf: Date,
): Map<ThinkingDimension, ThinkingDimensionState> {
  const ptById = new Map(kb.problemTypes.map((pt) => [pt.id, pt]));

  const perDimension = new Map<
    ThinkingDimension,
    { signals: EvidenceSignal[]; maxPositiveLevel: number }
  >();

  for (const e of evidence) {
    if (!e.skillId) continue;
    const skill = kb.skills.get(e.skillId);
    if (!skill || skill.thinkingDimensions.length === 0) continue;

    const signal = evidenceSignal(e, config, asOf);
    const thinkingLevel = e.problemTypeId ? ptById.get(e.problemTypeId)?.thinkingLevel : undefined;
    const levelIndex = thinkingLevel ? THINKING_ORDER.indexOf(thinkingLevel) : -1;
    const positive = signal.performance >= 0.6;

    for (const dim of skill.thinkingDimensions) {
      const entry = perDimension.get(dim) ?? { signals: [], maxPositiveLevel: -1 };
      entry.signals.push(signal);
      if (positive && levelIndex > entry.maxPositiveLevel) entry.maxPositiveLevel = levelIndex;
      perDimension.set(dim, entry);
    }
  }

  const out = new Map<ThinkingDimension, ThinkingDimensionState>();
  for (const [dim, entry] of [...perDimension.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { mastery, totalWeight } = weightedMastery(entry.signals);
    out.set(dim, {
      demonstratedLevel: entry.maxPositiveLevel >= 0 ? THINKING_ORDER[entry.maxPositiveLevel]! : null,
      score: round(mastery, 1),
      confidence: round(estimateConfidence(entry.signals, totalWeight, config.confidenceWeightScale), 3),
      evidenceCount: entry.signals.length,
    });
  }
  return out;
}

/**
 * Per-domain Actual Learning Frontier — the furthest curriculum origin the child
 * shows real traction on, domain by domain. NEVER one global grade level.
 */
function computeFrontier(
  skillMastery: ReadonlyMap<SkillId, SkillMasteryState>,
  kb: KnowledgeBase,
  gradeContext: GradeContext,
  config: MasteryConfig,
): DomainFrontier[] {
  const perDomain = new Map<
    Domain,
    { reached: number; evidenceCount: number; masterySum: number; masteryN: number }
  >();

  for (const [skillId, state] of skillMastery) {
    const skill = kb.skills.get(skillId);
    if (!skill) continue;
    const entry = perDomain.get(skill.domain) ?? {
      reached: 0,
      evidenceCount: 0,
      masterySum: 0,
      masteryN: 0,
    };
    entry.evidenceCount += state.evidenceCount;
    entry.masterySum += state.mastery;
    entry.masteryN += 1;
    if (state.mastery >= config.frontierMasteryThreshold) {
      entry.reached = Math.max(entry.reached, skill.curriculumOrigin);
    }
    perDomain.set(skill.domain, entry);
  }

  return [...perDomain.entries()]
    .filter(([, v]) => v.masteryN > 0)
    .map(([domain, v]) => {
      const aboveGrade = v.reached > gradeContext;
      const avg = v.masterySum / v.masteryN;
      const band = avg >= 75 ? 'strong' : avg >= 50 ? 'standard' : 'emerging';
      return {
        domain,
        frontierLabel: aboveGrade
          ? `above_grade_G${v.reached}_exposure`
          : `grade_${gradeContext}_${band}`,
        reachedCurriculumOrigin: v.reached || gradeContext,
        aboveGrade,
        evidenceCount: v.evidenceCount,
      };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export { clamp01 };
