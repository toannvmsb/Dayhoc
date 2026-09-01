import {
  KNOWLEDGE_LEVELS,
  THINKING_LEVELS,
  asProblemTypeId,
  type ChildLearningTwin,
  type ExerciseDistribution,
  type GradeContext,
  type ParentGoal,
  type ProblemTypeId,
  type SkillId,
  type TargetRole,
  type TargetSkill,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapEngineResult } from '@copilot/gap-engine';

export const TARGET_SELECTOR_VERSION = 'target-selector.v1';

/** K a CURRENT/THINKING target stays at or below (grade-level knowledge). */
const GRADE_K_CEILING = 'K3';
/** A frontier is only trusted for above-grade KNOWLEDGE at/above this confidence. */
const FRONTIER_CONFIDENCE_MIN = 0.3;
/** At/above this confidence the frontier may reach competition knowledge (K5). */
const FRONTIER_CONFIDENCE_STRONG = 0.55;
const tIdx = (t: ThinkingLevel): number => THINKING_LEVELS.indexOf(t);

export interface SelectTargetsInput {
  readonly resolvedLessonId: string | null;
  /** Fallback when the resolved lesson maps to no skills. */
  readonly activeSkillIds: readonly SkillId[];
  readonly gradeContext: GradeContext;
  readonly twin: ChildLearningTwin;
  readonly gaps: GapEngineResult;
  readonly knowledgeBase: KnowledgeBase;
  readonly parentGoal: ParentGoal;
  readonly readiness: 'ready' | 'parallel_repair' | 'repair_first';
}

export interface LearningTargets {
  readonly current: readonly TargetSkill[];
  readonly prerequisiteRepair: readonly TargetSkill[];
  readonly frontier: readonly TargetSkill[];
  readonly thinking: readonly TargetSkill[];
  readonly problemTypeIds: readonly ProblemTypeId[];
  /** Deduped union — goes into `spec.targets.skills`. */
  readonly all: readonly TargetSkill[];
}

/**
 * selectLearningTargets (doc 14 C4.1 §3) — DETERMINISTIC. The AI never
 * participates. It picks, by role:
 *   CURRENT             — the resolved lesson's skills
 *   PREREQUISITE_REPAIR — the gap/readiness prerequisite skills in the way
 *   FRONTIER            — real above-grade skills the Actual Learning Frontier +
 *                         prerequisite readiness + blocking-gap state support
 *   THINKING            — grade-level skills that carry T4/T5 problem types
 * Parent Goal only affects HOW MANY frontier/thinking targets and their K
 * ceiling — never WHETHER above-grade knowledge is allowed (§4/§10).
 */
export function selectLearningTargets(input: SelectTargetsInput): LearningTargets {
  const { knowledgeBase: kb, gradeContext } = input;
  const goalIsAdvanced = input.parentGoal === 'phat_trien_tu_duy' || input.parentGoal === 'hsg_thi_chuyen';

  const known = (id: SkillId): boolean => kb.skills.has(id);
  const mk = (
    skillId: SkillId,
    role: TargetRole,
    buckets: readonly (keyof ExerciseDistribution)[],
    knowledgeCeiling: string,
  ): TargetSkill => {
    const s = kb.getSkill(skillId);
    return { skillId, role, domain: s.domain, curriculumOrigin: s.curriculumOrigin, buckets, knowledgeCeiling: knowledgeCeiling as TargetSkill['knowledgeCeiling'] };
  };

  // --- CURRENT (grade-level knowledge only; above-grade lesson skills are
  //     handled as FRONTIER candidates, never as "the current lesson") ---
  const lessonSkills = input.resolvedLessonId
    ? [...kb.skills.values()].filter((s) => s.curriculumNodeId === input.resolvedLessonId).map((s) => s.id as SkillId)
    : [];
  const rawCurrent = dedupe((lessonSkills.length > 0 ? lessonSkills : [...input.activeSkillIds]).filter(known));
  let currentIds = rawCurrent.filter((id) => kb.getSkill(id).curriculumOrigin <= gradeContext);
  if (currentIds.length === 0 && rawCurrent.length > 0) {
    // the whole lesson is above grade — keep only the least-advanced skill so the
    // session still has a grounded "current" anchor.
    currentIds = [[...rawCurrent].sort((a, b) => kb.getSkill(a).curriculumOrigin - kb.getSkill(b).curriculumOrigin)[0]!];
  }
  const current = currentIds.map((id) =>
    mk(id, 'CURRENT', ['currentSkill', 'variation', 'application'], GRADE_K_CEILING),
  );

  // --- PREREQUISITE_REPAIR ---
  const currentClosure = new Set<string>();
  for (const c of currentIds) for (const p of kb.prerequisiteClosure(c)) currentClosure.add(p);
  const repairIds = new Set<string>();
  const blockingGaps = new Set<string>();
  for (const g of input.gaps.gaps) {
    const sid = (g.rootSkillId ?? g.targetSkillId) as string;
    if (g.blocksCurrentLearning) blockingGaps.add(sid);
    const relevant = g.type === 'prerequisite_gap' || g.blocksCurrentLearning || currentClosure.has(sid);
    if (!relevant) continue;
    if (currentIds.includes(sid as SkillId) && g.type !== 'prerequisite_gap') continue;
    if (known(sid as SkillId)) repairIds.add(sid);
  }
  for (const r of input.gaps.readiness) {
    if (!currentIds.includes(r.targetSkillId)) continue;
    for (const wp of r.weakPrerequisites) {
      if (known(wp)) repairIds.add(wp);
      if (r.recommendation === 'repair_first') blockingGaps.add(wp);
    }
  }
  const prerequisiteRepair = [...repairIds].map((id) => mk(id as SkillId, 'PREREQUISITE_REPAIR', ['prerequisiteRepair'], 'K2'));

  // --- FRONTIER (evidence-driven; §4/§10) ---
  const frontier: TargetSkill[] = [];
  // a fallback CURRENT skill that is itself above grade is also a FRONTIER target
  // (so the validator accepts above-grade content the planner deliberately kept).
  for (const id of currentIds) {
    if (kb.getSkill(id).curriculumOrigin > gradeContext && input.readiness !== 'repair_first') {
      frontier.push(mk(id, 'FRONTIER', ['advanced'], 'K4'));
    }
  }
  if (input.readiness !== 'repair_first') {
    const maxFrontier = goalIsAdvanced ? 2 : input.parentGoal === 'kha_gioi' ? 1 : 1;
    for (const df of input.twin.frontier) {
      if (!df.aboveGrade || df.confidence < FRONTIER_CONFIDENCE_MIN) continue;
      const ceiling = df.confidence >= FRONTIER_CONFIDENCE_STRONG ? 'K5' : 'K4';
      const mastered = new Set(df.masteredSkillIds);
      const candidates = dedupe([...df.readyNextSkillIds, ...df.masteredSkillIds])
        .filter(known)
        .filter((id) => kb.getSkill(id).curriculumOrigin > gradeContext)
        .filter((id) => {
          // blocking gap ON the frontier path → reject this candidate (§5)
          if (kb.prerequisiteClosure(id).some((p) => blockingGaps.has(p))) return false;
          // an ALREADY-mastered skill has demonstrated its prereqs; a "ready next"
          // skill must have every in-domain direct prerequisite mastered (§4).
          if (mastered.has(id)) return true;
          return kb.directPrerequisites(id).every((p) => mastered.has(p) || !inDomain(kb, p, df.domain));
        })
        .sort((a, b) => kb.getSkill(b).curriculumOrigin - kb.getSkill(a).curriculumOrigin || a.localeCompare(b));
      for (const id of candidates.slice(0, maxFrontier)) {
        if (frontier.length >= maxFrontier) break;
        frontier.push(mk(id, 'FRONTIER', ['advanced'], ceiling));
      }
    }
  }

  // --- THINKING (T4/T5 on grade-level knowledge; §7) ---
  const strongThinking = assessThinking(input.twin.thinkingProfile).strongThinking;
  const thinking: TargetSkill[] = [];
  if (strongThinking || goalIsAdvanced) {
    for (const id of currentIds) {
      const hasHighT = kb.getProblemTypesForSkill(id).some((pt) => tIdx(pt.thinkingLevel) >= tIdx('T4'));
      if (hasHighT) thinking.push(mk(id, 'THINKING', ['thinkingChallenge'], GRADE_K_CEILING));
    }
  }

  // --- problem types across all roles ---
  const problemTypeIds = dedupe(
    [...current, ...frontier, ...thinking].flatMap((t) => kb.getProblemTypesForSkill(t.skillId).map((pt) => pt.id)),
  ).map(asProblemTypeId);

  const all = dedupeTargets([...current, ...prerequisiteRepair, ...frontier, ...thinking]);
  return { current, prerequisiteRepair, frontier, thinking, problemTypeIds, all };
}

/**
 * Demonstrated thinking level + whether the child has "strong thinking" evidence
 * (demonstrated ≥ T3 backed by more than one observation). Shared with
 * `deriveDifficulty` for the T range.
 */
export function assessThinking(
  thinkingProfile: ChildLearningTwin['thinkingProfile'],
): { demoMax: number; thinkingEvidence: number; strongThinking: boolean } {
  const dims = [...thinkingProfile.values()];
  const demoLevels = dims.map((s) => (s.demonstratedLevel ? tIdx(s.demonstratedLevel) : -1)).filter((i) => i >= 0);
  const demoMax = demoLevels.length > 0 ? Math.max(...demoLevels) : tIdx('T2');
  const thinkingEvidence = dims.reduce((n, s) => n + s.evidenceCount, 0);
  return { demoMax, thinkingEvidence, strongThinking: demoMax >= tIdx('T3') && thinkingEvidence >= 3 };
}

/** Grade-level K ceiling as an index into KNOWLEDGE_LEVELS. */
export const GRADE_K_CEILING_IDX = KNOWLEDGE_LEVELS.indexOf(GRADE_K_CEILING as never);

function inDomain(kb: KnowledgeBase, id: string, domain: string): boolean {
  return kb.skills.get(id as SkillId)?.domain === domain;
}
function dedupe<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}
function dedupeTargets(xs: readonly TargetSkill[]): TargetSkill[] {
  const seen = new Set<string>();
  const out: TargetSkill[] = [];
  for (const t of xs) {
    const key = `${t.skillId}:${t.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
