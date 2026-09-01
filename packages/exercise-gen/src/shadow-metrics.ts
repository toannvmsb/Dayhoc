import {
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type ExerciseGenerationSpec,
  type GeneratedExercise,
} from '@copilot/domain';
import type { OrchestratorResult } from './orchestrator.js';
import type { AnswerVerificationSummary } from './answer-verification.js';

/**
 * Shadow quality/cost aggregation (doc 14 C5 §17). Pure — computes review
 * metrics from a batch of shadow runs. These are BENCHMARK metrics for a human
 * review gate (§18), never an automatic LIVE flip.
 */

export interface ShadowMetricRecord {
  readonly spec: ExerciseGenerationSpec;
  readonly result: OrchestratorResult;
  readonly answerVerification: AnswerVerificationSummary | null;
}

export interface ShadowMetrics {
  readonly shadowBatches: number;
  readonly firstPassSchemaRate: number;
  readonly firstPassValidatorPassRate: number;
  readonly finalDeliverableRate: number;
  readonly repairRate: number;
  readonly regenerationRate: number;
  readonly quarantineRate: number;
  readonly averageGenerationAttempts: number;
  readonly averageRepairAttempts: number;
  readonly answerFormatValidRate: number;
  readonly answerDeterministicCorrectnessVerifiedRate: number;
  readonly answerCrosscheckRequiredRate: number;
  readonly answerUnverifiedRate: number;
  readonly skillAdherenceRate: number;
  readonly bucketAdherenceRate: number;
  readonly kAdherenceRate: number;
  readonly tAdherenceRate: number;
  readonly referenceCopyRate: number;
  readonly noInventedSkillIdRate: number;
  readonly noForbiddenKnowledgeRate: number;
  readonly averageLatencyMs: number;
  readonly p50LatencyMs: number;
  readonly p95LatencyMs: number;
  readonly averageInputTokens: number;
  readonly averageOutputTokens: number;
  readonly averageActualCostVndPerBatch: number;
  readonly averageActualCostVndPerQuestion: number;
  readonly failuresByReasonCode: Readonly<Record<string, number>>;
}

const INVENTED_ID_CODES = new Set(['UNKNOWN_SKILL_ID', 'UNKNOWN_REQUIRED_SKILL_ID', 'UNKNOWN_PROBLEM_TYPE']);
const FORBIDDEN_KNOWLEDGE_CODES = new Set([
  'UNLEARNED_REQUIRED_KNOWLEDGE',
  'ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED',
  'REQUIRED_SKILL_OUT_OF_BOUNDS',
  'FRONTIER_SKILL_NOT_SELECTED',
]);

export function aggregateShadowMetrics(records: readonly ShadowMetricRecord[]): ShadowMetrics {
  const n = records.length;
  if (n === 0) return EMPTY;

  const latencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let tokenOps = 0;
  let totalCostVnd = 0;
  let costRuns = 0;
  let totalQuestions = 0;

  let deliverable = 0;
  let firstPassSchema = 0;
  let firstPassValidator = 0;
  let repaired = 0;
  let regenerated = 0;
  let quarantined = 0;
  let genAttempts = 0;
  let repairAttempts = 0;
  let referenceCopy = 0;
  let inventedId = 0;
  let forbiddenKnowledge = 0;

  let acceptedItems = 0;
  let skillOk = 0;
  let bucketOk = 0;
  let kOk = 0;
  let tOk = 0;

  let avTotal = 0;
  let avFormatValid = 0;
  let avDeterministic = 0;
  let avCrosscheck = 0;
  let avUnverified = 0;

  const failuresByReasonCode: Record<string, number> = {};

  for (const rec of records) {
    const { trace } = rec.result;
    genAttempts += trace.generationAttempts;
    repairAttempts += trace.repairAttempts;

    const firstOp = trace.operations[0];
    if (firstOp?.schemaValid) firstPassSchema += 1;
    for (const op of trace.operations) {
      latencies.push(op.latencyMs);
      if (op.inputTokens !== null || op.outputTokens !== null) {
        inputTokens += op.inputTokens ?? 0;
        outputTokens += op.outputTokens ?? 0;
        tokenOps += 1;
      }
      if (op.actualCostVnd !== null) {
        totalCostVnd += op.actualCostVnd;
      }
    }
    if (trace.operations.some((op) => op.actualCostVnd !== null)) costRuns += 1;

    const validation = rec.result.status === 'delivered' ? rec.result.validation : rec.result.lastValidation;
    if (validation) {
      if (validation.findings.length === 0) firstPassValidator += 1;
      for (const code of validation.reasonCodes) {
        failuresByReasonCode[code] = (failuresByReasonCode[code] ?? 0) + 1;
      }
      if (validation.reasonCodes.includes('REFERENCE_EXAMPLE_COPY')) referenceCopy += 1;
      if (validation.reasonCodes.some((c) => INVENTED_ID_CODES.has(c))) inventedId += 1;
      if (validation.reasonCodes.some((c) => FORBIDDEN_KNOWLEDGE_CODES.has(c))) forbiddenKnowledge += 1;
    }

    if (trace.repairAttempts > 0) repaired += 1;
    if (trace.finalDisposition === 'QUARANTINE') quarantined += 1;
    if (trace.finalDisposition === 'REGENERATE_SLOTS') regenerated += 1;

    if (rec.result.status === 'delivered') {
      deliverable += 1;
      totalQuestions += rec.spec.generationPlan.totalQuestions;
      for (const item of rec.result.batch.items) {
        acceptedItems += 1;
        if (adhSkill(item, rec.spec)) skillOk += 1;
        if (adhBucket(item, rec.spec)) bucketOk += 1;
        if (adhK(item, rec.spec)) kOk += 1;
        if (adhT(item, rec.spec)) tOk += 1;
      }
    }

    if (rec.answerVerification) {
      const av = rec.answerVerification;
      avTotal += av.total;
      avFormatValid += Math.round(av.formatValidRate * av.total);
      avDeterministic += av.byLevel.DETERMINISTIC_CORRECTNESS_VERIFIED + av.byLevel.HUMAN_GOLDEN_VERIFIED;
      avCrosscheck += av.byLevel.FORMAT_VERIFIED + av.byLevel.AI_CROSSCHECK_REQUIRED;
      avUnverified += av.byLevel.UNVERIFIED;
    }
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  return {
    shadowBatches: n,
    firstPassSchemaRate: firstPassSchema / n,
    firstPassValidatorPassRate: firstPassValidator / n,
    finalDeliverableRate: deliverable / n,
    repairRate: repaired / n,
    regenerationRate: regenerated / n,
    quarantineRate: quarantined / n,
    averageGenerationAttempts: genAttempts / n,
    averageRepairAttempts: repairAttempts / n,
    answerFormatValidRate: avTotal > 0 ? avFormatValid / avTotal : 0,
    answerDeterministicCorrectnessVerifiedRate: avTotal > 0 ? avDeterministic / avTotal : 0,
    answerCrosscheckRequiredRate: avTotal > 0 ? avCrosscheck / avTotal : 0,
    answerUnverifiedRate: avTotal > 0 ? avUnverified / avTotal : 0,
    skillAdherenceRate: acceptedItems > 0 ? skillOk / acceptedItems : 0,
    bucketAdherenceRate: acceptedItems > 0 ? bucketOk / acceptedItems : 0,
    kAdherenceRate: acceptedItems > 0 ? kOk / acceptedItems : 0,
    tAdherenceRate: acceptedItems > 0 ? tOk / acceptedItems : 0,
    referenceCopyRate: referenceCopy / n,
    noInventedSkillIdRate: (n - inventedId) / n,
    noForbiddenKnowledgeRate: (n - forbiddenKnowledge) / n,
    averageLatencyMs: sortedLat.length > 0 ? sortedLat.reduce((s, x) => s + x, 0) / sortedLat.length : 0,
    p50LatencyMs: percentile(sortedLat, 0.5),
    p95LatencyMs: percentile(sortedLat, 0.95),
    averageInputTokens: tokenOps > 0 ? inputTokens / tokenOps : 0,
    averageOutputTokens: tokenOps > 0 ? outputTokens / tokenOps : 0,
    averageActualCostVndPerBatch: costRuns > 0 ? totalCostVnd / costRuns : 0,
    averageActualCostVndPerQuestion: totalQuestions > 0 ? totalCostVnd / totalQuestions : 0,
    failuresByReasonCode,
  };
}

const EMPTY: ShadowMetrics = {
  shadowBatches: 0,
  firstPassSchemaRate: 0,
  firstPassValidatorPassRate: 0,
  finalDeliverableRate: 0,
  repairRate: 0,
  regenerationRate: 0,
  quarantineRate: 0,
  averageGenerationAttempts: 0,
  averageRepairAttempts: 0,
  answerFormatValidRate: 0,
  answerDeterministicCorrectnessVerifiedRate: 0,
  answerCrosscheckRequiredRate: 0,
  answerUnverifiedRate: 0,
  skillAdherenceRate: 0,
  bucketAdherenceRate: 0,
  kAdherenceRate: 0,
  tAdherenceRate: 0,
  referenceCopyRate: 0,
  noInventedSkillIdRate: 0,
  noForbiddenKnowledgeRate: 0,
  averageLatencyMs: 0,
  p50LatencyMs: 0,
  p95LatencyMs: 0,
  averageInputTokens: 0,
  averageOutputTokens: 0,
  averageActualCostVndPerBatch: 0,
  averageActualCostVndPerQuestion: 0,
  failuresByReasonCode: {},
};

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

function adhSkill(item: GeneratedExercise, spec: ExerciseGenerationSpec): boolean {
  return spec.targets.skillIds.includes(item.skillId);
}
function adhBucket(item: GeneratedExercise, spec: ExerciseGenerationSpec): boolean {
  // a skill can appear under more than one target (e.g. CURRENT + THINKING) — the
  // item is in-bounds if ANY of its skill's targets allows this bucket.
  return spec.targets.skills.some((s) => s.skillId === item.skillId && s.buckets.includes(item.bucket));
}
function adhK(item: GeneratedExercise, spec: ExerciseGenerationSpec): boolean {
  const i = KNOWLEDGE_LEVELS.indexOf(item.knowledgeLevel);
  return i >= KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMin) && i <= KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMax);
}
function adhT(item: GeneratedExercise, spec: ExerciseGenerationSpec): boolean {
  const i = THINKING_LEVELS.indexOf(item.thinkingLevel);
  return i >= THINKING_LEVELS.indexOf(spec.difficulty.tMin) && i <= THINKING_LEVELS.indexOf(spec.difficulty.tMax);
}
