import { describe, expect, it } from 'vitest';
import { asSkillId, type GeneratedExercise, type MathKernel } from '@copilot/domain';
import { checkContentQuality } from './content-quality.js';

/** doc 65 §9 — deterministic content-quality gate. */

function ex(over: Partial<GeneratedExercise> = {}): GeneratedExercise {
  return {
    id: 'x',
    generationSpecId: 'g',
    skillId: asSkillId('M4.ARITH.INT'),
    requiredSkillIds: [asSkillId('M4.ARITH.INT')],
    bucket: 'currentSkill',
    knowledgeLevel: 'K2',
    thinkingLevel: 'T2',
    prompt: 'Tính giá trị của biểu thức: 12 + 8 = ?',
    answerSpec: { kind: 'numeric', value: 20, tolerance: 0 },
    hints: ['Đọc kỹ đề bài.', 'Xác định phép tính.', 'Cộng hai số.', 'Thử số nhỏ.', 'Làm lại cẩn thận.', 'Đáp số: 20.'],
    workedSolution: '12 + 8 = 20. Đáp số: 20.',
    origin: 'ai_generated',
    ...over,
  };
}

const rectKernel: MathKernel = {
  family: 'RECT_GEOMETRY',
  units: 'cm²',
  semantics: { operation: 'MIXED', scenarioType: 'GEOMETRY', operandRoles: {}, askedQuantityRole: 'area' },
  expectedAnswer: { kind: 'numeric', value: 24, tolerance: 0 },
  requiredNumbersInPrompt: [6, 4],
  operationGraph: ['6 × 4 = 24'],
} as unknown as MathKernel;

describe('content-quality', () => {
  it('a clean item passes with no findings', () => {
    const r = checkContentQuality(ex(), null);
    expect(r.ok).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('rejects raw LaTeX in the prompt', () => {
    const r = checkContentQuality(ex({ prompt: 'Tính \\( \\frac{2}{4} \\times \\frac{5}{8} \\).' }), null);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('RAW_LATEX');
  });

  it('rejects additional TeX markup that v1 missed (\\angle, \\parallel, x^2, a_1, $…$)', () => {
    for (const p of [
      'Cho \\angle ABC = 40°. Tính góc kề bù với nó.',
      'Biết a \\parallel b, tính số đo góc so le trong.',
      'Tính giá trị của x^2 khi x = 3.',
      'Cho dãy a_1, a_2, a_3. Tìm a_2 biết tổng bằng 12.',
      'Tính $2 + 3 \\times 4$ theo thứ tự thực hiện phép tính.',
    ]) {
      const r = checkContentQuality(ex({ prompt: p }), null);
      expect(r.findings.map((f) => f.code), p).toContain('RAW_LATEX');
    }
  });

  it('does NOT flag legitimate Unicode super/subscript or plain prose', () => {
    for (const p of [
      'Một hình vuông cạnh 5 cm. Tính diện tích (cm²) của hình.',
      'Tính chu vi hình chữ nhật có chiều dài 8 m và chiều rộng 3 m.',
      'Cho góc A₁ và góc A₂ đối đỉnh. Giải thích vì sao chúng bằng nhau.',
    ]) {
      const r = checkContentQuality(ex({ prompt: p }), null);
      expect(r.findings.map((f) => f.code), p).not.toContain('RAW_LATEX');
    }
  });

  it('rejects a prompt that is not a Vietnamese question', () => {
    const r = checkContentQuality(ex({ prompt: '12 + 8' }), null);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('MALFORMED_VIETNAMESE');
  });

  it('warns (not blocks) on a missing unit in the answer line', () => {
    const r = checkContentQuality(
      ex({ prompt: 'Hình chữ nhật dài 6 cm rộng 4 cm. Tính diện tích.', workedSolution: '6 × 4 = 24. Đáp số: 24.' }),
      rectKernel,
    );
    expect(r.findings.map((f) => f.code)).toContain('UNIT_INCONSISTENT');
    expect(r.findings.find((f) => f.code === 'UNIT_INCONSISTENT')!.severity).toBe('WARN');
    expect(r.ok).toBe(true);
  });

  it('blocks an operation-language contradiction (multiply kernel, "each group" ask)', () => {
    const multKernel = { ...rectKernel, semantics: { ...rectKernel.semantics, operation: 'MULTIPLICATION' } } as MathKernel;
    const r = checkContentQuality(
      ex({ prompt: 'Có 8 nhóm, chia đều 24 cái kẹo, mỗi nhóm nhận được bao nhiêu cái?' }),
      multKernel,
    );
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('OPERATION_LANGUAGE_CONTRADICTION');
  });

  it('blocks a weak hint ladder', () => {
    const r = checkContentQuality(ex({ hints: ['a', 'b', 'c'] }), null);
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('WEAK_HINT_LADDER');
  });

  it('blocks a reasoning item with no rubric', () => {
    const r = checkContentQuality(
      ex({ answerSpec: { kind: 'reasoning' }, rubric: '' }),
      null,
    );
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain('WEAK_RUBRIC');
  });

  it('warns on excessive repetition', () => {
    const spammy = 'Bạn Bình có bao nhiêu quyển vở quyển vở quyển vở quyển vở quyển vở quyển vở?';
    const r = checkContentQuality(ex({ prompt: spammy }), null);
    expect(r.findings.map((f) => f.code)).toContain('EXCESSIVE_REPETITION');
  });

  it('does not reject merely imperfect style', () => {
    const r = checkContentQuality(
      ex({ prompt: 'Ừm, thế thì bạn hãy tính giúp: 12 + 8 bằng bao nhiêu nhỉ?' }),
      null,
    );
    expect(r.ok).toBe(true);
  });
});
