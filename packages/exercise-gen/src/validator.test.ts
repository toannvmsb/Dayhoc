import { describe, expect, it } from 'vitest';
import {
  asProblemTypeId,
  asSkillId,
  type DomainFrontierView,
  type ExerciseGenerationSpec,
  type GeneratedExercise,
  type GeneratedExerciseBatch,
  type TargetSkill,
} from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { validateGeneratedBatch, VALIDATOR_VERSION } from './validator.js';
import { makeSpec, SKILL, PREREQ, FRONTIER_SKILL, FRONTIER_TARGET } from './_spec-fixture.js';

const kb = loadKnowledgeBase();
const SPEC_ID = 'egs_c4_test';

const baseSpec: ExerciseGenerationSpec = makeSpec({
  generationPlan: {
    totalQuestions: 4,
    distribution: { prerequisiteRepair: 1, currentSkill: 2, variation: 1, application: 0, advanced: 0, thinkingChallenge: 0 },
  },
});

const t = (skillId: string, role: TargetSkill['role'], buckets: TargetSkill['buckets'], kc: TargetSkill['knowledgeCeiling'] = 'K3'): TargetSkill => ({
  skillId: asSkillId(skillId),
  role,
  domain: kb.getSkill(skillId).domain,
  curriculumOrigin: kb.getSkill(skillId).curriculumOrigin,
  buckets,
  knowledgeCeiling: kc,
  selectionReason:
    role === 'CURRENT'
      ? 'CURRENT_CURRICULUM'
      : role === 'PREREQUISITE_REPAIR'
        ? 'GAP_REPAIR'
        : role === 'FRONTIER'
          ? 'MASTERED_FRONTIER_STRETCH'
          : 'THINKING_STRETCH',
  selectedCurriculumOrigin: kb.getSkill(skillId).curriculumOrigin,
  selectionConfidence: 0.6,
});
const aboveGradeFrontier = (): Record<string, DomainFrontierView> => ({
  algebraic_thinking: { reachedCurriculumOrigin: 9, aboveGrade: true, confidence: 0.6, evidenceCount: 8, masteredSkillIds: [asSkillId(SKILL)], readyNextSkillIds: [asSkillId(FRONTIER_SKILL)], exposureSkillIds: [] },
});

let idc = 0;
function item(over: Partial<GeneratedExercise> = {}): GeneratedExercise {
  const seq = ++idc;
  const skillId = over.skillId ?? asSkillId(SKILL);
  return {
    id: `gx_${seq}`,
    generationSpecId: SPEC_ID,
    skillId,
    requiredSkillIds: over.requiredSkillIds ?? [skillId],
    bucket: 'currentSkill',
    knowledgeLevel: 'K2',
    thinkingLevel: 'T2',
    prompt: `Câu ${seq}: một tình huống tỉ lệ khác nhau, hãy lập luận và tính kết quả cho trường hợp thứ ${seq}.`,
    answerSpec: { kind: 'numeric', value: 6, tolerance: 0 },
    hints: ['Định hướng', 'Câu hỏi dẫn', 'Gợi ý hai', 'Ví dụ đơn giản hơn', 'Thử lại bài gốc', 'Lời giải đầy đủ: x bằng sáu.'],
    workedSolution: 'Áp dụng tính chất dãy tỉ số bằng nhau, ta có kết quả là sáu.',
    origin: 'ai_generated',
    ...over,
  };
}

function batch(items: GeneratedExercise[]): GeneratedExerciseBatch {
  return { generationSpecId: SPEC_ID, generatedAt: '2027-01-25T09:05:00.000Z', items };
}

/** A batch that exactly fills baseSpec's distribution with clean, distinct items. */
function cleanBatch(): GeneratedExercise[] {
  return [
    item({ bucket: 'prerequisiteRepair', skillId: asSkillId(PREREQ), knowledgeLevel: 'K1', prompt: 'Ôn lại tỉ lệ thức: tìm số hạng chưa biết trong tỉ lệ thức đơn giản.' }),
    item({ bucket: 'currentSkill', prompt: 'Cho ba số theo dãy tỉ số bằng nhau và tổng của chúng, hãy tìm từng số.' }),
    item({ bucket: 'currentSkill', prompt: 'Chia một đại lượng thành các phần theo dãy tỉ số cho trước, tính mỗi phần.' }),
    item({ bucket: 'variation', prompt: 'Bài toán lời văn: chia kẹo cho ba bạn theo tỉ lệ, hỏi mỗi bạn được bao nhiêu.' }),
  ];
}

describe('GeneratedExerciseValidator (doc 14 §6, C3)', () => {
  it('accepts a well-formed batch that matches the spec', () => {
    const r = validateGeneratedBatch(batch(cleanBatch()), baseSpec, kb);
    expect(r.outcome).toBe('PASS');
    expect(r.validatorVersion).toBe(VALIDATOR_VERSION);
    expect(r.acceptedItems).toHaveLength(4);
    expect(r.findings).toEqual([]);
    expect(r.shortfall).toBe(0);
  });

  // TEST 8 — unknown skill id → that item rejected, the valid ones still delivered
  it('TEST 8 — an unknown skill id BLOCKs its item but the batch still delivers the rest', () => {
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', skillId: asSkillId('M7.MADE.UP_SKILL') });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('UNKNOWN_SKILL_ID');
    expect(r.outcome).toBe('BLOCK');
    expect(r.acceptedItems.map((i) => i.skillId)).not.toContain('M7.MADE.UP_SKILL');
    expect(r.acceptedItems.length).toBe(3); // the other three still pass
    expect(r.shortfall).toBe(1);
  });

  it('rejects an item whose K level is outside the spec range (REGENERATE)', () => {
    const items = cleanBatch();
    items[2] = item({ bucket: 'currentSkill', knowledgeLevel: 'K5' });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('OUTSIDE_K_RANGE');
    expect(r.findings.find((f) => f.code === 'OUTSIDE_K_RANGE')?.outcome).toBe('REGENERATE');
    expect(r.acceptedItems).toHaveLength(3);
  });

  it('rejects a K2+ non-repair item that needs a BLOCKING direct prerequisite (UNLEARNED_REQUIRED_KNOWLEDGE → BLOCK)', () => {
    const blockedSpec: ExerciseGenerationSpec = {
      ...baseSpec,
      childState: { ...baseSpec.childState, prerequisiteGaps: [{ skillId: asSkillId(PREREQ), severity: 0.7, blocking: true }] },
    };
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', skillId: asSkillId(SKILL), knowledgeLevel: 'K2' });
    const r = validateGeneratedBatch(batch(items), blockedSpec, kb);
    expect(r.reasonCodes).toContain('UNLEARNED_REQUIRED_KNOWLEDGE');
    expect(r.outcome).toBe('BLOCK');
  });

  it('allows the SAME prerequisite when the item IS in the prerequisiteRepair bucket', () => {
    const blockedSpec: ExerciseGenerationSpec = makeSpec({
      targets: { skills: [t(PREREQ, 'PREREQUISITE_REPAIR', ['prerequisiteRepair'], 'K2')], problemTypeIds: [], skillIds: [asSkillId(PREREQ)] },
      childState: { ...baseSpec.childState, prerequisiteGaps: [{ skillId: asSkillId(PREREQ), severity: 0.7, blocking: true }] },
      generationPlan: { totalQuestions: 3, distribution: { prerequisiteRepair: 3, currentSkill: 0, variation: 0, application: 0, advanced: 0, thinkingChallenge: 0 } },
    });
    const items = [
      item({ bucket: 'prerequisiteRepair', skillId: asSkillId(PREREQ), knowledgeLevel: 'K1', prompt: 'Ôn tỉ lệ thức: tìm x trong a/b = x/d.' }),
      item({ bucket: 'prerequisiteRepair', skillId: asSkillId(PREREQ), knowledgeLevel: 'K2', prompt: 'Kiểm tra hai tỉ số có bằng nhau không rồi giải thích.' }),
      item({ bucket: 'prerequisiteRepair', skillId: asSkillId(PREREQ), knowledgeLevel: 'K1', prompt: 'Lập tỉ lệ thức từ bốn số cho trước.' }),
    ];
    const r = validateGeneratedBatch(batch(items), blockedSpec, kb);
    expect(r.reasonCodes).not.toContain('UNLEARNED_REQUIRED_KNOWLEDGE');
    expect(r.outcome).toBe('PASS');
  });

  it('rejects a near-duplicate variant within the batch (REGENERATE)', () => {
    const items = cleanBatch();
    items[2] = item({ bucket: 'currentSkill', prompt: items[1]!.prompt });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('DUPLICATE_VARIANT');
    expect(r.acceptedItems).toHaveLength(3);
  });

  it('flags a malformed hint ladder as REPAIRABLE', () => {
    const items = cleanBatch();
    items[3] = item({ bucket: 'variation', hints: ['only', 'three', 'rungs'] });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('HINT_LADDER_MALFORMED');
    expect(r.findings.find((f) => f.code === 'HINT_LADDER_MALFORMED')?.outcome).toBe('REPAIRABLE');
    expect(r.findings.find((f) => f.code === 'HINT_LADDER_MALFORMED')?.repairInstruction).toBeTruthy();
  });

  it('requires a rubric for a reasoning item', () => {
    const items = cleanBatch();
    items[3] = item({ bucket: 'variation', answerSpec: { kind: 'reasoning' } });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('MISSING_RUBRIC');
    const withRubric = cleanBatch();
    withRubric[3] = item({ bucket: 'variation', answerSpec: { kind: 'reasoning' }, rubric: 'Chấm theo lập luận: nêu đúng tính chất (0.5), áp dụng đúng (0.5).' });
    expect(validateGeneratedBatch(batch(withRubric), baseSpec, kb).reasonCodes).not.toContain('MISSING_RUBRIC');
  });

  it('rejects a choice answer whose correct option is not listed (ANSWER_INCONSISTENT)', () => {
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', answerSpec: { kind: 'choice', correct: '42', options: ['1', '2', '3'] } });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('ANSWER_INCONSISTENT');
  });

  it('BLOCKs an above-grade skill the planner did NOT select as a FRONTIER target', () => {
    const items = cleanBatch();
    items[2] = item({ bucket: 'currentSkill', skillId: asSkillId(FRONTIER_SKILL) }); // curriculumOrigin 9
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('FRONTIER_SKILL_NOT_SELECTED');
    expect(r.batchDisposition).toBe('QUARANTINE');
  });

  it('allows an above-grade FRONTIER-bucket item when the planner selected that frontier target', () => {
    const permissive: ExerciseGenerationSpec = makeSpec({
      targets: {
        skills: [t(SKILL, 'CURRENT', ['currentSkill', 'variation', 'application']), FRONTIER_TARGET],
        problemTypeIds: [],
        skillIds: [asSkillId(SKILL), asSkillId(FRONTIER_SKILL)],
      },
      childState: { ...baseSpec.childState, readiness: 'ready', actualLearningFrontier: aboveGradeFrontier() },
      generationPlan: { totalQuestions: 4, distribution: { prerequisiteRepair: 0, currentSkill: 3, variation: 0, application: 0, advanced: 1, thinkingChallenge: 0 } },
      difficulty: { ...baseSpec.difficulty, kMax: 'K5' },
    });
    const items = [
      item({ bucket: 'currentSkill', prompt: 'A' }),
      item({ bucket: 'currentSkill', prompt: 'B' }),
      item({ bucket: 'currentSkill', prompt: 'C' }),
      item({ bucket: 'advanced', skillId: asSkillId(FRONTIER_SKILL), knowledgeLevel: 'K5', thinkingLevel: 'T3', prompt: 'D frontier', requiredSkillIds: [asSkillId(FRONTIER_SKILL)] }),
    ];
    const r = validateGeneratedBatch(batch(items), permissive, kb);
    expect(r.reasonCodes).not.toContain('FRONTIER_SKILL_NOT_SELECTED');
    expect(r.reasonCodes).not.toContain('ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED');
    expect(r.reasonCodes).not.toContain('TARGET_ROLE_MISMATCH');
  });

  it('flags a batch whose bucket counts do not match the spec distribution (batch-level REGENERATE)', () => {
    const items = [item({ bucket: 'currentSkill' }), item({ bucket: 'currentSkill' }), item({ bucket: 'currentSkill' }), item({ bucket: 'currentSkill' })];
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('DISTRIBUTION_MISMATCH');
    expect(r.findings.find((f) => f.code === 'DISTRIBUTION_MISMATCH')?.questionIds).toEqual([]);
  });

  it('drops an unknown problem type as REPAIRABLE (not a hard block)', () => {
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', problemTypeId: asProblemTypeId('M7.PT.MADE.UP') });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('UNKNOWN_PROBLEM_TYPE');
    expect(r.findings.find((f) => f.code === 'UNKNOWN_PROBLEM_TYPE')?.outcome).toBe('REPAIRABLE');
  });

  it('is pure — same inputs, same result', () => {
    const b = batch(cleanBatch());
    expect(validateGeneratedBatch(b, baseSpec, kb)).toEqual(validateGeneratedBatch(b, baseSpec, kb));
  });
});

describe('required-skill / prerequisite safety (doc 14 C3.1 §B)', () => {
  const blockedSpec: ExerciseGenerationSpec = {
    ...baseSpec,
    generationPlan: { totalQuestions: 4, distribution: { prerequisiteRepair: 1, currentSkill: 2, variation: 1, application: 0, advanced: 0, thinkingChallenge: 0 } },
    childState: { ...baseSpec.childState, prerequisiteGaps: [{ skillId: asSkillId('M4.FRAC.CONCEPT'), severity: 0.8, blocking: true }] },
  };

  it('an invented requiredSkillId → BLOCK + batch QUARANTINE', () => {
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', requiredSkillIds: [asSkillId(SKILL), asSkillId('M7.MADE.UP_REQ')] });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('UNKNOWN_REQUIRED_SKILL_ID');
    expect(r.itemOutcomes[items[1]!.id]).toBe('BLOCK');
    expect(r.batchDisposition).toBe('QUARANTINE');
    expect(r.deliverable).toBe(false);
  });

  it('an indirect blocking prerequisite that the item ACTUALLY requires → blocked', () => {
    // EQUAL_CHAIN's prereq closure includes M4.FRAC.CONCEPT (blocking in blockedSpec)
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', knowledgeLevel: 'K2', requiredSkillIds: [asSkillId(SKILL)] });
    const r = validateGeneratedBatch(batch(items), blockedSpec, kb);
    expect(r.reasonCodes).toContain('UNLEARNED_REQUIRED_KNOWLEDGE');
    expect(r.itemOutcomes[items[1]!.id]).toBe('BLOCK');
  });

  it('a weak but UNRELATED prerequisite does not block the item', () => {
    const unrelatedBlocked: ExerciseGenerationSpec = {
      ...baseSpec,
      childState: { ...baseSpec.childState, prerequisiteGaps: [{ skillId: asSkillId('M7.GEO.PARALLEL_CRITERIA'), severity: 0.9, blocking: true }] },
    };
    const items = cleanBatch(); // all ratio items — geometry gap is irrelevant
    const r = validateGeneratedBatch(batch(items), unrelatedBlocked, kb);
    expect(r.reasonCodes).not.toContain('UNLEARNED_REQUIRED_KNOWLEDGE');
    expect(r.batchDisposition).toBe('DELIVER');
  });
});

describe('bucket ↔ target-role binding (doc 14 C4.1 §8)', () => {
  it('§14.9 — a bucket used with a skill outside its binding → TARGET_ROLE_MISMATCH', () => {
    // PREREQ is bound ONLY to the prerequisiteRepair bucket in baseSpec
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', skillId: asSkillId(PREREQ), requiredSkillIds: [asSkillId(PREREQ)] });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('TARGET_ROLE_MISMATCH');
  });

  it('§14.10 — the generator cannot introduce a frontier skill the planner did not select', () => {
    const items = cleanBatch();
    items[2] = item({ bucket: 'currentSkill', skillId: asSkillId(FRONTIER_SKILL), requiredSkillIds: [asSkillId(FRONTIER_SKILL)] });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('FRONTIER_SKILL_NOT_SELECTED');
    expect(r.batchDisposition).toBe('QUARANTINE');
  });

  it('requiredSkillIds outside the item target’s prerequisite closure → REQUIRED_SKILL_OUT_OF_BOUNDS', () => {
    const items = cleanBatch();
    items[1] = item({ bucket: 'currentSkill', skillId: asSkillId(SKILL), requiredSkillIds: [asSkillId(SKILL), asSkillId('M7.GEO.PARALLEL_CRITERIA')] });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.reasonCodes).toContain('REQUIRED_SKILL_OUT_OF_BOUNDS');
  });
});

describe('item vs batch outcome + no partial delivery (doc 14 C3.1 §C)', () => {
  it('one contract violation → QUARANTINE, deliverable false, no partial batch', () => {
    const items = cleanBatch();
    items[2] = item({ bucket: 'currentSkill', skillId: asSkillId('M7.MADE.UP_SKILL') });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.batchDisposition).toBe('QUARANTINE');
    expect(r.deliverable).toBe(false);
    expect(r.acceptedItems.length).toBeLessThan(baseSpec.generationPlan.totalQuestions);
  });

  it('one missing solution → REPAIR disposition (not quarantine)', () => {
    const items = cleanBatch();
    items[3] = item({ bucket: 'variation', answerSpec: { kind: 'reasoning' } }); // MISSING_RUBRIC → REPAIRABLE
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.batchDisposition).toBe('REPAIR');
    expect(r.itemOutcomes[items[3]!.id]).toBe('REPAIRABLE');
    expect(r.deliverable).toBe(false);
  });

  it('a duplicate item → REGENERATE_SLOTS (only the affected slot)', () => {
    const items = cleanBatch();
    items[2] = item({ bucket: 'currentSkill', prompt: items[1]!.prompt });
    const r = validateGeneratedBatch(batch(items), baseSpec, kb);
    expect(r.batchDisposition).toBe('REGENERATE_SLOTS');
    expect(r.itemOutcomes[items[1]!.id]).toBe('PASS');
    expect(r.shortfall).toBe(1);
  });

  it('DELIVER + deliverable only when accepted count === spec.totalQuestions', () => {
    const full = validateGeneratedBatch(batch(cleanBatch()), baseSpec, kb);
    expect(full.batchDisposition).toBe('DELIVER');
    expect(full.deliverable).toBe(true);

    const short = validateGeneratedBatch(batch(cleanBatch().slice(0, 3)), baseSpec, kb);
    expect(short.deliverable).toBe(false);
    expect(short.batchDisposition).not.toBe('DELIVER');
  });
});
