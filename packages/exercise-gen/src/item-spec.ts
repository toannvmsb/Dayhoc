import {
  BUCKET_CRITICALITY,
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type AnswerKind,
  type AnswerVerificationPolicy,
  type ExerciseDistribution,
  type ExerciseGenerationSpec,
  type ItemGenerationSpec,
  type KnowledgeLevel,
  type ProblemStructure,
  type ProblemTypeId,
  type SkillId,
  type SlotCriticality,
  type SlotFallbackEnvelope,
  type TargetRole,
  type TargetSkill,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';

export const ITEM_SPEC_BUILDER_VERSION = 'item-spec.v1';

const kIdx = (k: KnowledgeLevel): number => KNOWLEDGE_LEVELS.indexOf(k);
const tIdx = (t: ThinkingLevel): number => THINKING_LEVELS.indexOf(t);
const kLevel = (i: number): KnowledgeLevel => KNOWLEDGE_LEVELS[clamp(i, 0, KNOWLEDGE_LEVELS.length - 1)]!;
const tLevel = (i: number): ThinkingLevel => THINKING_LEVELS[clamp(i, 0, THINKING_LEVELS.length - 1)]!;
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** A deterministic rotation of problem structures per bucket (doc 56 §5). */
const STRUCTURE_ROTATION: Record<keyof ExerciseDistribution, readonly ProblemStructure[]> = {
  prerequisiteRepair: ['direct_computation'],
  currentSkill: ['direct_computation', 'single_step_word_problem'],
  variation: ['single_step_word_problem', 'compare_and_decide', 'work_backwards'],
  application: ['multi_step_word_problem', 'single_step_word_problem'],
  advanced: ['multi_step_word_problem', 'construct_an_example', 'work_backwards'],
  thinkingChallenge: ['explain_or_justify', 'find_the_error', 'work_backwards', 'construct_an_example'],
};

const FRACTION_DOMAINS = new Set(['fractions']);

/**
 * Skills whose task is to CLASSIFY / NAME an object (identify the angle type,
 * recognise parallel/perpendicular lines, name a quadrilateral) — the answer is
 * a category label, not a number (doc 58 §1.A). Matched on the skill name.
 */
const CLASSIFICATION_NAME_RE =
  /góc (nhọn|tù|bẹt|vuông)|nhọn.*tù.*bẹt|vuông góc|song song|dấu hiệu nhận biết|nhận biết|phân loại|gọi tên|loại (góc|tam giác|tứ giác)/i;

/** Answer family from the problem structure + skill — never the model's choice. */
export function answerKindFor(structure: ProblemStructure, domain: string, skillName: string): AnswerKind {
  switch (structure) {
    case 'explain_or_justify':
    case 'find_the_error':
    case 'construct_an_example':
      return 'reasoning';
    case 'compare_and_decide':
      return 'choice';
    case 'direct_computation':
    case 'single_step_word_problem':
    case 'multi_step_word_problem':
    case 'work_backwards':
      if ((domain === 'geometry' || domain === 'logical_reasoning') && CLASSIFICATION_NAME_RE.test(skillName)) {
        return 'choice'; // "which type is this?" — a labelled choice, never a number
      }
      return FRACTION_DOMAINS.has(domain) ? 'fraction' : 'numeric';
    default:
      return 'numeric';
  }
}

export function verificationPolicyFor(kind: AnswerKind, structure: ProblemStructure): AnswerVerificationPolicy {
  // only a single closed NUMERIC computation is a "supported math type" the
  // deterministic verifier is expected to re-derive (doc 56 §7). Everything else
  // — word problems, fractions-in-context, choice, reasoning — is accepted at an
  // honest lower verification level (and still fails if PROVEN wrong).
  return kind === 'numeric' && structure === 'direct_computation'
    ? 'DETERMINISTIC_EXPECTED'
    : 'AI_OR_HUMAN_CROSSCHECK';
}

interface Slot {
  readonly bucket: keyof ExerciseDistribution;
  readonly target: TargetSkill;
  readonly ordinalInBucket: number;
  readonly bucketCount: number;
}

/**
 * buildItemGenerationSpecs (doc 56 §1/§4) — deterministic. Expands an
 * `ExerciseGenerationSpec` into one `ItemGenerationSpec` per worksheet slot,
 * with EXACT K/T, an answer family, a problem structure, requiredSkillIds and
 * curriculum-safety facts — all decided here, none by the model. Pure over
 * (spec, KB).
 */
export function buildItemGenerationSpecs(
  spec: ExerciseGenerationSpec,
  kb: KnowledgeBase,
): ItemGenerationSpec[] {
  const blockingPrereqs = spec.childState.prerequisiteGaps
    .filter((g) => g.blocking)
    .map((g) => g.skillId as SkillId);
  const weakSet = new Set(spec.childState.prerequisiteGaps.map((g) => g.skillId as string));
  const masteredSet = new Set(
    Object.entries(spec.childState.relevantMastery)
      .filter(([, m]) => m >= 50)
      .map(([id]) => id),
  );

  const slots = expandSlots(spec);
  const stretchBudget = Math.round(spec.generationPlan.totalQuestions * spec.difficulty.stretchRatio);
  let stretchUsed = 0;

  const specs: ItemGenerationSpec[] = [];
  slots.forEach((slot, index) => {
    const isStretch = slot.bucket !== 'prerequisiteRepair' && stretchUsed < stretchBudget;
    if (isStretch) stretchUsed += 1;

    const structure =
      STRUCTURE_ROTATION[slot.bucket][slot.ordinalInBucket % STRUCTURE_ROTATION[slot.bucket].length]!;
    const domain = slot.target.domain;
    const skill = kb.skills.get(slot.target.skillId);
    const answerKind = answerKindFor(structure, domain, skill?.name ?? '');

    let { knowledgeLevel } = pinLevels(spec, slot, isStretch);
    const { thinkingLevel } = pinLevels(spec, slot, isStretch);
    const closure = new Set<string>(skill ? kb.prerequisiteClosure(slot.target.skillId) : []);

    // A non-repair item whose target still sits on a BLOCKING prerequisite gap
    // must stay at concept-intro K1 (exempt from PREREQUISITE_SAFE, and
    // pedagogically right for parallel-repair): don't ask for K2+ fluency on a
    // skill whose foundation the child hasn't secured (doc 56 §0 / §10).
    if (
      slot.bucket !== 'prerequisiteRepair' &&
      kIdx(knowledgeLevel) >= kIdx('K2') &&
      blockingPrereqs.some((b) => closure.has(b))
    ) {
      knowledgeLevel = kLevel(Math.max(kIdx(spec.difficulty.kMin), kIdx('K1')));
    }

    const problemTypeId = pickProblemType(kb, slot.target.skillId, knowledgeLevel, thinkingLevel);
    const supportingSkillIds = [...closure]
      .filter((p) => masteredSet.has(p) && !weakSet.has(p))
      .slice(0, 2) as SkillId[];

    const criticality: SlotCriticality = BUCKET_CRITICALITY[slot.bucket];
    const fallback: SlotFallbackEnvelope | null =
      criticality === 'REQUIRED_CORE' ? fallbackEnvelopeFor(spec, slot, domain) : null;

    specs.push({
      itemId: `${spec.generationSpecId}::item-${String(index + 1).padStart(2, '0')}`,
      generationSpecId: spec.generationSpecId,
      index,
      skillId: slot.target.skillId,
      targetRole: slot.target.role as TargetRole,
      bucket: slot.bucket,
      criticality,
      fallback,
      domain,
      curriculumNodeId: skill?.curriculumNodeId ?? spec.learningContext.resolvedLessonId ?? 'unknown',
      curriculumOrigin: skill?.curriculumOrigin ?? slot.target.curriculumOrigin,
      schoolGrade: spec.schoolGrade,
      knowledgeLevel,
      thinkingLevel,
      problemStructure: structure,
      answerKind,
      problemTypeId,
      requiredSkillIds: [slot.target.skillId],
      supportingSkillIds,
      curriculumSafety: {
        noUnlearnedRequiredKnowledge: spec.constraints.noUnlearnedRequiredKnowledge,
        allowAboveGradeKnowledge: slot.target.role === 'FRONTIER',
        blockingPrerequisiteSkillIds: blockingPrereqs,
      },
      constraints: {
        language: 'vi',
        notation: 'SGK',
        hintRungs: 6,
        ageAppropriate: spec.constraints.ageAppropriate,
        maxSolutionComplexity: spec.constraints.maxSolutionComplexity,
      },
      answerVerificationPolicy: verificationPolicyFor(answerKind, structure),
    });
  });

  return specs;
}

/**
 * Planner-authoritative safe-substitute envelope for a REQUIRED_CORE slot
 * (doc 68 §5). The substitute may drop to the spec's K/T floor and to a
 * kernel-supported structure — never below, and it MUST keep the same skill.
 * The generator/model never lowers K/T itself.
 */
function fallbackEnvelopeFor(
  spec: ExerciseGenerationSpec,
  slot: Slot,
  _domain: string,
): SlotFallbackEnvelope {
  // direct_computation first (INT_ARITH / FRACTION_ARITH / kernel-backed → the
  // deterministic last-resort can always finish it); a one-step word problem is
  // the second-choice structure (WORD_1STEP kernel).
  return {
    minKnowledgeLevel: spec.difficulty.kMin,
    minThinkingLevel: spec.difficulty.tMin,
    allowedProblemStructures: ['direct_computation', 'single_step_word_problem'],
    preserveSkillId: slot.target.skillId,
  };
}

/** One flat slot per bucket-count, round-robin over the bucket's bound targets. */
function expandSlots(spec: ExerciseGenerationSpec): Slot[] {
  const out: Slot[] = [];
  for (const bucket of DISTRIBUTION_BUCKETS) {
    const count = spec.generationPlan.distribution[bucket];
    if (count <= 0) continue;
    const bound = spec.targets.skills.filter((t) => t.buckets.includes(bucket));
    const pool = bound.length > 0 ? bound : spec.targets.skills;
    if (pool.length === 0) continue;
    for (let i = 0; i < count; i += 1) {
      out.push({ bucket, target: pool[i % pool.length]!, ordinalInBucket: i, bucketCount: count });
    }
  }
  return out;
}

/** Deterministic EXACT K/T for one slot, inside the spec's range (doc 56 §1). */
function pinLevels(
  spec: ExerciseGenerationSpec,
  slot: Slot,
  isStretch: boolean,
): { knowledgeLevel: KnowledgeLevel; thinkingLevel: ThinkingLevel } {
  const kLo = kIdx(spec.difficulty.kMin);
  const kHi = kIdx(spec.difficulty.kMax);
  const tLo = tIdx(spec.difficulty.tMin);
  const tHi = tIdx(spec.difficulty.tMax);
  const ceilK = Math.min(kHi, kIdx(slot.target.knowledgeCeiling));
  const mid = (lo: number, hi: number): number => clamp(Math.round((lo + hi) / 2), lo, hi);

  let k: number;
  let t: number;
  switch (slot.bucket) {
    case 'prerequisiteRepair':
      k = kLo;
      t = tLo;
      break;
    case 'advanced': // ADVANCED KNOWLEDGE — top of the frontier ceiling, thinking one below the very top
      k = ceilK;
      t = clamp(tHi - 1, tLo, tHi);
      break;
    case 'thinkingChallenge': // ADVANCED THINKING — grade-level K, top of the T range
      k = mid(kLo, Math.min(ceilK, kIdx('K3')));
      t = tHi;
      break;
    default:
      k = isStretch ? Math.min(ceilK, kHi) : mid(kLo, ceilK);
      t = isStretch ? tHi : mid(tLo, tHi);
      break;
  }
  return { knowledgeLevel: kLevel(k), thinkingLevel: tLevel(t) };
}

/** The KB problem type closest to the pinned (K, T), or null. */
export function pickProblemType(
  kb: KnowledgeBase,
  skillId: SkillId,
  k: KnowledgeLevel,
  t: ThinkingLevel,
): ProblemTypeId | null {
  const pts = kb.getProblemTypesForSkill(skillId);
  if (pts.length === 0) return null;
  const scored = pts
    .map((pt) => ({
      pt,
      score: Math.abs(kIdx(pt.knowledgeLevel) - kIdx(k)) + Math.abs(tIdx(pt.thinkingLevel) - tIdx(t)),
    }))
    .sort((a, b) => a.score - b.score || a.pt.id.localeCompare(b.pt.id));
  return (scored[0]!.pt.id as ProblemTypeId) ?? null;
}
