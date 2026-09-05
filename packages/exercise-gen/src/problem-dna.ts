import { createHash } from 'node:crypto';
import {
  KNOWLEDGE_LEVEL_MEANING,
  THINKING_LEVEL_MEANING,
  type ItemGenerationSpec,
  type KnowledgeLevel,
  type MathKernel,
  type ProblemDNA,
  type ProblemStructure,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ReferenceExample } from '@copilot/reference-library';

export const PROBLEM_DNA_BUILDER_VERSION = 'problem-dna.v1';

/**
 * A small Vietnamese context lexicon — scenario nouns commonly used in SGK word
 * problems. Used ONLY to detect + forbid reference contexts (not to generate).
 */
const SCENARIO_LEXICON = [
  'thư viện', 'tiền', 'thưởng', 'quãng đường', 'chặng', 'cây', 'vườn', 'gạo', 'xã',
  'viên bi', 'bi', 'lợi nhuận', 'vốn', 'vật liệu', 'công trình', 'nước', 'hoa quả',
  'sách', 'vở', 'bút', 'kẹo', 'bánh', 'táo', 'cam', 'quýt', 'gà', 'vịt', 'xe',
  'giờ', 'phút', 'ngày', 'tuần', 'tháng', 'lớp', 'học sinh', 'đội', 'nhóm',
  'ruộng', 'thóc', 'phân bón', 'bể', 'vòi', 'ô tô', 'xe máy', 'tàu', 'quả bóng',
  'mảnh đất', 'hàng rào', 'sân', 'lít', 'ki-lô-gam', 'mét', 'héc-ta', 'chai', 'thùng',
] as const;

/** Vietnamese given names frequently used as characters in textbook problems. */
const NAME_LEXICON = new Set([
  'An', 'Bình', 'Lan', 'Hoa', 'Nam', 'Mai', 'Hùng', 'Dũng', 'Minh', 'Tuấn', 'Hà',
  'Linh', 'Trang', 'Thảo', 'Huy', 'Khoa', 'Phúc', 'Ngọc', 'Quân', 'Vân', 'Hải',
  'Long', 'Đức', 'Hạnh', 'Cường', 'Sơn', 'Thu', 'Hương', 'Tú', 'Bảo',
]);

/**
 * Common swappable content nouns (objects / units / actors). Blanked in the
 * template skeleton so a "same shape, different noun+number" mutation
 * ("An có 5 quả táo…" → "Lan có 8 quả cam…") collapses to the SAME skeleton
 * and is caught as a template copy (doc 56 §6).
 */
const SWAPPABLE_NOUNS = new Set([
  'quả', 'táo', 'cam', 'quýt', 'chuối', 'xoài', 'bút', 'kẹo', 'bánh', 'gà', 'vịt',
  'sách', 'vở', 'truyện', 'quyển', 'cuốn', 'viên', 'bi', 'chiếc', 'cái', 'con',
  'cây', 'lít', 'kg', 'mét', 'cm', 'thùng', 'hộp', 'gói', 'túi', 'bao', 'giỏ',
  'khách', 'bạn', 'người', 'học', 'sinh', 'nhóm', 'đội', 'tổ', 'phần', 'hàng',
  'ghế', 'bàn', 'toà', 'nhà', 'căn', 'hộ', 'xe', 'đơn', 'giờ', 'phút', 'ngày',
  'tuần', 'tháng', 'nghìn', 'đồng', 'điểm', 'lần', 'độ',
]);

const DIGIT_RUN = /\d+(?:[.,]\d+)?/g;
const CAP_WORD = /\p{Lu}[\p{Ll}]+/gu;

export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(DIGIT_RUN)) {
    const n = Number(m[0].replace(',', '.'));
    if (Number.isFinite(n)) out.push(n);
  }
  return out.sort((a, b) => a - b);
}

export function extractProperNouns(text: string): string[] {
  const found = new Set<string>();
  // sentence-initial capitals are not proper nouns; split on terminators first
  for (const sentence of text.split(/(?<=[.!?…])\s+/)) {
    const words = [...sentence.matchAll(CAP_WORD)];
    words.forEach((w, i) => {
      const token = w[0]!;
      if (i === 0 && !NAME_LEXICON.has(token)) return; // sentence start
      if (NAME_LEXICON.has(token) || /\p{Lu}/u.test(token[1] ?? '')) found.add(token);
      else if (i > 0) found.add(token);
    });
  }
  return [...found];
}

export function extractScenarioNouns(text: string): string[] {
  const lower = text.toLowerCase();
  const hits = SCENARIO_LEXICON.filter((kw) => lower.includes(kw));
  return [...new Set([...hits, ...extractProperNouns(text)])];
}

/**
 * Structural skeleton: numbers → '#', proper nouns → '@', swappable content
 * nouns → '%', punctuation collapsed. Two prompts with the same sentence shape
 * but different names / objects / numbers collapse to the same skeleton.
 */
export function templateSkeleton(text: string): string {
  let s = text;
  for (const noun of extractProperNouns(text)) s = s.split(noun).join('@');
  const lowered = s
    .toLowerCase()
    .replace(DIGIT_RUN, '#')
    .replace(/@+/g, '@')
    .replace(/[^\p{L}\p{N}#@]+/gu, ' ')
    .trim();
  return lowered
    .split(' ')
    .map((w) => (SWAPPABLE_NOUNS.has(w) ? '%' : w))
    .join(' ')
    .replace(/(?:^| )%(?: %)+/g, ' %')
    .trim();
}

const OPERATION_BY_DOMAIN: Record<string, readonly string[]> = {
  fractions: ['số học với phân số'],
  arithmetic: ['số học với số tự nhiên / số thập phân'],
  number_sense: ['ước lượng và cấu tạo số'],
  algebraic_thinking: ['biến đổi đại số', 'lập luận theo tính chất'],
  word_problems: ['phân tích đề', 'chọn phép tính phù hợp'],
  geometry: ['tính toán hình học'],
  measurement: ['đổi đơn vị và tính toán đại lượng'],
  statistics_probability: ['đọc số liệu và tính toán thống kê'],
  logical_reasoning: ['suy luận logic'],
  pattern_reasoning: ['nhận ra và mở rộng quy luật'],
  combinatorial_thinking: ['đếm có hệ thống'],
};

const STRUCTURE_OP: Record<ProblemStructure, string> = {
  direct_computation: 'thực hiện một biểu thức tính khép kín',
  single_step_word_problem: 'bài toán lời văn một bước',
  multi_step_word_problem: 'bài toán lời văn nhiều bước',
  compare_and_decide: 'so sánh hai lựa chọn rồi kết luận',
  work_backwards: 'suy ngược từ kết quả về dữ kiện',
  explain_or_justify: 'giải thích / chứng minh một khẳng định',
  find_the_error: 'tìm và sửa lỗi sai trong một lời giải cho sẵn',
  construct_an_example: 'tự xây dựng một ví dụ thoả điều kiện',
};

const THINKING_REQUIREMENT_VI: Record<ThinkingLevel, string> = {
  T1: 'Nhớ lại và thực hiện đúng quy trình quen thuộc.',
  T2: 'Nhận ra dạng bài và áp dụng kiến thức đã học.',
  T3: 'Biến đổi, kết hợp nhiều bước; chọn cách làm.',
  T4: 'Lập chiến lược, phân tích tình huống chưa quen.',
  T5: 'Giải quyết bài không theo khuôn mẫu, cần ý tưởng mới.',
};

const NUMBER_RANGE_BY_K: Record<KnowledgeLevel, { min: number; max: number }> = {
  K0: { min: 1, max: 20 },
  K1: { min: 1, max: 50 },
  K2: { min: 1, max: 200 },
  K3: { min: 1, max: 2000 },
  K4: { min: 1, max: 10000 },
  K5: { min: 1, max: 100000 },
};

const VARIATION_AXES = [
  'bối cảnh thực tế (câu chuyện) hoàn toàn khác',
  'các số liệu cụ thể',
  'cách đặt câu hỏi (hỏi tổng / hiệu / phần còn lại / suy ngược)',
  'thứ tự trình bày dữ kiện',
  'nhân vật và địa điểm',
] as const;

function stableHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

export interface BuildProblemDnaOptions {
  /**
   * When provided, `rawReference` is populated for structures this predicate
   * returns a justification string for — with `leakageRisk: 'ELEVATED'`. Default:
   * never include raw reference text (doc 56 §5).
   */
  readonly rawReferenceJustification?: (spec: ItemGenerationSpec) => string | null;
  /** The deterministic MathKernel for this item, if one covers it (doc 58). */
  readonly mathKernel?: MathKernel | null;
}

/**
 * buildProblemDNA (doc 56 §5) — deterministic. Turns an `ItemGenerationSpec`
 * plus the reference examples for its skill into a STRUCTURE-only grounding: the
 * generator learns the skill, the shape, the difficulty, the number range and
 * what NOT to reproduce — but not the reference wording.
 */
export function buildProblemDNA(
  itemSpec: ItemGenerationSpec,
  kb: KnowledgeBase,
  referenceExamplesForSkill: readonly ReferenceExample[],
  opts: BuildProblemDnaOptions = {},
): ProblemDNA {
  const skill = kb.skills.get(itemSpec.skillId);
  const refs = referenceExamplesForSkill.filter((r) => r.skillId === itemSpec.skillId);

  const refNumbers = refs.map((r) => extractNumbers(r.prompt)).filter((ns) => ns.length > 0);
  const scenarios = [...new Set(refs.flatMap((r) => extractScenarioNouns(r.prompt)))].sort();
  const templateSkeletons = [...new Set(refs.map((r) => templateSkeleton(r.prompt)))].filter(
    (s) => s.length > 0,
  );

  const observedMin = refNumbers.flat().length > 0 ? Math.min(...refNumbers.flat()) : null;
  const observedMax = refNumbers.flat().length > 0 ? Math.max(...refNumbers.flat()) : null;
  const range =
    observedMin !== null && observedMax !== null && observedMax > observedMin
      ? { min: Math.max(1, Math.floor(observedMin / 2)), max: Math.ceil(observedMax * 1.5) }
      : NUMBER_RANGE_BY_K[itemSpec.knowledgeLevel];

  const avgSentences =
    refs.length > 0
      ? refs.reduce((s, r) => s + (r.prompt.split(/[.!?…]/).filter((x) => x.trim()).length || 1), 0) /
        refs.length
      : 1;
  const styleHints = [
    avgSentences <= 1.4
      ? 'Đề ngắn gọn, 1 câu, đi thẳng vào yêu cầu.'
      : 'Đề dạng lời văn ngắn, 2–3 câu, có bối cảnh rõ ràng.',
    'Dùng ký hiệu và cách trình bày theo SGK.',
    itemSpec.answerKind === 'reasoning'
      ? 'Yêu cầu học sinh trình bày lập luận, không chỉ ra một đáp số.'
      : 'Có duy nhất một đáp số đúng, kiểm tra được.',
  ];

  const rawJustification = opts.rawReferenceJustification?.(itemSpec) ?? null;
  const rawReference =
    rawJustification && refs[0]
      ? { prompt: refs[0].prompt, justification: rawJustification, leakageRisk: 'ELEVATED' as const }
      : null;

  const mathKernel = opts.mathKernel ?? null;

  const body = {
    itemId: itemSpec.itemId,
    generationSpecId: itemSpec.generationSpecId,
    language: 'vi' as const,
    skill: {
      id: itemSpec.skillId,
      name: skill?.name ?? itemSpec.skillId,
      domain: itemSpec.domain,
      description: skill?.description ?? '',
    },
    problemStructure: itemSpec.problemStructure,
    operationStructure: [
      ...(OPERATION_BY_DOMAIN[itemSpec.domain] ?? ['tính toán toán học']),
      STRUCTURE_OP[itemSpec.problemStructure],
    ],
    difficulty: {
      knowledgeLevel: itemSpec.knowledgeLevel,
      knowledgeMeaning: KNOWLEDGE_LEVEL_MEANING[itemSpec.knowledgeLevel],
      thinkingLevel: itemSpec.thinkingLevel,
      thinkingMeaning: THINKING_LEVEL_MEANING[itemSpec.thinkingLevel],
    },
    thinkingRequirement: THINKING_REQUIREMENT_VI[itemSpec.thinkingLevel],
    answerKind: itemSpec.answerKind,
    constraints: { ...itemSpec.constraints, numberRange: range },
    allowedVariationAxes: [...VARIATION_AXES],
    forbiddenSimilarities: {
      scenarios,
      numberTuples: refNumbers,
      templateSkeletons,
    },
    styleHints,
    rawReference,
    mathKernel,
  };

  return { ...body, dnaHash: stableHash(body) };
}
