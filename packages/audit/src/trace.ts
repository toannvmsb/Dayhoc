import type { DailyPlan, Evidence, GapId } from '@copilot/domain';
import type { GapEngineResult } from '@copilot/gap-engine';
import type { KnowledgeBase } from '@copilot/math-data';

/**
 * Recommendation audit trace (DoD MVP: "mọi khuyến nghị truy vết được").
 *
 * Given any recommendation the app shows the parent, produce the full chain back
 * to the raw evidence that justifies it — deterministic rule, provisional
 * coefficients, evidence records, provenance. Nothing the LLM produced sits
 * unattributed in this chain.
 */
export interface RecommendationTrace {
  readonly kind: 'gap' | 'prescription' | 'plan_action';
  readonly summary: string;
  readonly deterministicRule: string;
  readonly rootSkillId: string;
  readonly rootSkillName: string;
  readonly ruledOut: readonly string[];
  readonly scoreBreakdown?: Record<string, number>;
  readonly evidence: readonly EvidenceCitation[];
  readonly provisionalCoefficients: boolean;
  readonly aiInvolved: readonly string[]; // ai_inference ids referenced by cited evidence
}

export interface EvidenceCitation {
  readonly id: string;
  readonly occurredAt: string;
  readonly source: string;
  readonly provenance: string;
  readonly confidenceTier: string;
  readonly outcome: string;
  readonly skillId?: string;
  readonly aiInferenceId?: string;
}

function cite(e: Evidence): EvidenceCitation {
  return {
    id: e.id,
    occurredAt: e.occurredAt,
    source: e.source,
    provenance: e.provenance,
    confidenceTier: e.confidenceTier,
    outcome:
      e.result.correct === true ? 'đúng' : e.result.correct === false ? 'sai' : `điểm ${e.result.score ?? '?'}`,
    ...(e.skillId ? { skillId: e.skillId } : {}),
    ...(e.aiInferenceId ? { aiInferenceId: e.aiInferenceId } : {}),
  };
}

export function traceGap(
  gapId: GapId,
  engine: GapEngineResult,
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
): RecommendationTrace | null {
  const gap = engine.gaps.find((g) => g.id === gapId);
  if (!gap) return null;

  const cited = evidence.filter((e) => gap.evidenceRefs.includes(e.id));
  const rootName = kb.skills.get(gap.rootSkillId)?.name ?? gap.rootSkillId;

  return {
    kind: 'gap',
    summary: `${gap.type} tại "${rootName}"`,
    deterministicRule: `gap-engine classifier (priority order) → ${gap.type}; root-gap trace over prerequisite DAG`,
    rootSkillId: gap.rootSkillId,
    rootSkillName: rootName,
    ruledOut: gap.ruledOut,
    scoreBreakdown: {
      targetMasteryDifference: gap.score.targetMasteryDifference,
      evidenceConfidence: gap.score.evidenceConfidence,
      recurrenceFactor: gap.score.recurrenceFactor,
      prerequisiteImportance: gap.score.prerequisiteImportance,
      futureDependency: gap.score.futureDependency,
      learningGoalWeight: gap.score.learningGoalWeight,
      score: gap.score.score,
    },
    evidence: cited.map(cite),
    provisionalCoefficients: true,
    aiInvolved: [...new Set(cited.map((e) => e.aiInferenceId).filter((x): x is string => Boolean(x)))],
  };
}

export function tracePrescription(
  gapId: GapId,
  engine: GapEngineResult,
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
): RecommendationTrace | null {
  const base = traceGap(gapId, engine, evidence, kb);
  const rx = engine.prescriptions.find((p) => p.gapId === gapId);
  if (!base || !rx) return null;
  return {
    ...base,
    kind: 'prescription',
    summary: `${rx.gapLabel}: ${rx.sessions} phiên × ${rx.minutesPerSession}′ / ${rx.durationDays} ngày`,
    deterministicRule: `${base.deterministicRule}; prescription dose by gap type + severity band "${rx.severity}"`,
  };
}

export function tracePlanAction(
  plan: DailyPlan,
  actionIndex: number,
  engine: GapEngineResult,
  evidence: readonly Evidence[],
  kb: KnowledgeBase,
): RecommendationTrace | null {
  const action = plan.orderedActions[actionIndex];
  if (!action) return null;
  if (action.gapId) {
    const t = traceGap(action.gapId as GapId, engine, evidence, kb);
    if (t) return { ...t, kind: 'plan_action', summary: `${action.parentFacingTitle} (ROI/phút ${action.roiPerMinute})` };
  }
  const skill = action.targetSkillId ? kb.skills.get(action.targetSkillId) : undefined;
  return {
    kind: 'plan_action',
    summary: `${action.parentFacingTitle} (${action.mixBucket}, ROI/phút ${action.roiPerMinute})`,
    deterministicRule: `planner: candidate action "${action.kind}" scored by ROI-per-minute, fitted to Learning Mix`,
    rootSkillId: action.targetSkillId ?? '',
    rootSkillName: skill?.name ?? action.targetSkillId ?? '(none)',
    ruledOut: [],
    evidence: evidence
      .filter((e) => action.targetSkillId && e.skillId === action.targetSkillId)
      .map(cite),
    provisionalCoefficients: true,
    aiInvolved: [],
  };
}
