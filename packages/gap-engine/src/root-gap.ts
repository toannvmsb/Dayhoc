import type { ChildLearningTwin, SkillId } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { GapConfig } from './config.js';

export interface RootGapTrace {
  readonly rootSkillId: SkillId;
  /** The prerequisite path walked from the target down to the root (target first). */
  readonly path: readonly SkillId[];
  /** True when the root is a *prerequisite* of the target, not the target itself. */
  readonly isPrerequisite: boolean;
  readonly weakPrerequisites: readonly SkillId[];
}

const masteryOf = (twin: ChildLearningTwin, id: SkillId): number =>
  twin.skillMastery.get(id)?.mastery ?? 0;

const hasEvidence = (twin: ChildLearningTwin, id: SkillId): boolean =>
  (twin.skillMastery.get(id)?.evidenceCount ?? 0) > 0;

/**
 * Trace the root of a failure back through the prerequisite DAG (Math Core §20).
 *
 * "Never infer weak algebra from failure on an HSG problem." We only walk into a
 * prerequisite when there is *evidence* it is weak — an unobserved prerequisite is
 * a hypothesis for a diagnostic item, not a confirmed root. The root is the
 * deepest weak prerequisite whose own prerequisites are all fine.
 */
export function traceRootGap(
  targetSkillId: SkillId,
  twin: ChildLearningTwin,
  kb: KnowledgeBase,
  config: GapConfig,
): RootGapTrace {
  const weakAll: SkillId[] = [];
  const path: SkillId[] = [targetSkillId];
  const visited = new Set<SkillId>([targetSkillId]);

  let current = targetSkillId;
  // Walk down: at each level pick the weakest observed, sufficiently-important prerequisite.
  for (let guard = 0; guard < 32; guard++) {
    const prereqEdges = kb.prerequisites.filter((e) => e.to === current);
    const weakHere = prereqEdges
      .filter(
        (e) =>
          e.importance >= config.blockingImportance &&
          hasEvidence(twin, e.from) &&
          masteryOf(twin, e.from) < config.weakPrerequisite &&
          !visited.has(e.from),
      )
      .sort((a, b) => masteryOf(twin, a.from) - masteryOf(twin, b.from));

    if (weakHere.length === 0) break;
    for (const e of weakHere) weakAll.push(e.from);

    const next = weakHere[0]!.from;
    visited.add(next);
    path.push(next);
    current = next;
  }

  const rootSkillId = path[path.length - 1]!;
  return {
    rootSkillId,
    path,
    isPrerequisite: rootSkillId !== targetSkillId,
    weakPrerequisites: [...new Set(weakAll)],
  };
}
