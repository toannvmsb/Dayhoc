import {
  asChildId,
  asProblemTypeId,
  asSkillId,
  type ChildId,
  type Evidence,
  type GradeContext,
} from '@copilot/domain';
import { loadKnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from '@copilot/learning-twin';
import { runGapEngine, type GapEngineResult } from '@copilot/gap-engine';

export const KB = loadKnowledgeBase();

/** Compact spec for one observation in a golden scenario. */
export interface EvidenceSpec {
  readonly skillId: string;
  readonly daysAgo: number;
  readonly correct?: boolean;
  readonly score?: number;
  readonly hintDependency?: number;
  readonly reasoningQuality?: Evidence['reasoningQuality'];
  readonly problemTypeId?: string;
  readonly confidenceTier?: Evidence['confidenceTier'];
  readonly source?: Evidence['source'];
  readonly provenance?: Evidence['provenance'];
}

export function buildEvidence(
  childId: ChildId,
  specs: readonly EvidenceSpec[],
  asOf: Date,
): Evidence[] {
  return specs.map((s, i) => {
    const occurredAt = new Date(asOf.getTime() - s.daysAgo * 86_400_000).toISOString();
    return {
      id: `ev_${String(i + 1).padStart(4, '0')}` as Evidence['id'],
      childId,
      source: s.source ?? 'app_practice',
      occurredAt,
      recordedAt: occurredAt,
      skillId: asSkillId(s.skillId),
      ...(s.problemTypeId ? { problemTypeId: asProblemTypeId(s.problemTypeId) } : {}),
      result: {
        ...(s.correct !== undefined ? { correct: s.correct } : {}),
        ...(s.score !== undefined ? { score: s.score } : {}),
      },
      ...(s.reasoningQuality ? { reasoningQuality: s.reasoningQuality } : {}),
      ...(s.hintDependency !== undefined ? { hintDependency: s.hintDependency } : {}),
      confidenceTier: s.confidenceTier ?? 'B',
      provenance: s.provenance ?? 'manual',
    };
  });
}

export interface GoldenScenario {
  readonly id: string;
  readonly description: string;
  readonly gradeContext: GradeContext;
  readonly parentGoal?: string;
  readonly asOf?: string;
  readonly evidence: readonly EvidenceSpec[];
}

export interface GoldenRun {
  readonly twin: ReturnType<typeof buildLearningTwin>;
  readonly engine: GapEngineResult;
  readonly topGap: GapEngineResult['gaps'][number] | undefined;
}

/** Chain the deterministic pipeline exactly as production would: evidence → twin → gaps. */
export function runScenario(scenario: GoldenScenario): GoldenRun {
  const childId = asChildId(`child_${scenario.id}`);
  const asOf = new Date(scenario.asOf ?? '2026-08-31T09:00:00Z');
  const evidence = buildEvidence(childId, scenario.evidence, asOf);

  const twin = buildLearningTwin({
    childId,
    gradeContext: scenario.gradeContext,
    evidence,
    knowledgeBase: KB,
    asOf,
  });
  const engine = runGapEngine({
    childId,
    gradeContext: scenario.gradeContext,
    twin,
    evidence,
    knowledgeBase: KB,
    ...(scenario.parentGoal ? { parentGoal: scenario.parentGoal } : {}),
    asOf,
  });

  return { twin, engine, topGap: engine.gaps[0] };
}
