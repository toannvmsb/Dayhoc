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
  type TargetSelectionReason,
  type TargetSkill,
  type ThinkingLevel,
} from '@copilot/domain';
import { isEligibleForCurrentLearningContext, type KnowledgeBase } from '@copilot/math-data';
import type { GapEngineResult } from '@copilot/gap-engine';

export const TARGET_SELECTOR_VERSION = 'target-selector.v2';

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

export interface FrontierCandidate {
  readonly skillId: SkillId;
  readonly origin: number;
  readonly kind: 'NEXT_SAFE' | 'MASTERED_STRETCH';
}
export interface RejectedCandidate {
  readonly skillId: SkillId;
  readonly origin: number;
  readonly reason: string;
}
export interface DomainFrontierSelection {
  readonly domain: string;
  /** Highest DEMONSTRATED curriculum origin in this domain. */
  readonly frontierEvidenceOrigin: number;
  readonly confidence: number;
  readonly candidates: readonly FrontierCandidate[];
  readonly rejected: readonly RejectedCandidate[];
  readonly selected: readonly SkillId[];
}
export interface TargetSelectionTrace {
  readonly selectorVersion: string;
  readonly resolvedLessonId: string | null;
  readonly resolvedLessonEligible: boolean;
  readonly domains: readonly DomainFrontierSelection[];
  readonly thinkingFallbackUsed: boolean;
}

export interface LearningTargets {
  readonly current: readonly TargetSkill[];
  readonly prerequisiteRepair: readonly TargetSkill[];
  readonly frontier: readonly TargetSkill[];
  readonly thinking: readonly TargetSkill[];
  readonly problemTypeIds: readonly ProblemTypeId[];
  /** Deduped union — goes into `spec.targets.skills`. */
  readonly all: readonly TargetSkill[];
  readonly trace: TargetSelectionTrace;
}

/**
 * selectLearningTargets (doc 14 C4.1 §3, C4.2 §4) — DETERMINISTIC. The AI never
 * participates.
 *
 *   CURRENT             — the resolved lesson's grade-level skills
 *   PREREQUISITE_REPAIR — the gap/readiness prerequisite skills in the way
 *   FRONTIER            — the NEXT SAFE above-grade target: a readyNext skill
 *                         (prereqs satisfied, no blocking gap on its path) is
 *                         preferred over a raw mastered-frontier stretch. So a
 *                         Grade-7 child with demonstrated Grade-9 capability may
 *                         correctly get a Grade-8 bridge target — explicitly, via
 *                         `selectionReason`.
 *   THINKING           — T4/T5 on a current grade-level skill; if none of the
 *                        current skills carries a T4/T5 problem type, a safe
 *                        adjacent grade-level skill may be used (fallback), else
 *                        no thinking target is fabricated.
 * Parent Goal only affects HOW MANY frontier/thinking targets and their K
 * ceiling — never WHETHER above-grade knowledge is allowed.
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
    selectionReason: TargetSelectionReason,
    selectionConfidence: number,
    frontierEvidenceOrigin?: number,
  ): TargetSkill => {
    const s = kb.getSkill(skillId);
    return {
      skillId,
      role,
      domain: s.domain,
      curriculumOrigin: s.curriculumOrigin,
      buckets,
      knowledgeCeiling: knowledgeCeiling as TargetSkill['knowledgeCeiling'],
      selectionReason,
      selectedCurriculumOrigin: s.curriculumOrigin,
      selectionConfidence: round3(selectionConfidence),
      ...(frontierEvidenceOrigin !== undefined ? { frontierEvidenceOrigin } : {}),
    };
  };

  const resolvedEligible = input.resolvedLessonId
    ? (() => {
        try {
          return isEligibleForCurrentLearningContext(kb.getCurriculumNode(input.resolvedLessonId));
        } catch {
          return false;
        }
      })()
    : false;

  // --- CURRENT (grade-level; an above-grade lesson skill is never "the current lesson") ---
  const lessonSkills = input.resolvedLessonId
    ? [...kb.skills.values()].filter((s) => s.curriculumNodeId === input.resolvedLessonId).map((s) => s.id as SkillId)
    : [];
  const rawCurrent = dedupe((lessonSkills.length > 0 ? lessonSkills : [...input.activeSkillIds]).filter(known));
  let currentIds = rawCurrent.filter((id) => kb.getSkill(id).curriculumOrigin <= gradeContext);
  if (currentIds.length === 0 && rawCurrent.length > 0) {
    currentIds = [[...rawCurrent].sort((a, b) => kb.getSkill(a).curriculumOrigin - kb.getSkill(b).curriculumOrigin)[0]!];
  }
  const currentMastery = (id: SkillId): number => input.twin.skillMastery.get(id)?.mastery ?? 0;
  const current = currentIds.map((id) =>
    mk(id, 'CURRENT', ['currentSkill', 'variation', 'application'], GRADE_K_CEILING, 'CURRENT_CURRICULUM', clamp01(currentMastery(id) / 100)),
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
  const prerequisiteRepair = [...repairIds].map((id) =>
    mk(id as SkillId, 'PREREQUISITE_REPAIR', ['prerequisiteRepair'], 'K2', 'GAP_REPAIR', 0.9),
  );

  // --- FRONTIER: the NEXT SAFE target (doc 14 C4.2 §4) ---
  const frontier: TargetSkill[] = [];
  const domainSelections: DomainFrontierSelection[] = [];
  const maxFrontier = goalIsAdvanced ? 2 : 1;

  // a fallback CURRENT skill that is itself above grade also needs a FRONTIER entry
  for (const id of currentIds) {
    const o = kb.getSkill(id).curriculumOrigin;
    if (o > gradeContext && input.readiness !== 'repair_first' && !frontier.some((f) => f.skillId === id)) {
      frontier.push(mk(id, 'FRONTIER', ['advanced'], 'K4', 'MASTERED_FRONTIER_STRETCH', 0.5, o));
    }
  }

  if (input.readiness !== 'repair_first') {
    for (const df of input.twin.frontier) {
      if (!df.aboveGrade) continue;
      const mastered = new Set(df.masteredSkillIds);
      const ceiling = df.confidence >= FRONTIER_CONFIDENCE_STRONG ? 'K5' : 'K4';
      const candidates: FrontierCandidate[] = [];
      const rejected: RejectedCandidate[] = [];

      const consider = (id: SkillId, kind: FrontierCandidate['kind']): void => {
        const o = kb.getSkill(id).curriculumOrigin;
        if (o <= gradeContext) {
          rejected.push({ skillId: id, origin: o, reason: 'not above grade' });
          return;
        }
        const blockedBy = kb.prerequisiteClosure(id).filter((p) => blockingGaps.has(p));
        if (blockedBy.length > 0) {
          rejected.push({ skillId: id, origin: o, reason: `blocking prerequisite gap on path: ${blockedBy.join(', ')}` });
          return;
        }
        if (kind === 'NEXT_SAFE' && !kb.directPrerequisites(id).every((p) => mastered.has(p) || !inDomain(kb, p, df.domain))) {
          rejected.push({ skillId: id, origin: o, reason: 'in-domain direct prerequisite not yet mastered' });
          return;
        }
        candidates.push({ skillId: id, origin: o, kind });
      };

      // 1. NEXT SAFE — unlocked next skills, nearest bridge first
      for (const id of dedupe([...df.readyNextSkillIds]).filter(known)) consider(id, 'NEXT_SAFE');
      // 2. MASTERED STRETCH — already-demonstrated above-grade skills, hardest first
      for (const id of dedupe([...df.masteredSkillIds]).filter(known)) {
        if (!candidates.some((c) => c.skillId === id)) consider(id, 'MASTERED_STRETCH');
      }

      const nextSafe = candidates.filter((c) => c.kind === 'NEXT_SAFE').sort((a, b) => a.origin - b.origin || a.skillId.localeCompare(b.skillId));
      const stretch = candidates.filter((c) => c.kind === 'MASTERED_STRETCH').sort((a, b) => b.origin - a.origin || a.skillId.localeCompare(b.skillId));

      const domainConfOk = df.confidence >= FRONTIER_CONFIDENCE_MIN;
      const selectedIds: SkillId[] = [];
      if (domainConfOk) {
        const ordered = [...nextSafe, ...stretch];
        for (const c of ordered) {
          if (frontier.length >= maxFrontier || selectedIds.length >= maxFrontier) break;
          if (frontier.some((f) => f.skillId === c.skillId)) continue;
          const reason: TargetSelectionReason = c.kind === 'NEXT_SAFE' ? 'NEXT_SAFE_FRONTIER' : 'MASTERED_FRONTIER_STRETCH';
          frontier.push(mk(c.skillId, 'FRONTIER', ['advanced'], ceiling, reason, df.confidence, df.reachedCurriculumOrigin));
          selectedIds.push(c.skillId);
        }
      } else {
        for (const c of candidates) rejected.push({ skillId: c.skillId, origin: c.origin, reason: `frontier confidence ${df.confidence.toFixed(2)} < ${FRONTIER_CONFIDENCE_MIN}` });
      }

      domainSelections.push({
        domain: df.domain,
        frontierEvidenceOrigin: df.reachedCurriculumOrigin,
        confidence: df.confidence,
        candidates,
        rejected,
        selected: selectedIds,
      });
    }
  }

  // --- THINKING (T4/T5; grade-level K) with a safe adjacent fallback (§6) ---
  const strongThinking = assessThinking(input.twin.thinkingProfile).strongThinking;
  const thinking: TargetSkill[] = [];
  let thinkingFallbackUsed = false;
  if (strongThinking || goalIsAdvanced) {
    const hasHighT = (id: SkillId): boolean =>
      kb.getProblemTypesForSkill(id).some((pt) => tIdx(pt.thinkingLevel) >= tIdx('T4'));
    const direct = currentIds.filter(hasHighT);
    if (direct.length > 0) {
      for (const id of direct) thinking.push(mk(id, 'THINKING', ['thinkingChallenge'], GRADE_K_CEILING, 'THINKING_STRETCH', 0.8));
    } else {
      // adjacent grade-level skill: same domain, origin ≤ grade, prereqs satisfied, has a T4/T5 PT
      const masteredAll = new Set<SkillId>();
      for (const [id, st] of input.twin.skillMastery) if (st.mastery >= 50) masteredAll.add(id);
      const adjacent = currentIds
        .flatMap((c) => [...kb.dependents(c), ...kb.directPrerequisites(c)])
        .filter((id) => known(id))
        .filter((id) => {
          const s = kb.getSkill(id);
          return (
            s.curriculumOrigin <= gradeContext &&
            currentIds.some((c) => kb.getSkill(c).domain === s.domain) &&
            hasHighT(id) &&
            kb.directPrerequisites(id).every((p) => masteredAll.has(p))
          );
        });
      const pick = dedupe(adjacent).sort((a, b) => a.localeCompare(b))[0];
      if (pick) {
        thinking.push(mk(pick, 'THINKING', ['thinkingChallenge'], GRADE_K_CEILING, 'THINKING_ADJACENT_FALLBACK', 0.6));
        thinkingFallbackUsed = true;
      }
      // else: no safe thinking target — do NOT fabricate one (§6)
    }
  }

  const problemTypeIds = dedupe(
    [...current, ...frontier, ...thinking].flatMap((t) => kb.getProblemTypesForSkill(t.skillId).map((pt) => pt.id)),
  ).map(asProblemTypeId);

  const all = dedupeTargets([...current, ...prerequisiteRepair, ...frontier, ...thinking]);
  return {
    current,
    prerequisiteRepair,
    frontier,
    thinking,
    problemTypeIds,
    all,
    trace: {
      selectorVersion: TARGET_SELECTOR_VERSION,
      resolvedLessonId: input.resolvedLessonId,
      resolvedLessonEligible: resolvedEligible,
      domains: domainSelections,
      thinkingFallbackUsed,
    },
  };
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
function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
