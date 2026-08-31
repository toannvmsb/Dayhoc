import {
  asProblemTypeId,
  type ChildLearningTwin,
  type Evidence,
  type GapType,
  type SkillId,
  type SkillMasteryState,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase, ProblemType } from '@copilot/math-data';
import type { GapConfig } from './config.js';
import { traceRootGap, type RootGapTrace } from './root-gap.js';

const DAY_MS = 86_400_000;
const HIGH_THINKING: readonly ThinkingLevel[] = ['T4', 'T5'];
const LOW_THINKING: readonly ThinkingLevel[] = ['T1', 'T2'];

export interface GapFinding {
  readonly type: GapType;
  readonly targetSkillId: SkillId;
  readonly rootSkillId: SkillId;
  readonly severity: number; // 0..1
  readonly rationale: string;
  readonly ruledOut: readonly GapType[];
  readonly rootTrace: RootGapTrace;
  readonly evidenceRefs: readonly string[];
}

export interface DetectInput {
  readonly twin: ChildLearningTwin;
  readonly evidence: readonly Evidence[];
  readonly knowledgeBase: KnowledgeBase;
  readonly config: GapConfig;
  readonly asOf: Date;
}

/**
 * Classify the failure on each evidenced skill into exactly one gap type
 * (Math Core §19–§20). Rule-based and deterministic; `ruledOut` records the
 * confusable types the engine considered and rejected (auditability).
 */
export function detectGaps(input: DetectInput): GapFinding[] {
  const { twin, knowledgeBase: kb, config, asOf } = input;
  const findings: GapFinding[] = [];

  const evidenceBySkill = new Map<SkillId, Evidence[]>();
  for (const e of input.evidence) {
    if (!e.skillId) continue;
    const list = evidenceBySkill.get(e.skillId) ?? [];
    list.push(e);
    evidenceBySkill.set(e.skillId, list);
  }

  for (const [skillId, state] of [...twin.skillMastery.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    const skill = kb.skills.get(skillId);
    if (!skill) continue;

    const healthy = state.mastery >= config.masteryTarget && state.recentErrorStreak === 0;
    const problemTypes = kb.getProblemTypesForSkill(skillId);
    const weakPt = problemTypes.find(
      (pt) => (twin.problemTypeMastery.get(asProblemTypeId(pt.id))?.mastery ?? 100) < config.masteryTarget,
    );
    if (healthy && !weakPt) continue;

    const recent = (evidenceBySkill.get(skillId) ?? [])
      .slice()
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const evidenceRefs = recent.slice(0, 5).map((e) => e.id);
    const lastWrong = recent.find((e) => e.result.correct === false);
    const rootTrace = traceRootGap(skillId, twin, kb, config);
    const ruledOut: GapType[] = [];

    const finding = classify({
      skill,
      skillId,
      state,
      recent,
      lastWrong,
      problemTypes,
      twin,
      config,
      asOf,
      rootTrace,
      ruledOut,
      evidenceRefs,
      kb,
    });
    if (finding) findings.push(finding);
  }

  return findings;
}

interface ClassifyCtx {
  skill: { domain: string; name: string; thinkingDimensions: readonly string[] };
  skillId: SkillId;
  state: SkillMasteryState;
  recent: readonly Evidence[];
  lastWrong: Evidence | undefined;
  problemTypes: readonly ProblemType[];
  twin: ChildLearningTwin;
  config: GapConfig;
  asOf: Date;
  rootTrace: RootGapTrace;
  ruledOut: GapType[];
  evidenceRefs: readonly string[];
  kb: KnowledgeBase;
}

function classify(c: ClassifyCtx): GapFinding | null {
  const { state, config, twin, skillId, rootTrace } = c;
  const ptMastery = (id: string): number =>
    twin.problemTypeMastery.get(asProblemTypeId(id))?.mastery ?? -1;

  // 1 — retention_gap: was verified well, long ago, now slipping.
  const verifiedAgeDays = c.state.lastVerifiedAt
    ? (c.asOf.getTime() - Date.parse(c.state.lastVerifiedAt)) / DAY_MS
    : Infinity;
  if (
    c.state.lastVerifiedAt &&
    verifiedAgeDays > config.retentionStaleDays &&
    state.retention < config.lowRetention &&
    state.recentErrorStreak >= 1
  ) {
    return finding(c, 'retention_gap', skillId, 0.4 + (1 - state.retention) * 0.3, [
      `Con từng làm chắc kỹ năng này (${daysAgo(verifiedAgeDays)}) nhưng gần đây sai lại — dấu hiệu quên, không phải chưa hiểu.`,
    ]);
  }
  c.ruledOut.push('retention_gap');

  // 2 — careless_error: high mastery, isolated slip, strong reasoning, no hints.
  if (
    state.mastery >= config.carelessMinMastery &&
    state.recentErrorStreak <= config.carelessMaxStreak &&
    c.lastWrong?.reasoningQuality === 'strong' &&
    (c.lastWrong.hintDependency ?? 0) < 0.3
  ) {
    return finding(c, 'careless_error', skillId, 0.1, [
      'Con trình bày đúng hướng, chỉ sai ở một bước — lỗi bất cẩn, không cần hạ mức thành thạo.',
    ]);
  }
  c.ruledOut.push('careless_error');

  // 3 — prerequisite_gap: a weak, important prerequisite with evidence.
  if (rootTrace.isPrerequisite) {
    const rootName = c.kb.skills.get(rootTrace.rootSkillId)?.name ?? rootTrace.rootSkillId;
    const deficit = (config.weakPrerequisite - (twin.skillMastery.get(rootTrace.rootSkillId)?.mastery ?? 0)) / config.weakPrerequisite;
    return finding(
      c,
      'prerequisite_gap',
      rootTrace.rootSkillId,
      Math.min(0.9, 0.5 + Math.max(0, deficit) * 0.4),
      [`Bài đang học phụ thuộc vào "${rootName}" — phần này chưa vững nên các bước cuối hay sai.`],
    );
  }
  c.ruledOut.push('prerequisite_gap');

  // 4 — reasoning_gap: knowledge is strong, thinking is not.
  const relevantThinking = [...twin.thinkingProfile.entries()].filter(([dim]) =>
    c.skill.thinkingDimensions.includes(dim),
  );
  const weakThinkingDim = relevantThinking.find(([, s]) => s.score < config.weakThinking && s.evidenceCount > 0);
  const highThinkingPtWeak = c.problemTypes.some(
    (pt) => HIGH_THINKING.includes(pt.thinkingLevel) && ptMastery(pt.id) >= 0 && ptMastery(pt.id) < config.masteryTarget,
  );
  if (state.mastery >= config.strongMastery && (weakThinkingDim || highThinkingPtWeak)) {
    return finding(c, 'reasoning_gap', skillId, 0.45 + (state.mastery >= 85 ? 0.15 : 0), [
      'Kiến thức nền của con vững; chỗ vướng là ở bước suy luận/chiến lược khi bài cần nhiều bước. Ưu tiên luyện tư duy, không hạ kiến thức.',
    ]);
  }
  c.ruledOut.push('reasoning_gap');

  // 5 — recognition_gap / application_gap: can execute directly, fails when it must be recognised/applied.
  const directStrong = c.problemTypes
    .filter((pt) => LOW_THINKING.includes(pt.thinkingLevel) && ptMastery(pt.id) >= 0)
    .every((pt) => ptMastery(pt.id) >= config.masteryTarget);
  const hasDirect = c.problemTypes.some(
    (pt) => LOW_THINKING.includes(pt.thinkingLevel) && ptMastery(pt.id) >= 0,
  );
  const weakerPt = c.problemTypes.find(
    (pt) => !LOW_THINKING.includes(pt.thinkingLevel) && ptMastery(pt.id) >= 0 && ptMastery(pt.id) < config.masteryTarget,
  );
  if (hasDirect && directStrong && weakerPt) {
    const applied = c.skill.domain === 'word_problems' || /thực tế|vận dụng|bài toán/i.test(weakerPt.name);
    return finding(
      c,
      applied ? 'application_gap' : 'recognition_gap',
      skillId,
      0.4,
      [
        applied
          ? 'Con làm tốt bài trực tiếp nhưng lúng túng khi đề ở dạng bài toán thực tế — thiếu bước chuyển từ lời văn sang phép toán.'
          : `Con làm được khi biết phải dùng cách nào, nhưng chưa nhận ra dạng "${weakerPt.name}" để tự chọn cách.`,
      ],
    );
  }
  c.ruledOut.push('recognition_gap', 'application_gap');

  // 6 — method_gap: one problem type weak, siblings fine, leaning on hints there.
  const weakPts = c.problemTypes.filter((pt) => ptMastery(pt.id) >= 0 && ptMastery(pt.id) < config.masteryTarget);
  const okPts = c.problemTypes.filter((pt) => ptMastery(pt.id) >= config.masteryTarget);
  if (weakPts.length === 1 && okPts.length >= 1 && (c.lastWrong?.hintDependency ?? 0) >= 0.5) {
    return finding(c, 'method_gap', skillId, 0.4, [
      `Con nắm ý tưởng chung nhưng chọn/nhớ sai cách làm cho dạng "${weakPts[0]!.name}".`,
    ]);
  }
  c.ruledOut.push('method_gap');

  // 7 — procedural_gap: recurring partial credit, steps present, reasoning not weak.
  const partials = c.recent.filter(
    (e) => e.result.correct !== true && (e.result.score ?? 0) > 0 && (e.result.score ?? 0) < 1,
  );
  if (partials.length >= 2 && c.lastWrong?.reasoningQuality !== 'weak') {
    return finding(c, 'procedural_gap', skillId, 0.35, [
      'Con hiểu cách làm nhưng hay sai ở khâu thực hiện nhiều bước (tính toán, biến đổi). Cần luyện độ chính xác.',
    ]);
  }
  c.ruledOut.push('procedural_gap');

  // 8 — concept_gap: consistent failure, prerequisites fine, the idea itself isn't there.
  const deficit = (config.masteryTarget - state.mastery) / config.masteryTarget;
  return finding(c, 'concept_gap', skillId, Math.min(0.9, 0.5 + Math.max(0, deficit) * 0.4), [
    `Con chưa nắm bản chất của "${c.skill.name}" — sai ổn định ở nhiều dạng bài dù phần nền đã ổn.`,
  ]);
}

function finding(
  c: ClassifyCtx,
  type: GapType,
  rootSkillId: SkillId,
  severity: number,
  rationale: string[],
): GapFinding {
  return {
    type,
    targetSkillId: c.skillId,
    rootSkillId,
    severity: Math.max(0, Math.min(1, Number(severity.toFixed(3)))),
    rationale: rationale.join(' '),
    ruledOut: [...c.ruledOut],
    rootTrace: c.rootTrace,
    evidenceRefs: c.evidenceRefs,
  };
}

function daysAgo(days: number): string {
  const d = Math.round(days);
  if (d >= 30) return `khoảng ${Math.round(d / 7)} tuần trước`;
  return `${d} ngày trước`;
}
