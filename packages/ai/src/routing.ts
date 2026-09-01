/**
 * AI model routing (Pricing/AI Cost/Routing **v1.1** §7, `ai_model_routing_v1.1.yaml`).
 * See docs/implementation/15_AI_COST_AND_MODEL_ROUTING.md.
 *
 * Luna-first. **The subscription plan NEVER selects the model** — educational
 * need + confidence + difficulty do (v1.1 non-negotiable). Plan sets only the
 * budget envelope (`@copilot/ai` `budget.ts`). The advanced model itself
 * (GPT-5.6 Terra vs Claude Sonnet 5) is BENCHMARK-GATED and not chosen here.
 *
 * Pure config + a resolver. No business rule may depend on a concrete provider
 * SDK object.
 */

/**
 * Operation vocabulary — v1.1 §4/§10. Cost + volume are tracked per operation,
 * not per user. Keep aligned with `AiUsageEvent.operationType`.
 */
export const AI_OPERATIONS = [
  'worksheet_batch_generation', // 1 spec → 1 call → N questions (the daily default)
  'next_best_question', // adaptive, event-driven, 1 item
  'vision_extraction',
  'content_classify',
  'skill_map',
  'error_diagnosis',
  'parent_copilot',
  'teach_me',
  'weekly_summary',
  'exam_revision',
  'advanced_verification',
  'golden_eval', // offline only
] as const;
export type AiOperation = (typeof AI_OPERATIONS)[number];

/**
 * Execution tiers, cheapest → most expensive. The orchestrator prefers the
 * lowest tier that satisfies the request. `question_bank` is GONE — v1.1 is
 * AI-generation-first; a static bank is never a delivery/routing tier.
 */
export const ROUTING_TIERS = [
  'deterministic', // no AI
  'cache', // reuse a prior generated / classified result
  'luna', // default production model
  'ocr_assist', // Luna + separate OCR fallback
  'advanced', // advanced candidate (Terra / Sonnet — benchmark-gated)
  'offline_qa', // Sol — offline only, never routine production
] as const;
export type RoutingTier = (typeof ROUTING_TIERS)[number];

export interface RoutingRule {
  readonly operation: AiOperation;
  readonly primary: RoutingTier;
  /** Tier to escalate to when a gate trips. `null` = never escalate live. */
  readonly escalateTo: RoutingTier | null;
  readonly escalateWhen: readonly string[];
}

/** v1.1 §7 routing rules, as data. */
export const ROUTING_MATRIX: Readonly<Record<AiOperation, RoutingRule>> = {
  worksheet_batch_generation: { operation: 'worksheet_batch_generation', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['k4_k5', 't4_t5', 'hsg'] },
  next_best_question: { operation: 'next_best_question', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['k4_k5', 't4_t5', 'hsg'] },
  vision_extraction: { operation: 'vision_extraction', primary: 'luna', escalateTo: 'ocr_assist', escalateWhen: ['handwriting', 'math_layout', 'low_confidence'] },
  content_classify: { operation: 'content_classify', primary: 'deterministic', escalateTo: 'luna', escalateWhen: ['low_confidence'] },
  skill_map: { operation: 'skill_map', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['ambiguous_candidates'] },
  error_diagnosis: { operation: 'error_diagnosis', primary: 'deterministic', escalateTo: 'advanced', escalateWhen: ['conflicting_evidence', 'complex_root_cause'] },
  parent_copilot: { operation: 'parent_copilot', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['complex_synthesis'] },
  teach_me: { operation: 'teach_me', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['complex_synthesis'] },
  weekly_summary: { operation: 'weekly_summary', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['complex_synthesis'] },
  exam_revision: { operation: 'exam_revision', primary: 'luna', escalateTo: 'advanced', escalateWhen: ['complex_synthesis'] },
  advanced_verification: { operation: 'advanced_verification', primary: 'advanced', escalateTo: 'offline_qa', escalateWhen: ['verifier_disagreement'] },
  golden_eval: { operation: 'golden_eval', primary: 'offline_qa', escalateTo: null, escalateWhen: ['hardest_adjudication'] },
};

/** Things a deterministic rule must own — the LLM never routes to owning these (v1.1 §8). */
export const LLM_NEVER_OWNS = [
  'production_skill_ids',
  'prerequisite_dag',
  'permissions',
  'consent',
  'gap_lifecycle_thresholds',
  'mastery_formula',
  'readiness_rules',
  'planner_constraints',
  'schema_enforcement',
  'cost_guardrails',
  'parent_goal',
  'curriculum_level',
] as const;

/** Advanced-candidate triggers (v1.1 §7). ANY of these routes to the advanced tier. */
export const ADVANCED_TRIGGERS = [
  'k4_k5',
  't4_t5',
  'hsg',
  'difficult_proof',
  'nonlinear_algebra',
  'complex_root_cause',
  'verifier_disagreement',
  'low_confidence',
] as const;
export type AdvancedTrigger = (typeof ADVANCED_TRIGGERS)[number];

export interface RouteContext {
  /** First-pass model confidence, 0..1. */
  readonly confidence?: number;
  /** Confidence below this escalates or requests a rescan (benchmark-gated). */
  readonly escalateBelowConfidence?: number;
  readonly conflictingEvidence?: boolean;
  readonly complexRootCause?: boolean;
  readonly ambiguousCandidates?: boolean;
  readonly handwriting?: boolean;
  readonly mathLayout?: boolean;
  readonly complexSynthesis?: boolean;
  /** Highest knowledge level in the item (K0..K5). */
  readonly knowledgeLevel?: string;
  /** Highest thinking level in the item (T1..T5). */
  readonly thinkingLevel?: string;
  readonly hsg?: boolean;
  readonly difficultProof?: boolean;
  readonly nonlinearAlgebra?: boolean;
  readonly verifierDisagreement?: boolean;
}

export interface RouteDecision {
  readonly operation: AiOperation;
  /** The tier this operation *should* run on. */
  readonly tier: RoutingTier;
  /**
   * The tier that ACTUALLY runs now. Differs from `tier` only while the advanced
   * model is un-chosen (benchmark pending): the call falls back to Luna at high
   * effort and is flagged for offline QA.
   */
  readonly effectiveTier: RoutingTier;
  readonly effort: 'standard' | 'high';
  readonly escalated: boolean;
  readonly reason: string;
  /** True when the resolved tier is `advanced` but no advanced model is chosen yet. */
  readonly advancedModelPending: boolean;
  /** `escalated_from` for telemetry — the primary tier when an escalation fired. */
  readonly escalatedFrom: RoutingTier | null;
  /** Non-null when the deterministic result should get a human / offline-QA second look. */
  readonly reviewReason: string | null;
}

const HIGH_K = new Set(['K4', 'K5']);
const HIGH_T = new Set(['T4', 'T5']);

/**
 * Decide the tier for one operation. Pure; does not perform the call.
 * NOTE: there is deliberately no `plan` parameter — the plan must not influence
 * the model choice (v1.1 non-negotiable).
 */
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
  if (ctx.complexRootCause) reasons.push('complex_root_cause');
  if (ctx.ambiguousCandidates) reasons.push('ambiguous_candidates');
  if (ctx.handwriting) reasons.push('handwriting');
  if (ctx.mathLayout) reasons.push('math_layout');
  if (ctx.complexSynthesis) reasons.push('complex_synthesis');
  if (ctx.verifierDisagreement) reasons.push('verifier_disagreement');
  if (ctx.hsg) reasons.push('hsg');
  if (ctx.difficultProof) reasons.push('difficult_proof');
  if (ctx.nonlinearAlgebra) reasons.push('nonlinear_algebra');
  if (HIGH_K.has(ctx.knowledgeLevel ?? '')) reasons.push('k4_k5');
  if (HIGH_T.has(ctx.thinkingLevel ?? '')) reasons.push('t4_t5');

  const shouldEscalate = reasons.length > 0 && rule.escalateTo !== null;
  const tier = shouldEscalate ? rule.escalateTo! : rule.primary;
  const advancedModelPending = tier === 'advanced' && !opts.advancedModelChosen;

  const effectiveTier: RoutingTier = advancedModelPending ? 'luna' : tier;
  const effort: 'standard' | 'high' = advancedModelPending ? 'high' : 'standard';
  const reviewReason = advancedModelPending
    ? `advanced_tier_served_by_luna_fallback(${shouldEscalate ? reasons.join('+') : 'primary'})`
    : null;

  return {
    operation,
    tier,
    effectiveTier,
    effort,
    escalated: shouldEscalate,
    reason: shouldEscalate ? reasons.join('+') : `primary:${rule.primary}`,
    advancedModelPending,
    escalatedFrom: shouldEscalate ? rule.primary : null,
    reviewReason,
  };
}

/**
 * `AIModelRouter` — the v1.1 named service. Thin wrapper over `resolveRoute` that
 * binds the "advanced model chosen?" state and rejects any attempt to route by plan.
 */
export class AIModelRouter {
  readonly #advancedModelChosen: boolean;
  constructor(opts: { advancedModelChosen?: boolean } = {}) {
    this.#advancedModelChosen = opts.advancedModelChosen ?? false;
  }
  route(operation: AiOperation, ctx: RouteContext = {}): RouteDecision {
    return resolveRoute(operation, ctx, { advancedModelChosen: this.#advancedModelChosen });
  }
  /** Explicit: the plan is not, and must never be, an input to the route. */
  static readonly PLAN_DOES_NOT_SELECT_MODEL = true;
}

/** Share of calls that must stay off the advanced model (v1.1 §7). */
export const LUNA_OR_CHEAPER_TARGET_MIN = 0.85;
export const LUNA_OR_CHEAPER_TARGET_MAX = 0.95;

const CHEAP_TIERS = new Set<RoutingTier>(['deterministic', 'cache', 'luna']);

/**
 * Fraction of a decision batch that actually ran on Luna or cheaper. Uses
 * `effectiveTier` — the advanced-tier Luna fallback counts as cheap.
 */
export function cheapPathShare(decisions: readonly RouteDecision[]): number {
  if (decisions.length === 0) return 1;
  const cheap = decisions.filter((d) => CHEAP_TIERS.has(d.effectiveTier)).length;
  return cheap / decisions.length;
}
