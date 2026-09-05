import type {
  AnswerKind,
  AnswerSpec,
  GeneratedExercise,
  GeneratedItemContent,
  ItemGenerationSpec,
  MathKernel,
} from '@copilot/domain';

/**
 * Deterministic composition (doc 56 §1/§2). Takes the model's CONTENT and the
 * deterministic `ItemGenerationSpec` and produces a full `GeneratedExercise`:
 * every educational-authority field is copied verbatim from the spec, and the
 * plain-string `answer` is coerced to the spec's pinned `AnswerKind`. If the
 * content can't be coerced (e.g. "abc" for a numeric item, no distractors for a
 * choice item, no rubric for a reasoning item), composition FAILS with a
 * deterministic regeneration instruction — the model never gets to override the
 * pinned kind.
 */
export type ComposeResult =
  | { readonly ok: true; readonly exercise: GeneratedExercise }
  | { readonly ok: false; readonly reason: string; readonly regenerationInstruction: string };

const NUM_RE = /-?\d+(?:[.,]\d+)?/;

function parseNumber(raw: string): number | null {
  const m = NUM_RE.exec(raw.replace(/\s+/g, ''));
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseFraction(raw: string): { numerator: number; denominator: number } | null {
  const t = raw.replace(/\s+/g, '');
  const frac = /^(-?\d+)\/(-?\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[2]);
    if (!Number.isInteger(d) || d === 0) return null;
    return { numerator: Number(frac[1]), denominator: d };
  }
  if (/^-?\d+$/.test(t)) return { numerator: Number(t), denominator: 1 };
  return null;
}

export function composeExercise(
  itemSpec: ItemGenerationSpec,
  content: GeneratedItemContent,
  kernel?: MathKernel | null,
): ComposeResult {
  const fail = (reason: string, regenerationInstruction: string): ComposeResult => ({
    ok: false,
    reason,
    regenerationInstruction,
  });
  // when a kernel covers the item, the kernel's answer family is authoritative
  const answerKind: AnswerKind = kernel?.answerKind ?? itemSpec.answerKind;

  if (content.hints.length !== 6 || content.hints.some((h) => h.trim().length === 0)) {
    return fail(
      `expected 6 non-empty hint rungs, got ${content.hints.length}`,
      'Cung cấp đúng 6 bậc gợi ý, không bậc nào để trống; bậc 6 là lời giải đầy đủ.',
    );
  }
  if (content.workedSolution.trim().length === 0) {
    return fail('empty worked solution', 'Trình bày lời giải đầy đủ theo từng bước.');
  }

  let answerSpec: AnswerSpec;
  switch (answerKind) {
    case 'numeric': {
      const n = parseNumber(content.answer);
      if (n === null) {
        return fail(
          `numeric item — answer "${content.answer}" is not a number`,
          'Đáp số phải là MỘT số cụ thể (ví dụ 42 hoặc 3,5), không kèm chữ.',
        );
      }
      answerSpec = { kind: 'numeric', value: n, tolerance: 0 };
      break;
    }
    case 'fraction': {
      const f = parseFraction(content.answer);
      if (!f) {
        return fail(
          `fraction item — answer "${content.answer}" is not a fraction`,
          'Đáp số phải ở dạng phân số a/b (b ≠ 0) hoặc một số nguyên.',
        );
      }
      answerSpec = { kind: 'fraction', numerator: f.numerator, denominator: f.denominator };
      break;
    }
    case 'exact': {
      const v = content.answer.trim();
      if (v.length === 0) return fail('exact item — empty answer', 'Ghi rõ đáp số.');
      answerSpec = { kind: 'exact', value: v };
      break;
    }
    case 'choice': {
      const correct = content.answer.trim();
      const distractors = (content.distractors ?? []).map((d) => d.trim()).filter((d) => d.length > 0);
      const options = [...new Set([correct, ...distractors])];
      if (correct.length === 0 || distractors.length < 1 || options.length < 2) {
        return fail(
          'choice item — need a correct answer plus at least one distinct distractor',
          'Cung cấp đáp án đúng ở "answer" và ít nhất 2 phương án nhiễu khác nhau ở "distractors".',
        );
      }
      answerSpec = { kind: 'choice', correct, options };
      break;
    }
    case 'reasoning': {
      if (!content.rubric || content.rubric.trim().length < 10) {
        return fail(
          'reasoning item — rubric is null / empty / too short',
          'BẮT BUỘC: trường "rubric" phải là một chuỗi mô tả cách chấm điểm (ví dụ "Nêu đúng tính chất 0,5đ; lập luận chặt chẽ 0,5đ"), KHÔNG được để null hay rỗng.',
        );
      }
      answerSpec = { kind: 'reasoning' };
      break;
    }
    default:
      return fail(`unknown answer kind ${answerKind as string}`, 'Sinh lại câu hỏi.');
  }

  const exercise: GeneratedExercise = {
    id: itemSpec.itemId,
    generationSpecId: itemSpec.generationSpecId,
    skillId: itemSpec.skillId,
    requiredSkillIds: itemSpec.requiredSkillIds,
    ...(itemSpec.supportingSkillIds.length > 0 ? { supportingSkillIds: itemSpec.supportingSkillIds } : {}),
    ...(itemSpec.problemTypeId ? { problemTypeId: itemSpec.problemTypeId } : {}),
    bucket: itemSpec.bucket,
    knowledgeLevel: itemSpec.knowledgeLevel,
    thinkingLevel: itemSpec.thinkingLevel,
    prompt: content.prompt,
    answerSpec,
    hints: content.hints,
    workedSolution: content.workedSolution,
    ...(answerKind === 'reasoning' && content.rubric ? { rubric: content.rubric } : {}),
    origin: 'ai_generated',
  };
  return { ok: true, exercise };
}
