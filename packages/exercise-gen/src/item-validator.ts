import {
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type AnswerVerificationLevel,
  type ExerciseGenerationSpec,
  type GeneratedExercise,
  type ItemAcceptanceGate,
  type ItemAcceptanceResult,
  type ItemAnswerStatus,
  type ItemGateResult,
  type ItemGenerationSpec,
  type MathKernel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { generatedExerciseSchema } from '@copilot/schemas';
import { verifyItemAnswer } from './answer-verification.js';
import { validateAgainstKernel } from './kernel-validator.js';
import {
  checkItemSimilarity,
  promptContentSignature,
  similarityRegenerationInstruction,
  type SimilarityComparand,
} from './similarity-gate.js';

export const ITEM_VALIDATOR_VERSION = 'item-validator.v1';

const kIdx = (k: string): number => KNOWLEDGE_LEVELS.indexOf(k as never);
const tIdx = (t: string): number => THINKING_LEVELS.indexOf(t as never);

const UNSAFE_RE = /\b(kill|suicide|self[- ]harm|weapon|drug|sex|porn|gambling|\d{9,}|@[\w.]+\.\w{2,})\b/i;
const VIET_HINT_RE =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const VIET_WORD_RE = /\b(của|và|là|cho|một|bằng|số|tính|bài|hãy|kết quả|phân số)\b/i;

export interface AcceptItemContext {
  readonly references: readonly SimilarityComparand[];
  readonly acceptedSiblings: readonly SimilarityComparand[];
  readonly recentItems?: readonly SimilarityComparand[];
  readonly forbiddenNumberTuples?: readonly (readonly number[])[];
  /** The deterministic MathKernel for this item, when one covers it (doc 58 §6). */
  readonly mathKernel?: MathKernel | null;
}

/**
 * acceptItem (doc 56 §10) — the HARD quality gate. An item is accepted ONLY if
 * EVERY gate passes: schema, skill alignment, K/T bounds, curriculum safety,
 * prerequisite safety, answer verification (where deterministically supported),
 * similarity/leakage, and within-worksheet uniqueness. No partial bypass.
 * Deterministic and model-independent.
 */
export function acceptItem(
  exercise: GeneratedExercise,
  itemSpec: ItemGenerationSpec,
  spec: ExerciseGenerationSpec,
  kb: KnowledgeBase,
  ctx: AcceptItemContext,
): ItemAcceptanceResult {
  const gates: ItemGateResult[] = [];
  const gate = (
    g: ItemAcceptanceGate,
    pass: boolean,
    detail: string,
    regenerationInstruction?: string,
  ): void => {
    gates.push({ gate: g, pass, detail, ...(regenerationInstruction ? { regenerationInstruction } : {}) });
  };

  // 1. SCHEMA_VALID
  const parsed = generatedExerciseSchema.safeParse(exercise);
  gate(
    'SCHEMA_VALID',
    parsed.success,
    parsed.success ? 'ok' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    'Trả về đúng cấu trúc yêu cầu.',
  );

  // 2. SKILL_ALIGNED (post-compose this is deterministic; still guarded)
  const skillInSpec = spec.targets.skillIds.includes(exercise.skillId);
  const bucketBound = spec.targets.skills.some(
    (t) => t.skillId === exercise.skillId && t.buckets.includes(exercise.bucket),
  );
  gate(
    'SKILL_ALIGNED',
    skillInSpec && bucketBound,
    skillInSpec ? (bucketBound ? 'ok' : `bucket ${exercise.bucket} not bound to ${exercise.skillId}`) : `skill ${exercise.skillId} not in spec`,
    'Bám đúng kỹ năng và mục tiêu đã cho.',
  );

  // 3/4. K / T bounds
  const ki = kIdx(exercise.knowledgeLevel);
  const ti = tIdx(exercise.thinkingLevel);
  gate(
    'K_LEVEL_OK',
    ki >= kIdx(spec.difficulty.kMin) && ki <= kIdx(spec.difficulty.kMax),
    `${exercise.knowledgeLevel} vs [${spec.difficulty.kMin}, ${spec.difficulty.kMax}]`,
    'Giữ mức kiến thức trong khoảng cho phép.',
  );
  gate(
    'T_LEVEL_OK',
    ti >= tIdx(spec.difficulty.tMin) && ti <= tIdx(spec.difficulty.tMax),
    `${exercise.thinkingLevel} vs [${spec.difficulty.tMin}, ${spec.difficulty.tMax}]`,
    'Giữ mức tư duy trong khoảng cho phép.',
  );

  // 5. CURRICULUM_SAFE — above-grade knowledge is fine for ANY skill the planner
  //    deliberately selected (PREREQUISITE_REPAIR / THINKING / FRONTIER can all
  //    legitimately be above grade); the `advanced` bucket additionally requires
  //    a FRONTIER-role selection whose domain still supports above-grade
  //    knowledge. Mirrors the C5 validator (FRONTIER_SKILL_NOT_SELECTED /
  //    ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED).
  const skill = kb.skills.get(exercise.skillId);
  const selectedFrontier = new Set(
    spec.targets.skills.filter((t) => t.role === 'FRONTIER').map((t) => t.skillId),
  );
  const anySelected = new Set(spec.targets.skills.map((t) => t.skillId));
  const aboveGrade = !!skill && skill.curriculumOrigin > spec.schoolGrade;
  const frontierDomainOk =
    !!skill &&
    Object.entries(spec.childState.actualLearningFrontier).some(([d, f]) => d === skill.domain && f.aboveGrade) &&
    spec.childState.readiness !== 'repair_first';
  let curriculumSafe = true;
  let curriculumDetail = 'ok';
  if (aboveGrade) {
    if (!anySelected.has(exercise.skillId)) {
      curriculumSafe = false;
      curriculumDetail = `${exercise.skillId} originates at grade ${skill?.curriculumOrigin} — the planner selected no target for it`;
    } else if (exercise.bucket === 'advanced' && !selectedFrontier.has(exercise.skillId)) {
      curriculumSafe = false;
      curriculumDetail = `${exercise.skillId} is in the advanced bucket without a FRONTIER selection`;
    } else if (selectedFrontier.has(exercise.skillId) && !frontierDomainOk) {
      curriculumSafe = false;
      curriculumDetail = `${skill?.domain} frontier / readiness no longer supports above-grade knowledge`;
    }
  }
  gate('CURRICULUM_SAFE', curriculumSafe, curriculumDetail, 'Không dùng kiến thức vượt lớp cho câu này.');

  // 6. PREREQUISITE_SAFE — a blocking prereq gap must not sit in the required
  //    PREREQUISITE closure. The skill the item PRACTISES is excluded: an item
  //    for a weak skill is not "unsafe" — that is the point of practice (the
  //    planner already decided to work on it). Only genuine prerequisites of
  //    the required skills count. Mirrors C5 UNLEARNED_REQUIRED_KNOWLEDGE.
  const blocking = new Set(itemSpec.curriculumSafety.blockingPrerequisiteSkillIds as readonly string[]);
  let prereqSafe = true;
  let prereqDetail = 'ok';
  if (
    itemSpec.curriculumSafety.noUnlearnedRequiredKnowledge &&
    exercise.bucket !== 'prerequisiteRepair' &&
    ki >= kIdx('K2') &&
    blocking.size > 0
  ) {
    const closure = new Set<string>();
    for (const rs of exercise.requiredSkillIds) {
      if (rs === exercise.skillId) continue; // the skill being practised is not a prerequisite
      closure.add(rs);
      if (kb.skills.has(rs)) for (const p of kb.prerequisiteClosure(rs)) closure.add(p);
    }
    if (kb.skills.has(exercise.skillId)) {
      for (const p of kb.prerequisiteClosure(exercise.skillId)) closure.add(p);
    }
    const hit = [...blocking].filter((b) => b !== exercise.skillId && closure.has(b));
    if (hit.length > 0) {
      prereqSafe = false;
      prereqDetail = `requires blocking prerequisite(s) ${hit.join(', ')}`;
    }
  }
  gate('PREREQUISITE_SAFE', prereqSafe, prereqDetail, 'Chỉ dùng kiến thức tiên quyết học sinh đã nắm.');

  // 7. ANSWER_VERIFIED — two-tier (doc 56 §POLICY / doc 58 §6/§7):
  //    DETERMINISTIC_CORRECT → content PASS + production-ready
  //    DETERMINISTIC_WRONG   → HARD FAIL
  //    CROSSCHECK_REQUIRED   → content PASS, NOT production-ready (PENDING_CROSSCHECK)
  //    MALFORMED key         → HARD FAIL
  //  When a MathKernel covers the item, IT is the authority — the AI's answer
  //  must match `kernel.expectedAnswer` and every given number must survive.
  const av = verifyItemAnswer(exercise);
  const answerVerificationLevel: AnswerVerificationLevel = av.level;
  let answerStatus: ItemAnswerStatus;
  let answerPass = true;
  let answerDetail = `level=${av.level}`;

  if (!av.formatValid) {
    answerStatus = 'MALFORMED';
    answerPass = false;
    answerDetail = 'answer key is malformed';
  } else if (ctx.mathKernel) {
    const kv = validateAgainstKernel(exercise, ctx.mathKernel);
    if (kv.consistent) {
      answerStatus = 'DETERMINISTIC_CORRECT';
      answerDetail = `kernel(${ctx.mathKernel.family}) consistent`;
    } else {
      answerStatus = 'DETERMINISTIC_WRONG';
      answerPass = false;
      answerDetail = `kernel contradiction [${kv.codes.join(',')}]: ${kv.detail}`;
    }
  } else if (av.math.verdict === 'INCORRECT') {
    answerStatus = 'DETERMINISTIC_WRONG';
    answerPass = false;
    answerDetail = `deterministic check: ${av.math.detail}`;
  } else if (av.math.verdict === 'CORRECT') {
    answerStatus = 'DETERMINISTIC_CORRECT';
  } else {
    answerStatus = 'CROSSCHECK_REQUIRED';
    answerDetail = `${av.level} — no kernel, deterministic verifier could not rule; PENDING_CROSSCHECK`;
  }
  gate(
    'ANSWER_VERIFIED',
    answerPass,
    answerDetail,
    ctx.mathKernel
      ? `Đề phải dùng đúng các số ${ctx.mathKernel.requiredNumbersInPrompt.join(', ')} và cho đáp số đúng như kernel.`
      : 'Đảm bảo đáp số và lời giải nhất quán với đề.',
  );

  // safety / language (fold into SCHEMA_VALID-adjacent basic checks; report under CURRICULUM_SAFE bucket only if unsafe)
  const text = `${exercise.prompt}\n${exercise.workedSolution}`;
  if (UNSAFE_RE.test(text)) {
    gate('CURRICULUM_SAFE', false, 'unsafe-content pattern in prompt/solution', 'Dùng bối cảnh trung tính, phù hợp lứa tuổi.');
  }
  if (
    exercise.prompt.trim().length > 20 &&
    !VIET_HINT_RE.test(exercise.prompt) &&
    !VIET_WORD_RE.test(exercise.prompt)
  ) {
    gate('SCHEMA_VALID', false, 'prompt does not look like Vietnamese', 'Viết đề bằng tiếng Việt, ký hiệu SGK.');
  }

  // 8. SIMILARITY_OK
  const sim = checkItemSimilarity({
    prompt: exercise.prompt,
    references: ctx.references,
    worksheetSiblings: ctx.acceptedSiblings,
    ...(ctx.recentItems ? { recentItems: ctx.recentItems } : {}),
    ...(ctx.forbiddenNumberTuples ? { prohibitedNumberTuples: ctx.forbiddenNumberTuples } : {}),
  });
  const simFail =
    sim.verdict === 'COPY' ||
    (sim.verdict === 'NEAR' && sim.worst !== null && sim.worst.against !== 'recent_item');
  gate(
    'SIMILARITY_OK',
    !simFail,
    simFail ? `${sim.worst?.name} (${sim.worst?.value.toFixed(2)}) vs ${sim.worst?.against}` : 'ok',
    similarityRegenerationInstruction(sim.worst),
  );

  // 9. UNIQUENESS_OK — content-signature equality against accepted siblings
  const norm = promptContentSignature(exercise.prompt);
  const dupOf = ctx.acceptedSiblings.find((s) => promptContentSignature(s.prompt) === norm && norm.length > 0);
  gate(
    'UNIQUENESS_OK',
    !dupOf,
    dupOf ? `identical (normalized) to ${dupOf.id}` : 'ok',
    'Mỗi câu trong phiếu phải khác nhau về nội dung, không chỉ khác số.',
  );

  const failedGates = [...new Set(gates.filter((g) => !g.pass).map((g) => g.gate))];
  const accepted = failedGates.length === 0;
  return {
    itemId: exercise.id,
    accepted,
    productionReady: accepted && answerStatus === 'DETERMINISTIC_CORRECT',
    answerStatus,
    gates,
    failedGates,
    answerVerificationLevel,
  };
}
