import {
  BATCH_DISPOSITIONS,
  CONTRACT_VIOLATION_CODES,
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVELS,
  OUTCOME_SEVERITY,
  THINKING_LEVELS,
  type BatchDisposition,
  type BatchValidationResult,
  type ExerciseDistribution,
  type ExerciseFinding,
  type ExerciseGenerationSpec,
  type ExerciseValidationReasonCode,
  type GeneratedExercise,
  type GeneratedExerciseBatch,
  type ItemValidationOutcome,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { generatedExerciseSchema } from '@copilot/schemas';

export const VALIDATOR_VERSION = 'generated-exercise-validator.v1';

const CONTRACT_VIOLATIONS = new Set<string>(CONTRACT_VIOLATION_CODES);

/** Default outcome for each reason code (a finding may override per-context). */
const DEFAULT_OUTCOME: Record<ExerciseValidationReasonCode, ItemValidationOutcome> = {
  SCHEMA_INVALID: 'BLOCK',
  MISSING_ANSWER: 'REPAIRABLE',
  MISSING_SOLUTION: 'REPAIRABLE',
  MISSING_RUBRIC: 'REPAIRABLE',
  HINT_LADDER_MALFORMED: 'REPAIRABLE',
  UNKNOWN_SKILL_ID: 'BLOCK',
  UNKNOWN_REQUIRED_SKILL_ID: 'BLOCK',
  SKILL_NOT_IN_SPEC: 'REGENERATE',
  UNKNOWN_PROBLEM_TYPE: 'REPAIRABLE',
  PROBLEM_TYPE_SKILL_MISMATCH: 'REPAIRABLE',
  OUTSIDE_K_RANGE: 'REGENERATE',
  OUTSIDE_T_RANGE: 'REGENERATE',
  CHALLENGE_EXCEEDS_SPEC: 'REGENERATE',
  UNLEARNED_REQUIRED_KNOWLEDGE: 'BLOCK',
  ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED: 'BLOCK',
  ANSWER_UNVERIFIABLE: 'REPAIRABLE',
  ANSWER_INCONSISTENT: 'REGENERATE',
  DUPLICATE_VARIANT: 'REGENERATE',
  UNSAFE_CONTENT: 'BLOCK',
  NOT_AGE_APPROPRIATE: 'BLOCK',
  LANGUAGE_MISMATCH: 'REPAIRABLE',
  DISTRIBUTION_MISMATCH: 'REGENERATE',
};

const REPAIR_HINT: Partial<Record<ExerciseValidationReasonCode, string>> = {
  MISSING_RUBRIC: 'add a grading rubric for the reasoning answer',
  HINT_LADDER_MALFORMED: 'provide exactly 6 non-empty hint rungs, the last being the full solution',
  UNKNOWN_PROBLEM_TYPE: 'drop the problemTypeId or use one that belongs to the target skill',
  PROBLEM_TYPE_SKILL_MISMATCH: 'use a problemTypeId that belongs to this skill, or drop it',
  OUTSIDE_K_RANGE: 'regenerate at a knowledge level inside the spec K-range',
  OUTSIDE_T_RANGE: 'regenerate at a thinking level inside the spec T-range',
  CHALLENGE_EXCEEDS_SPEC: 'prerequisite-repair items must stay at standard knowledge (≤ K2)',
  ANSWER_INCONSISTENT: 'make the answer key consistent with the options / prompt',
  DUPLICATE_VARIANT: 'regenerate a structurally different variant',
  LANGUAGE_MISMATCH: 'write the prompt and solution in Vietnamese with SGK notation',
};

const kIdx = (k: string): number => KNOWLEDGE_LEVELS.indexOf(k as never);
const tIdx = (t: string): number => THINKING_LEVELS.indexOf(t as never);

const UNSAFE_RE =
  /\b(kill|suicide|self[- ]harm|weapon|drug|sex|porn|gambling|\d{9,}|@[\w.]+\.\w{2,})\b/i;
const VIET_HINT_RE =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const VIET_WORD_RE = /\b(của|và|là|cho|một|bằng|số|tính|bài|hãy|kết quả|phân số)\b/i;

function normalizePrompt(p: string): string {
  return p
    .toLowerCase()
    .replace(/[0-9]+/g, '#')
    .replace(/[^\p{L}\p{N}#]+/gu, ' ')
    .trim();
}

/**
 * GeneratedExerciseValidator (doc 14 §6, C3) — the deterministic gate every
 * AI-generated item passes before it can reach a child. No item with any finding
 * is accepted. Pure over (batch, spec, KB).
 */
export function validateGeneratedBatch(
  batch: GeneratedExerciseBatch,
  spec: ExerciseGenerationSpec,
  kb: KnowledgeBase,
): BatchValidationResult {
  const findings: ExerciseFinding[] = [];
  const rejected = new Set<string>();

  const add = (
    code: ExerciseValidationReasonCode,
    questionIds: readonly string[],
    detail: string,
    outcome: ItemValidationOutcome = DEFAULT_OUTCOME[code],
  ): void => {
    const finding: ExerciseFinding = {
      code,
      outcome,
      questionIds: [...questionIds],
      detail,
      ...(REPAIR_HINT[code] ? { repairInstruction: REPAIR_HINT[code]! } : {}),
    };
    findings.push(finding);
    for (const id of questionIds) rejected.add(id);
  };

  const kMin = kIdx(spec.difficulty.kMin);
  const kMax = kIdx(spec.difficulty.kMax);
  const tMin = tIdx(spec.difficulty.tMin);
  const tMax = tIdx(spec.difficulty.tMax);
  const targetSkills = new Set<string>(spec.targets.skillIds);
  const blockingPrereqs = new Set(
    spec.childState.prerequisiteGaps.filter((g) => g.blocking).map((g) => g.skillId as string),
  );
  const frontierAboveGrade = new Set(
    Object.entries(spec.childState.actualLearningFrontier)
      .filter(([, label]) => /above_grade/.test(label))
      .map(([domain]) => domain),
  );

  const seenNorm = new Map<string, string>(); // normalized prompt → first item id

  for (const item of batch.items) {
    // 1. schema
    const parsed = generatedExerciseSchema.safeParse(item);
    if (!parsed.success) {
      add('SCHEMA_INVALID', [item.id ?? '(no id)'], parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
      continue;
    }

    // 2. completeness beyond schema
    if (item.answerSpec.kind === 'reasoning' && !item.rubric) {
      add('MISSING_RUBRIC', [item.id], 'reasoning item has no grading rubric');
    }
    if (item.hints.length !== 6 || item.hints.some((h) => h.trim().length === 0)) {
      add('HINT_LADDER_MALFORMED', [item.id], `expected 6 non-empty hint rungs, got ${item.hints.length}`);
    }

    // 3. skill identity (non-negotiable — AI may not invent IDs)
    const skill = kb.skills.get(item.skillId);
    if (!skill) {
      add('UNKNOWN_SKILL_ID', [item.id], `skill ${item.skillId} is not in the production KB`);
    } else if (!targetSkills.has(item.skillId)) {
      add('SKILL_NOT_IN_SPEC', [item.id], `skill ${item.skillId} is not a target of this spec`);
    }
    // every declared requiredSkillId must be a real production skill (doc 14 C3.1 §B)
    const unknownRequired = [...item.requiredSkillIds, ...(item.supportingSkillIds ?? [])].filter(
      (s) => !kb.skills.has(s),
    );
    if (unknownRequired.length > 0) {
      add('UNKNOWN_REQUIRED_SKILL_ID', [item.id], `invented / unknown skill id(s): ${unknownRequired.join(', ')}`);
    }

    // 4. problem type
    if (item.problemTypeId) {
      const pt = kb.problemTypes.find((p) => p.id === item.problemTypeId);
      if (!pt) add('UNKNOWN_PROBLEM_TYPE', [item.id], `problem type ${item.problemTypeId} is not in the KB`);
      else if (pt.skillId !== item.skillId)
        add('PROBLEM_TYPE_SKILL_MISMATCH', [item.id], `problem type ${item.problemTypeId} belongs to ${pt.skillId}, not ${item.skillId}`);
    }

    // 5. difficulty
    const ki = kIdx(item.knowledgeLevel);
    const ti = tIdx(item.thinkingLevel);
    if (ki < kMin || ki > kMax)
      add('OUTSIDE_K_RANGE', [item.id], `${item.knowledgeLevel} is outside [${spec.difficulty.kMin}, ${spec.difficulty.kMax}]`);
    if (ti < tMin || ti > tMax)
      add('OUTSIDE_T_RANGE', [item.id], `${item.thinkingLevel} is outside [${spec.difficulty.tMin}, ${spec.difficulty.tMax}]`);
    if (item.bucket === 'prerequisiteRepair' && ki > kIdx('K2'))
      add('CHALLENGE_EXCEEDS_SPEC', [item.id], `prerequisite-repair item at ${item.knowledgeLevel} — repair items must stay ≤ K2`);

    // 6. curriculum safety
    if (skill) {
      if (skill.curriculumOrigin > spec.schoolGrade) {
        const supported = frontierAboveGrade.has(skill.domain) && spec.childState.readiness !== 'repair_first';
        if (!supported)
          add(
            'ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED',
            [item.id],
            `${item.skillId} originates at grade ${skill.curriculumOrigin}; the child's ${skill.domain} frontier / readiness does not support above-grade knowledge`,
          );
      }
      // noUnlearnedRequiredKnowledge (doc 14 C3.1 §B): a blocking prerequisite
      // gap only blocks the item when it is ACTUALLY required — i.e. it is one of
      // requiredSkillIds or in their prerequisite closure. A weak but UNRELATED
      // prerequisite must not block the item. K0/K1 concept-intro items and the
      // prerequisite-repair bucket are exempt (they don't assume prereq fluency).
      if (
        spec.constraints.noUnlearnedRequiredKnowledge &&
        item.bucket !== 'prerequisiteRepair' &&
        kIdx(item.knowledgeLevel) >= kIdx('K2')
      ) {
        const requiredClosure = new Set<string>(item.requiredSkillIds as readonly string[]);
        for (const rs of item.requiredSkillIds) {
          if (kb.skills.has(rs)) for (const p of kb.prerequisiteClosure(rs)) requiredClosure.add(p);
        }
        const blockedBy = [...blockingPrereqs].filter((g) => requiredClosure.has(g));
        if (blockedBy.length > 0)
          add(
            'UNLEARNED_REQUIRED_KNOWLEDGE',
            [item.id],
            `actually requires ${blockedBy.join(', ')} — a blocking prerequisite gap, and this K2+ item is not prerequisite repair`,
          );
      }
    }

    // 7. answer
    if (item.answerSpec.kind === 'choice' && !item.answerSpec.options.includes(item.answerSpec.correct)) {
      add('ANSWER_INCONSISTENT', [item.id], 'correct choice is not among the options');
    }
    if (item.answerSpec.kind === 'fraction' && item.answerSpec.denominator === 0) {
      add('ANSWER_INCONSISTENT', [item.id], 'fraction answer has a zero denominator');
    }
    if (item.answerSpec.kind === 'numeric' && !Number.isFinite(item.answerSpec.value)) {
      add('ANSWER_UNVERIFIABLE', [item.id], 'numeric answer is not a finite number');
    }

    // 8. safety / age / language
    const text = `${item.prompt}\n${item.workedSolution}`;
    if (UNSAFE_RE.test(text)) add('UNSAFE_CONTENT', [item.id], 'prompt or solution matches an unsafe-content pattern');
    if (
      spec.constraints.language === 'vi' &&
      item.prompt.trim().length > 20 &&
      !VIET_HINT_RE.test(item.prompt) &&
      !VIET_WORD_RE.test(item.prompt)
    ) {
      add('LANGUAGE_MISMATCH', [item.id], 'prompt does not look like Vietnamese');
    }

    // batch: duplicate variants
    const norm = normalizePrompt(item.prompt);
    if (norm.length > 0) {
      const first = seenNorm.get(norm);
      if (first) add('DUPLICATE_VARIANT', [item.id], `near-duplicate of ${first}`);
      else seenNorm.set(norm, item.id);
    }
  }

  // batch: distribution compliance (compare the FULL batch to the spec, ±1 per bucket)
  const got = countBuckets(batch.items);
  const want = spec.generationPlan.distribution;
  const drift = DISTRIBUTION_BUCKETS.filter((b) => Math.abs(got[b] - want[b]) > 1);
  if (drift.length > 0 || Math.abs(batch.items.length - spec.generationPlan.totalQuestions) > 1) {
    add(
      'DISTRIBUTION_MISMATCH',
      [],
      `batch buckets ${JSON.stringify(got)} do not match spec ${JSON.stringify(want)} (drift: ${drift.join(', ') || 'total count'})`,
    );
  }

  const acceptedItems = batch.items.filter((i) => !rejected.has(i.id));
  const outcome = findings.reduce<ItemValidationOutcome>(
    (worst, f) => (OUTCOME_SEVERITY[f.outcome] > OUTCOME_SEVERITY[worst] ? f.outcome : worst),
    'PASS',
  );
  const reasonCodes = [...new Set(findings.map((f) => f.code))];

  // per-item worst outcome
  const itemOutcomes: Record<string, ItemValidationOutcome> = {};
  for (const i of batch.items) itemOutcomes[i.id] = 'PASS';
  for (const f of findings)
    for (const id of f.questionIds)
      if (OUTCOME_SEVERITY[f.outcome] > OUTCOME_SEVERITY[itemOutcomes[id] ?? 'PASS']) itemOutcomes[id] = f.outcome;

  // --- batch disposition (doc 14 C3.1 §C) ---
  //   a single local finding does not poison the batch; a generator-contract
  //   violation does. We never deliver a partial worksheet.
  const shortfall = Math.max(0, spec.generationPlan.totalQuestions - acceptedItems.length);
  const outcomeCounts = Object.values(itemOutcomes).reduce<Record<ItemValidationOutcome, number>>(
    (acc, o) => ((acc[o] += 1), acc),
    { PASS: 0, REPAIRABLE: 0, REGENERATE: 0, BLOCK: 0 },
  );
  const hasContractViolation = findings.some((f) => CONTRACT_VIOLATIONS.has(f.code));
  const hasBatchRegenerate = findings.some((f) => f.questionIds.length === 0 && f.outcome === 'REGENERATE');
  const missingBeyondRepair = shortfall > outcomeCounts.REPAIRABLE;
  let batchDisposition: BatchDisposition;
  if (hasContractViolation) batchDisposition = 'QUARANTINE';
  else if (outcomeCounts.REGENERATE > 0 || hasBatchRegenerate || missingBeyondRepair) batchDisposition = 'REGENERATE_SLOTS';
  else if (outcomeCounts.REPAIRABLE > 0) batchDisposition = 'REPAIR';
  else batchDisposition = 'DELIVER';

  const deliverable =
    batchDisposition === 'DELIVER' && acceptedItems.length === spec.generationPlan.totalQuestions;

  return {
    batchDisposition,
    deliverable,
    itemOutcomes,
    validatorVersion: VALIDATOR_VERSION,
    acceptedItems,
    findings,
    reasonCodes,
    shortfall,
    outcome,
  };
}

/** All batch dispositions, for exhaustiveness in consumers. */
export const ALL_BATCH_DISPOSITIONS = BATCH_DISPOSITIONS;

function countBuckets(items: readonly GeneratedExercise[]): ExerciseDistribution {
  const out: ExerciseDistribution = {
    prerequisiteRepair: 0,
    currentSkill: 0,
    variation: 0,
    application: 0,
    advanced: 0,
    thinkingChallenge: 0,
  };
  const mut = out as Record<keyof ExerciseDistribution, number>;
  for (const i of items) if (i.bucket in mut) mut[i.bucket] += 1;
  return out;
}
