import type { WorksheetResult } from './worksheet-orchestrator.js';

export const WORKSHEET_METRICS_VERSION = 'worksheet-metrics.v1';

/**
 * SAFE DEGRADED COMPLETION product metrics (doc 68 §8). Computed from a cohort of
 * orchestrator results. The old headline "full worksheet completion" metric is
 * replaced by CORE_WORKSHEET_DELIVERY_RATE; VERIFIED_DELIVERY_RATE and
 * UNSAFE_DELIVERY_RATE are the safety-critical ones (100% / 0%).
 */
export interface WorksheetCohortMetrics {
  readonly worksheets: number;
  readonly deliveredItems: number;
  /** worksheets where 100% of REQUIRED_CORE slots are READY. Target ≥ 99%. */
  readonly coreWorksheetDeliveryRate: number;
  /** delivered items that are deterministically correct OR crosscheck-PASS. Target 100%. */
  readonly verifiedDeliveryRate: number;
  /** delivered items that are neither. Target 0%. */
  readonly unsafeDeliveryRate: number;
  readonly unsafeDeliveredItemIds: readonly string[];
  /** worksheets carrying ≥1 optional (stretch/reasoning/challenge) item, / worksheets. */
  readonly optionalChallengeAvailability: number;
  /** REQUIRED_CORE slots delivered via a safe substitute, / core slots. */
  readonly safeSubstitutionRate: number;
  /** optional slots omitted from the child worksheet, / optional slots. */
  readonly optionalOmissionRate: number;
  /** slots that raised a review-queue row, / all slots. */
  readonly reviewQueueRate: number;
  readonly worksheetStateCounts: Readonly<Record<string, number>>;
  /** exact reason for every omitted / substituted slot (doc 68 §14). */
  readonly degradeReasons: readonly {
    readonly generationSpecId: string;
    readonly itemId: string;
    readonly kind: 'OMITTED' | 'SUBSTITUTED';
    readonly criticality: string;
    readonly reason: string;
  }[];
}

const OPTIONAL = new Set(['OPTIONAL_STRETCH', 'OPTIONAL_REASONING', 'CHALLENGE']);

export function computeWorksheetCohortMetrics(results: readonly WorksheetResult[]): WorksheetCohortMetrics {
  let coreDelivered = 0;
  let deliveredItems = 0;
  let verifiedItems = 0;
  const unsafeIds: string[] = [];
  let coreSlots = 0;
  let coreSubstituted = 0;
  let optionalSlots = 0;
  let optionalOmitted = 0;
  let allSlots = 0;
  let reviewRows = 0;
  let worksheetsWithOptional = 0;
  const stateCounts: Record<string, number> = {};
  const degradeReasons: WorksheetCohortMetrics['degradeReasons'][number][] = [];

  for (const r of results) {
    stateCounts[r.worksheetState] = (stateCounts[r.worksheetState] ?? 0) + 1;
    if (r.worksheetState !== 'FAILED') coreDelivered += 1;

    let hasOptional = false;
    for (const s of r.trace.perSlot) {
      allSlots += 1;
      if (s.reviewQueueId) reviewRows += 1;
      if (s.criticality === 'REQUIRED_CORE') {
        coreSlots += 1;
        if (s.substituted) coreSubstituted += 1;
      } else {
        optionalSlots += 1;
        hasOptional = true;
        if (s.omitted) optionalOmitted += 1;
      }
      if (s.finalState === 'READY') {
        deliveredItems += 1;
        // a delivered item is "verified" iff a deterministic check or a Group-C
        // crosscheck PASS backs its answer — schema validity alone never counts.
        const verified = s.answerStatus === 'DETERMINISTIC_CORRECT' || s.crosscheckVerdict === 'PASS';
        if (verified) verifiedItems += 1;
        else unsafeIds.push(s.itemId);
      }
    }
    if (hasOptional) worksheetsWithOptional += 1;

    for (const o of r.omittedReports) {
      degradeReasons.push({ generationSpecId: r.trace.generationSpecId, itemId: o.itemId, kind: 'OMITTED', criticality: o.criticality, reason: o.reason });
    }
    for (const o of r.substitutedReports) {
      degradeReasons.push({ generationSpecId: r.trace.generationSpecId, itemId: o.itemId, kind: 'SUBSTITUTED', criticality: o.criticality, reason: o.reason });
    }
  }

  const n = results.length || 1;
  return {
    worksheets: results.length,
    deliveredItems,
    coreWorksheetDeliveryRate: coreDelivered / n,
    verifiedDeliveryRate: deliveredItems > 0 ? verifiedItems / deliveredItems : 1,
    unsafeDeliveryRate: deliveredItems > 0 ? unsafeIds.length / deliveredItems : 0,
    unsafeDeliveredItemIds: unsafeIds,
    optionalChallengeAvailability: worksheetsWithOptional / n,
    safeSubstitutionRate: coreSlots > 0 ? coreSubstituted / coreSlots : 0,
    optionalOmissionRate: optionalSlots > 0 ? optionalOmitted / optionalSlots : 0,
    reviewQueueRate: allSlots > 0 ? reviewRows / allSlots : 0,
    worksheetStateCounts: stateCounts,
    degradeReasons,
  };
}

export { OPTIONAL as OPTIONAL_CRITICALITIES };
