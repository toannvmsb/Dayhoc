import type { Plan } from './subscription.js';

/**
 * Plan feature/quota entitlements (M7).
 *
 * CRITICAL: entitlements gate FEATURE ACCESS and QUOTAS only. They NEVER select
 * which AI model runs, the reasoning effort, or the verification path — model
 * routing is driven by the operation + safety, not by what the family pays
 * (`@copilot/ai` AIModelRouter.PLAN_DOES_NOT_SELECT_MODEL). There is deliberately
 * no `aiModel` / `modelTier` field here.
 */
export interface PlanEntitlements {
  readonly plan: Plan;
  /** Recommended plan gets the badge in the picker. */
  readonly recommended: boolean;
  readonly priceVnd: number | null;
  /** Max child profiles in the family. */
  readonly maxChildren: number;
  /** Max ACCEPTED teacher connections per child. `null` = unlimited. */
  readonly maxTeacherConnectionsPerChild: number | null;
  /** Evidence uploads that get document-vision analysis per calendar month. */
  readonly evidenceAnalysesPerMonth: number;
  /** Exam intelligence: revision map + post-exam diagnosis. */
  readonly examIntelligence: boolean;
  /** Parent Teaching Copilot. */
  readonly teachingCopilot: boolean;
  /** AI natural-language interpretation of the learning state (domain: AI interpretation). */
  readonly aiInterpretation: boolean;
  /** Weekly progress report. */
  readonly weeklyReport: boolean;
  readonly prioritySupport: boolean;
}

export const PLAN_ENTITLEMENTS: Readonly<Record<Plan, PlanEntitlements>> = {
  free: {
    plan: 'free',
    recommended: false,
    priceVnd: null,
    maxChildren: 1,
    maxTeacherConnectionsPerChild: 1,
    evidenceAnalysesPerMonth: 4,
    examIntelligence: false,
    teachingCopilot: true,
    aiInterpretation: false,
    weeklyReport: false,
    prioritySupport: false,
  },
  basic: {
    plan: 'basic',
    recommended: false,
    priceVnd: 169_000,
    maxChildren: 2,
    maxTeacherConnectionsPerChild: 2,
    evidenceAnalysesPerMonth: 20,
    examIntelligence: true,
    teachingCopilot: true,
    aiInterpretation: false,
    weeklyReport: true,
    prioritySupport: false,
  },
  plus: {
    plan: 'plus',
    recommended: true,
    priceVnd: 229_000,
    maxChildren: 3,
    maxTeacherConnectionsPerChild: 4,
    evidenceAnalysesPerMonth: 60,
    examIntelligence: true,
    teachingCopilot: true,
    aiInterpretation: true,
    weeklyReport: true,
    prioritySupport: false,
  },
  pro: {
    plan: 'pro',
    recommended: false,
    priceVnd: 329_000,
    maxChildren: 6,
    maxTeacherConnectionsPerChild: null,
    evidenceAnalysesPerMonth: 200,
    examIntelligence: true,
    teachingCopilot: true,
    aiInterpretation: true,
    weeklyReport: true,
    prioritySupport: true,
  },
};

export function entitlementsFor(plan: Plan): PlanEntitlements {
  return PLAN_ENTITLEMENTS[plan];
}

/** Feature flags a caller can gate on (never includes anything model-related). */
export type EntitlementFeature =
  | 'examIntelligence'
  | 'teachingCopilot'
  | 'aiInterpretation'
  | 'weeklyReport';

export function planAllows(plan: Plan, feature: EntitlementFeature): boolean {
  return PLAN_ENTITLEMENTS[plan][feature];
}
