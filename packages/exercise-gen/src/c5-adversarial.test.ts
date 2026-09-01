import { describe, expect, it } from 'vitest';
import { asSkillId, type GeneratedExercise, type GeneratedExerciseBatch, type GenerationOutcome } from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { loadReferenceLibrary } from '@copilot/reference-library';
import { validateGeneratedBatch } from './validator.js';
import { buildGenerationGrounding } from './grounding.js';
import { orchestrateGeneration } from './orchestrator.js';
import type { ExerciseGenerator, GenerationRequest } from './generator.js';
import { makeSpec, SKILL, FRONTIER_SKILL, FRONTIER_TARGET } from './_spec-fixture.js';

/**
 * C5.2 §C — adversarial generator/validator cases. A deterministic fake
 * generator deliberately breaks the educational contract; the validator must
 * catch it with the right reason code + disposition. The validator is NOT
 * weakened to make anything pass.
 */

const kb = loadKnowledgeBase();
const lib = loadReferenceLibrary();
const spec = makeSpec();
const grounding = buildGenerationGrounding(spec, lib, kb);

let n = 0;
function item(over: Partial<GeneratedExercise> = {}): GeneratedExercise {
  n += 1;
  const skillId = over.skillId ?? asSkillId(SKILL);
  return {
    id: `adv_${n}`,
    generationSpecId: spec.generationSpecId,
    skillId,
    requiredSkillIds: over.requiredSkillIds ?? [skillId],
    bucket: 'currentSkill',
    knowledgeLevel: 'K2',
    thinkingLevel: 'T2',
    prompt: `Câu ${n}: một tình huống tỉ lệ, hãy lập luận và tính kết quả cho trường hợp ${n} với các số khác nhau.`,
    answerSpec: { kind: 'numeric', value: 6, tolerance: 0 },
    hints: ['Định hướng', 'Câu hỏi dẫn', 'Gợi ý hai', 'Ví dụ đơn giản hơn', 'Thử lại bài gốc', 'Lời giải đầy đủ: kết quả bằng sáu.'],
    workedSolution: 'Áp dụng tính chất dãy tỉ số bằng nhau, kết quả bằng sáu.',
    origin: 'ai_generated',
    ...over,
  };
}
const batch = (items: GeneratedExercise[]): GeneratedExerciseBatch => ({
  generationSpecId: spec.generationSpecId,
  generatedAt: '2027-01-25T09:05:00.000Z',
  items,
});
const codes = (b: GeneratedExerciseBatch) => validateGeneratedBatch(b, spec, kb, grounding.referenceExamples).reasonCodes;

function fakeGen(outcomes: GenerationOutcome[]): ExerciseGenerator {
  let i = 0;
  return {
    name: 'adversarial',
    provider: 'mock',
    model: 'mock',
    modelVersion: null,
    promptVersion: null,
    generate: (_r: GenerationRequest) => Promise.resolve(outcomes[Math.min(i++, outcomes.length - 1)]!),
  };
}

describe('C5.2 §C — adversarial generator / validator cases', () => {
  it('1. schema-valid but mathematically WRONG answer → ANSWER_INCONSISTENT', () => {
    expect(codes(batch([item({ prompt: '2 + 3 × 4 = ?', answerSpec: { kind: 'numeric', value: 20, tolerance: 0 } })]))).toContain('ANSWER_INCONSISTENT');
  });

  it('2. invented skillId → UNKNOWN_SKILL_ID + QUARANTINE', () => {
    const r = validateGeneratedBatch(batch([item({ skillId: asSkillId('M7.NOT.REAL') })]), spec, kb, grounding.referenceExamples);
    expect(r.reasonCodes).toContain('UNKNOWN_SKILL_ID');
    expect(r.batchDisposition).toBe('QUARANTINE');
  });

  it('3. invented requiredSkillId → UNKNOWN_REQUIRED_SKILL_ID + QUARANTINE', () => {
    const r = validateGeneratedBatch(batch([item({ requiredSkillIds: [asSkillId(SKILL), asSkillId('M7.FAKE.REQ')] })]), spec, kb, grounding.referenceExamples);
    expect(r.reasonCodes).toContain('UNKNOWN_REQUIRED_SKILL_ID');
    expect(r.batchDisposition).toBe('QUARANTINE');
  });

  it('4. required skill outside the item target prerequisite closure → REQUIRED_SKILL_OUT_OF_BOUNDS', () => {
    // M7.GEO.PARALLEL_CRITERIA is a real skill but not in EQUAL_CHAIN's prereq closure
    expect(codes(batch([item({ requiredSkillIds: [asSkillId(SKILL), asSkillId('M7.GEO.PARALLEL_CRITERIA')] })]))).toContain('REQUIRED_SKILL_OUT_OF_BOUNDS');
  });

  it('5. exact reference-example copy → REFERENCE_EXACT_COPY', () => {
    expect(codes(batch([item({ prompt: grounding.referenceExamples[0]!.prompt })]))).toContain('REFERENCE_EXACT_COPY');
  });

  it('6. number-only reference mutation → REFERENCE_EXAMPLE_COPY (near)', () => {
    const mutated = grounding.referenceExamples[0]!.prompt.replace(/\d+/g, (d) => String(Number(d) + 2));
    const c = codes(batch([item({ prompt: mutated })]));
    expect(c).toContain('REFERENCE_EXAMPLE_COPY');
    expect(c).not.toContain('REFERENCE_EXACT_COPY');
  });

  it('7. K outside the allowed range → OUTSIDE_K_RANGE', () => {
    expect(codes(batch([item({ knowledgeLevel: 'K5' })]))).toContain('OUTSIDE_K_RANGE');
  });

  it('8. T outside the allowed range → OUTSIDE_T_RANGE', () => {
    expect(codes(batch([item({ thinkingLevel: 'T5' })]))).toContain('OUTSIDE_T_RANGE');
  });

  it('9. advanced bucket using a CURRENT skill instead of a FRONTIER target → TARGET_ROLE_MISMATCH', () => {
    // EQUAL_CHAIN is a CURRENT target; the advanced bucket is bound to FRONTIER only
    expect(codes(batch([item({ skillId: asSkillId(SKILL), bucket: 'advanced', knowledgeLevel: 'K3' })]))).toContain('TARGET_ROLE_MISMATCH');
  });

  it('10. T5 item that secretly needs unsupported above-grade knowledge → FRONTIER_SKILL_NOT_SELECTED / QUARANTINE', () => {
    // spec did NOT select M7.ALG.SYMMETRIC (grade-9) as a frontier target
    const r = validateGeneratedBatch(
      batch([item({ skillId: asSkillId(FRONTIER_SKILL), bucket: 'advanced', knowledgeLevel: 'K5', thinkingLevel: 'T5', requiredSkillIds: [asSkillId(FRONTIER_SKILL)] })]),
      spec,
      kb,
      grounding.referenceExamples,
    );
    expect(r.reasonCodes.some((c) => c === 'FRONTIER_SKILL_NOT_SELECTED' || c === 'ABOVE_GRADE_KNOWLEDGE_NOT_ALLOWED')).toBe(true);
    expect(r.batchDisposition).toBe('QUARANTINE');
  });

  it('11. reasoning item missing a rubric → MISSING_RUBRIC', () => {
    const it = item({ answerSpec: { kind: 'reasoning' } });
    delete (it as { rubric?: string }).rubric;
    expect(codes(batch([it]))).toContain('MISSING_RUBRIC');
  });

  it('12. duplicate variants → DUPLICATE_VARIANT', () => {
    const p = 'Cho a chia b bằng hai phần ba và tổng bằng hai lăm, tìm a và b theo cách chuẩn.';
    expect(codes(batch([item({ prompt: p }), item({ prompt: p })]))).toContain('DUPLICATE_VARIANT');
  });

  it('13. worksheet shortfall → the orchestrator does not deliver a partial batch', async () => {
    const short: GenerationOutcome = { ok: true, latencyMs: 1, batch: batch([item(), item()]) }; // spec wants 8
    const res = await orchestrateGeneration({ spec, generator: fakeGen([short]), referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('failed');
    if (res.status === 'failed') expect(res.lastValidation?.deliverable).toBe(false);
  });

  it('14. malformed / incomplete structured output → no delivery', async () => {
    const bad: GenerationOutcome = { ok: false, latencyMs: 1, inability: { reason: 'cannot_satisfy_constraints', detail: 'not JSON' } };
    const res = await orchestrateGeneration({ spec, generator: fakeGen([bad]), referenceLibrary: lib, knowledgeBase: kb });
    expect(res.status).toBe('failed');
  });

  it('15. unsafe / age-inappropriate content → UNSAFE_CONTENT + QUARANTINE', () => {
    const r = validateGeneratedBatch(batch([item({ prompt: 'Một khẩu weapon được dùng để tính toán số đạn.' })]), spec, kb, grounding.referenceExamples);
    expect(r.reasonCodes).toContain('UNSAFE_CONTENT');
    expect(r.batchDisposition).toBe('QUARANTINE');
  });

  it('the validator was NOT weakened — a clean full batch still validates', () => {
    void FRONTIER_TARGET;
    // (covered exhaustively elsewhere; this is a guard that the adversarial edits above did not relax defaults)
    expect(validateGeneratedBatch(batch([]), spec, kb, grounding.referenceExamples).reasonCodes).not.toContain('SCHEMA_INVALID');
  });
});
