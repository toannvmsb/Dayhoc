/**
 * Model routing (Pricing + AI Cost Guardrails v1.0 §3, §4).
 *
 * Luna-first: 85–95% of production AI calls should stay on Luna or on the
 * deterministic / verified-question-bank paths (§3.1). Escalation to an advanced
 * model is gated by measured confidence / conflict / difficulty — never by
 * preference. The advanced model itself (Claude Sonnet 5 vs GPT-5.6 Terra) is
 * BENCHMARK-GATED (§3.2, §11) and therefore not chosen here.
 *
 * This module is pure config + a resolver. No business rule may depend on a
 * concrete provider SDK object (§9).
 */

/** Operation vocabulary — aligned with telemetry `operation_type` (§7). */
export const AI_OPERATIONS = [
  'document_classify',
  'vision_extract',
  'skill_map',
  'problem_type_map',
  'diagnose',
  'generate_standard',
  'generate_advanced',
  'explain',
  'parent_summary',
  'plan_wording',
  'verify',
  'golden_eval',
] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

/**
 * Execution tiers, cheapest → most expensive. The planner/orchestrator always
 * prefers the lowest tier that can satisfy the request.
 */
export const ROUTING_TIERS = [
  'deterministic',
  'question_bank',
  'cache',
  'luna',
  'ocr_assist',
  'advanced',
  'offline_qa',
] as const;
export type RoutingTier = (typeof ROUTING_TIERS)[number];

export interface RoutingRule {
  readonly operation: AiOperation;
  readonly primary: RoutingTier;
  /** Tier to escalate to when a gate below trips. `null` = never escalate live. */
  readonly escalateTo: RoutingTier | null;
  /** Human-readable escalation conditions (also encoded in `shouldEscalate`). */
  readonly escalateWhen: readonly string[];
}

/** §4 Model Routing Matrix, as data. */
export const ROUTING_MATRIX: Readonly<Record<AiOperation, RoutingRule>> = {
  document_classify: { operation: 'document_classify', primary: 'deterministic', escalateTo: 'luna', escalateWhen: ['low_confidence'] },
  vision_extract: { operation: 'vision_extract', primary: 'luna', escalateTo: 'ocr_assist', escalateWhen: ['handwriting', 'math_layout', 'low_confidence'] },
  skill_map: { operation: 'skill_map', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['ambiguous_candidates'] },
  problem_type_map: { operation: 'problem_type_map', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['ambiguous_candidates'] },
  diagnose: { operation: 'diagnose', primary: 'deterministic', escalateTo: 'advanced', escalateWhen: ['conflicting_evidence', 'complex_root_cause'] },
  generate_standard: { operation: 'generate_standard', primary: 'question_bank', escalateTo: 'luna', escalateWhen: ['personalization_missing'] },
  generate_advanced: { operation: 'generate_advanced', primary: 'question_bank', escalateTo: 'advanced', escalateWhen: ['k4_k5', 't4_t5'] },
  explain: { operation: 'explain', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['complex_synthesis'] },
  parent_summary: { operation: 'parent_summary', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['complex_synthesis'] },
  plan_wording: { operation: 'plan_wording', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['planner_conflict'] },
  verify: { operation: 'verify', primary: 'advanced', escalateTo: 'offline_qa', escalateWhen: ['verifier_disagreement'] },
  golden_eval: { operation: 'golden_eval', primary: 'offline_qa', escalateTo: null, escalateWhen: ['hardest_adjudication'] },
};

/** Things a deterministic rule must own — the LLM never routes to owning these (§4). */
export const LLM_NEVER_OWNS = [
  'production_skill_ids',
  'prerequisite_dag',
  'permissions',
  'consent',
  'gap_lifecycle_thresholds',
  'mastery_formula',
  'time_budget_constraints',
  'billing_quota_enforcement',
] as const;

export interface RouteContext {
  /** Vision/first-pass model confidence, 0..1. */
  readonly confidence?: number;
  /** Confidence below this escalates or requests a rescan (benchmark-gated §11). */
  readonly escalateBelowConfidence?: number;
  readonly conflictingEvidence?: boolean;
  readonly ambiguousCandidates?: boolean;
  readonly handwriting?: boolean;
  readonly mathLayout?: boolean;
  /** Highest knowledge level in the item (K0..K5). */
  readonly knowledgeLevel?: string;
  /** Highest thinking level in the item (T1..T5). */
  readonly thinkingLevel?: string;
  readonly personalizationMissing?: boolean;
  readonly verifierDisagreement?: boolean;
  readonly questionBankHit?: boolean;
}

export interface RouteDecision {
  readonly operation: AiOperation;
  readonly tier: RoutingTier;
  readonly escalated: boolean;
  readonly reason: string;
  /** True when the resolved tier is `advanced` but no advanced model is chosen yet. */
  readonly advancedModelPending: boolean;
}

const HIGH_K = new Set(['K4', 'K5']);
const HIGH_T = new Set(['T4', 'T5']);

/** Decide the tier for one operation. Pure; does not perform the call. */
export function resolveRoute(
  operation: AiOperation,
  ctx: RouteContext = {},
  opts: { advancedModelChosen?: boolean } = {},
): RouteDecision {
  const rule = ROUTING_MATRIX[operation];
  const below =
    ctx.confidence !== undefined &&
    ctx.escalateBelowConfidence !== undefined &&
    ctx.confidence < ctx.escalateBelowConfidence;

  const reasons: string[] = [];
  if (below) reasons.push('low_confidence');
  if (ctx.conflictingEvidence) reasons.push('conflicting_evidence');
  if (ctx.ambiguousCandidates) reasons.push('ambiguous_candidates');
  if (ctx.handwriting) reasons.push('handwriting');
  if (ctx.mathLayout) reasons.push('math_layout');
  if (ctx.personalizationMissing) reasons.push('personalization_missing');
  if (ctx.verifierDisagreement) reasons.push('verifier_disagreement');
  if (HIGH_K.has(ctx.knowledgeLevel ?? '')) reasons.push('k4_k5');
  if (HIGH_T.has(ctx.thinkingLevel ?? '')) reasons.push('t4_t5');

  // question-bank operations stay on the bank unless personalization is missing
  if ((operation === 'generate_standard' || operation === 'generate_advanced') && ctx.questionBankHit && !ctx.personalizationMissing) {
    return { operation, tier: 'question_bank', escalated: false, reason: 'verified_question_bank_hit', advancedModelPending: false };
  }

  const shouldEscalate = reasons.length > 0 && rule.escalateTo !== null;
  const tier = shouldEscalate ? rule.escalateTo! : rule.primary;
  const advancedModelPending = tier === 'advanced' && !opts.advancedModelChosen;

  return {
    operation,
    tier,
    escalated: shouldEscalate,
    reason: shouldEscalate ? reasons.join('+') : `primary:${rule.primary}`,
    advancedModelPending,
  };
}

/** Share of calls that must stay off the advanced model (§3.1). */
export const LUNA_OR_CHEAPER_TARGET_MIN = 0.85;
export const LUNA_OR_CHEAPER_TARGET_MAX = 0.95;

const CHEAP_TIERS = new Set<RoutingTier>(['deterministic', 'question_bank', 'cache', 'luna']);

/** Given a batch of decisions, the fraction that stayed on Luna or cheaper. */
export function cheapPathShare(decisions: readonly RouteDecision[]): number {
  if (decisions.length === 0) return 1;
  const cheap = decisions.filter((d) => CHEAP_TIERS.has(d.tier)).length;
  return cheap / decisions.length;
}
