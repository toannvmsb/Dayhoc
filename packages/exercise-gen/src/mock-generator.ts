import {
  asProblemTypeId,
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  type ExerciseDistribution,
  type GeneratedExercise,
  type KnowledgeLevel,
  type SkillId,
  type ThinkingLevel,
} from '@copilot/domain';
import type { GenerationGrounding, GroundingSkill } from './grounding.js';
import type { ExerciseGenerator, GenerationOutcome, GenerationRequest, SlotRequest } from './generator.js';

/**
 * MockExerciseGenerator (doc 14 C4 §I) — deterministic, no network. Produces a
 * schema-valid batch that satisfies the grounding: correct bucket counts, K/T in
 * range, skills from the target set, valid `requiredSkillIds`, a 6-rung hint
 * ladder, unique Vietnamese prompts. It does NOT bypass the validator — the
 * orchestrator still validates its output.
 *
 * It is education-dumb: if the grounding cannot be satisfied (e.g. no target
 * skill, or a bucket needs a skill whose only path requires forbidden
 * knowledge) it returns a structured inability.
 */
export interface MockGeneratorOptions {
  readonly name?: string;
  /** Deterministic seed offset so repeated calls in a session differ. */
  readonly seed?: number;
}

const kIdx = (k: KnowledgeLevel): number => KNOWLEDGE_LEVELS.indexOf(k);
const tIdx = (t: ThinkingLevel): number => THINKING_LEVELS.indexOf(t);
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Bijective base-26 (1→a, 26→z, 27→aa …) — an alphabetic, digit-free marker. */
function letters(n: number): string {
  let x = Math.max(1, Math.floor(n));
  let s = '';
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(97 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function createMockExerciseGenerator(opts: MockGeneratorOptions = {}): ExerciseGenerator {
  return {
    name: opts.name ?? 'mock-exercise-generator',
    provider: 'mock',
    model: 'mock',
    modelVersion: 'mock-1',
    generate: (request) => Promise.resolve(runMock(request, opts.seed ?? 0)),
  };
}

function runMock(request: GenerationRequest, seed: number): GenerationOutcome {
  const { grounding } = request;
  if (grounding.targetSkills.length === 0) {
    return {
      ok: false,
      latencyMs: 1,
      inability: { reason: 'insufficient_grounding', detail: 'no target skills in the grounding' },
    };
  }

  const items: GeneratedExercise[] = [];
  const isRegen = !!request.regenerate && request.regenerate.length > 0;
  // a per-run marker offset so regenerated items never share a variant token /
  // prompt with the batch's kept items.
  let variant = seed + (isRegen ? 500 : 0);

  const slots: Array<{ bucket: keyof ExerciseDistribution; skillId: SkillId; replaces: readonly string[] }> = isRegen
    ? request.regenerate!.map((s: SlotRequest) => ({ bucket: s.bucket, skillId: s.skillId, replaces: s.replaces }))
    : expandBuckets(grounding.plan.distribution, grounding.targetSkills, grounding.forbiddenRequiredSkillIds);

  const unfilled: Partial<Record<keyof ExerciseDistribution, number>> = {};

  slots.forEach((slot) => {
    const skill = grounding.targetSkills.find((s) => s.skillId === slot.skillId) ?? grounding.targetSkills[0]!;
    variant += 1;
    const id = isRegen
      ? `gx-mock-r-${letters(variant)}-${(slot.replaces[0] ?? 'fill').replace(/[^a-z0-9]/gi, '')}`
      : `gx-mock-${letters(variant)}`;
    const built = buildItem(grounding, skill, slot.bucket, id, variant);
    if (!built) {
      unfilled[slot.bucket] = (unfilled[slot.bucket] ?? 0) + 1;
      return;
    }
    items.push(built);
  });

  if (Object.keys(unfilled).length > 0 && items.length === 0) {
    return {
      ok: false,
      latencyMs: 2,
      inability: { reason: 'cannot_satisfy_constraints', detail: 'no slot could be filled within the grounding', unfilledBuckets: unfilled },
    };
  }

  return {
    ok: true,
    latencyMs: 2,
    batch: {
      generationSpecId: grounding.generationSpecId,
      generatedAt: '1970-01-01T00:00:00.000Z',
      generatorModel: 'mock',
      items,
    },
  };
}

/** One flat slot per bucket-count, round-robin over the target skills. */
function expandBuckets(
  dist: ExerciseDistribution,
  targetSkills: readonly GroundingSkill[],
  forbidden: readonly SkillId[],
): Array<{ bucket: keyof ExerciseDistribution; skillId: SkillId; replaces: readonly string[] }> {
  const forbiddenSet = new Set<string>(forbidden);
  // a target skill is "clean" for a K2+ non-repair item when none of its weak
  // prerequisites is forbidden (blocking).
  const clean = targetSkills.filter((s) => !s.weakPrerequisites.some((p) => forbiddenSet.has(p)));
  const out: Array<{ bucket: keyof ExerciseDistribution; skillId: SkillId; replaces: readonly string[] }> = [];
  let rr = 0;
  for (const bucket of DISTRIBUTION_BUCKETS) {
    for (let i = 0; i < dist[bucket]; i++) {
      const skill =
        bucket === 'prerequisiteRepair'
          ? (targetSkills.find((s) => s.weakPrerequisites.length > 0) ?? targetSkills[rr++ % targetSkills.length]!)
          : bucket === 'advanced'
            ? (clean[rr++ % Math.max(1, clean.length)] ?? targetSkills[rr % targetSkills.length]!)
            : ((clean.length > 0 ? clean : targetSkills)[rr++ % (clean.length > 0 ? clean.length : targetSkills.length)]!);
      out.push({ bucket, skillId: skill.skillId, replaces: [] });
    }
  }
  return out;
}

function buildItem(
  grounding: GenerationGrounding,
  skill: GroundingSkill,
  bucket: keyof ExerciseDistribution,
  id: string,
  variantIndex: number,
): GeneratedExercise | null {
  const kLo = kIdx(grounding.difficulty.kMin);
  const kHi = kIdx(grounding.difficulty.kMax);
  const tLo = tIdx(grounding.difficulty.tMin);
  const tHi = tIdx(grounding.difficulty.tMax);

  const skillHasBlockingPath = skill.weakPrerequisites.length > 0;
  // non-repair items on a skill with a weak/blocking prerequisite stay at the
  // gentle (concept-intro) end so they don't assume prereq fluency.
  const targetK =
    bucket === 'prerequisiteRepair'
      ? kLo
      : bucket === 'advanced'
        ? kHi
        : skillHasBlockingPath
          ? clamp(kIdx('K1'), kLo, kHi)
          : clamp(Math.round((kLo + kHi) / 2), kLo, kHi);
  const targetT =
    bucket === 'thinkingChallenge'
      ? tHi
      : bucket === 'advanced'
        ? clamp(tHi - 1, tLo, tHi)
        : bucket === 'prerequisiteRepair'
          ? tLo
          : clamp(Math.round((tLo + tHi) / 2), tLo, tHi);

  // prefer a real problem type whose (K,T) sits at or below the target
  const pt = skill.problemTypes.find(
    (p) => kIdx(p.knowledgeLevel) <= targetK && tIdx(p.thinkingLevel) <= targetT,
  );
  const knowledgeLevel = pt ? pt.knowledgeLevel : (KNOWLEDGE_LEVELS[targetK] as KnowledgeLevel);
  const thinkingLevel = pt ? pt.thinkingLevel : (THINKING_LEVELS[targetT] as ThinkingLevel);

  const requiredSkillIds: SkillId[] =
    bucket === 'prerequisiteRepair' && skill.weakPrerequisites.length > 0
      ? [skill.weakPrerequisites[0]!]
      : [skill.skillId];
  // never require forbidden knowledge on a non-repair item
  if (
    bucket !== 'prerequisiteRepair' &&
    requiredSkillIds.some((s) => grounding.forbiddenRequiredSkillIds.includes(s))
  ) {
    return null;
  }

  const supportingSkillIds = skill.satisfiedPrerequisites.slice(0, 2);
  const label = BUCKET_LABEL[bucket];
  // a rotating scenario + a unique alphabetic marker so no two prompts collide
  const scenario = SCENARIOS[variantIndex % SCENARIOS.length]!;
  const marker = letters(variantIndex);

  return {
    id,
    generationSpecId: grounding.generationSpecId,
    skillId: skill.skillId,
    requiredSkillIds,
    ...(supportingSkillIds.length > 0 ? { supportingSkillIds } : {}),
    ...(pt ? { problemTypeId: asProblemTypeId(pt.id) } : {}),
    bucket,
    knowledgeLevel,
    thinkingLevel,
    prompt: `[${label}] ${scenario} Vận dụng kỹ năng "${skill.name}" (biến thể ${marker}) để giải và trình bày lời giải theo từng bước.`,
    answerSpec: { kind: 'numeric', value: 42, tolerance: 0 },
    hints: [
      'Đọc kỹ đề và xác định dữ kiện đã cho.',
      'Nhớ lại tính chất liên quan tới kỹ năng này.',
      'Viết biểu thức/phương trình phù hợp.',
      `Ví dụ đơn giản hơn: xét trường hợp số nhỏ của "${skill.name}".`,
      'Thử lại với đề gốc, kiểm tra từng bước.',
      'Lời giải đầy đủ: áp dụng tính chất, biến đổi và tính ra kết quả 42.',
    ],
    workedSolution: `Áp dụng kiến thức của bài "${skill.name}": lập biểu thức, biến đổi và tính được kết quả bằng 42.`,
    origin: 'ai_generated',
  };
}

/** Distinct surface stories so mock items are not near-duplicates of each other. */
const SCENARIOS: readonly string[] = [
  'Ba lớp góp sách cho thư viện theo tỉ lệ đã cho.',
  'Chia số tiền thưởng cho các nhóm học sinh.',
  'Pha nước hoa quả theo công thức tỉ lệ.',
  'Chia quãng đường thành các chặng theo tỉ lệ.',
  'Tính số cây trồng ở ba khu vườn.',
  'Chia gạo cứu trợ cho ba xã.',
  'Phân chia thời gian ôn tập cho ba môn học.',
  'Tính số viên bi của ba bạn trong một trò chơi.',
  'Chia lợi nhuận cho các thành viên góp vốn.',
  'Tính lượng vật liệu cho ba công trình nhỏ.',
];

const BUCKET_LABEL: Record<keyof ExerciseDistribution, string> = {
  prerequisiteRepair: 'Ôn nền',
  currentSkill: 'Bài hiện tại',
  variation: 'Biến thể',
  application: 'Vận dụng',
  advanced: 'Nâng cao',
  thinkingChallenge: 'Thử thách tư duy',
};
