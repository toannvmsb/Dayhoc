import { createHash } from 'node:crypto';
import {
  DISTRIBUTION_BUCKETS,
  KNOWLEDGE_LEVEL_MEANING,
  KNOWLEDGE_LEVELS,
  THINKING_LEVEL_MEANING,
  THINKING_LEVELS,
  type ExerciseDistribution,
  type ExerciseGenerationSpec,
  type GradeContext,
  type KnowledgeLevel,
  type SkillId,
  type SpecConstraints,
  type SpecDifficulty,
  type SpecGenerationPlan,
  type TargetRole,
  type ThinkingLevel,
} from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ReferenceExample } from '@copilot/reference-library';

export const GROUNDING_SCHEMA_NAME = 'generatedExerciseBatch.v1' as const;
const GROUNDING_BUILDER_VERSION = 'grounding.v1';
const MAX_EXAMPLES_PER_SKILL = 3;

/**
 * The ONLY thing an `ExerciseGenerator` receives (doc 14 C4 §G/§H). It carries
 * no child name / parent name / school / raw twin / learning history — just the
 * educational contract, the relevant curriculum slice, K/T semantics, a few
 * grounding examples, and the output schema.
 */
export interface GenerationGrounding {
  readonly generationSpecId: string;
  readonly curriculumRevision: string;
  readonly curriculumContentHash: string;
  readonly schoolGrade: GradeContext;
  readonly language: 'vi';
  readonly plan: SpecGenerationPlan;
  readonly difficulty: SpecDifficulty;
  readonly constraints: SpecConstraints;
  readonly targetSkills: readonly GroundingSkill[];
  /**
   * Which skills + K ceiling each generation bucket may use (doc 14 C4.1 §6).
   * The generator NEVER maps a bucket to an arbitrary skill.
   */
  readonly bucketBindings: Readonly<Record<keyof ExerciseDistribution, BucketBinding>>;
  readonly knowledgeLevels: Readonly<Record<KnowledgeLevel, string>>;
  readonly thinkingLevels: Readonly<Record<ThinkingLevel, string>>;
  /** GROUNDING ONLY — never copy an example verbatim into a generated item. */
  readonly referenceExamples: readonly GroundingExample[];
  /**
   * Skills the generator MUST NOT list in `requiredSkillIds` for non-repair
   * items: blocking prerequisite gaps + unsupported above-grade knowledge.
   */
  readonly forbiddenRequiredSkillIds: readonly SkillId[];
  readonly outputSchemaName: typeof GROUNDING_SCHEMA_NAME;
  readonly builderVersion: string;
  /** Deterministic fingerprint of everything above — persisted for provenance. */
  readonly groundingHash: string;
}

export interface GroundingSkill {
  readonly skillId: SkillId;
  readonly role: TargetRole;
  readonly name: string;
  readonly domain: string;
  readonly curriculumNodeId: string;
  readonly curriculumOrigin: number;
  /** Highest K permitted for items on this skill. */
  readonly knowledgeCeiling: KnowledgeLevel;
  readonly problemTypes: readonly {
    readonly id: string;
    readonly name: string;
    readonly knowledgeLevel: KnowledgeLevel;
    readonly thinkingLevel: ThinkingLevel;
  }[];
  /** Prerequisites the child has — safe to build on. */
  readonly satisfiedPrerequisites: readonly SkillId[];
  /** Prerequisites that are weak/blocking — do not require unless this is a repair item. */
  readonly weakPrerequisites: readonly SkillId[];
}

export interface BucketBinding {
  readonly role: TargetRole;
  readonly skillIds: readonly SkillId[];
  readonly knowledgeCeiling: KnowledgeLevel;
  /** True for the FRONTIER bucket — items may use above-grade knowledge. */
  readonly allowAboveGradeKnowledge: boolean;
}

export interface GroundingExample {
  readonly skillId: SkillId;
  readonly problemTypeId?: string;
  readonly knowledgeLevel: KnowledgeLevel;
  readonly thinkingLevel: ThinkingLevel;
  readonly prompt: string;
  readonly answerFormat: string; // answerSpec.kind
  /** Hint-ladder length so the generator matches the format. */
  readonly hintRungs: number;
}

function stableHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

const BUCKET_DEFAULT_ROLE: Record<keyof ExerciseDistribution, TargetRole> = {
  prerequisiteRepair: 'PREREQUISITE_REPAIR',
  currentSkill: 'CURRENT',
  variation: 'CURRENT',
  application: 'CURRENT',
  advanced: 'FRONTIER',
  thinkingChallenge: 'THINKING',
};

function highestK(ks: readonly KnowledgeLevel[]): KnowledgeLevel {
  return ks.reduce((hi, k) => (KNOWLEDGE_LEVELS.indexOf(k) > KNOWLEDGE_LEVELS.indexOf(hi) ? k : hi), 'K0' as KnowledgeLevel);
}

/**
 * buildGenerationGrounding — deterministic. Pure function of (spec, reference
 * library, KB). Emits only the context the generator needs.
 */
export function buildGenerationGrounding(
  spec: ExerciseGenerationSpec,
  referenceLibrary: readonly ReferenceExample[],
  kb: KnowledgeBase,
): GenerationGrounding {
  const weakSet = new Set(spec.childState.prerequisiteGaps.map((g) => g.skillId as string));
  const blockingSet = new Set(
    spec.childState.prerequisiteGaps.filter((g) => g.blocking).map((g) => g.skillId as string),
  );
  const masteredSet = new Set(
    Object.entries(spec.childState.relevantMastery)
      .filter(([, m]) => m >= 50)
      .map(([id]) => id),
  );
  const anySelected = new Set(spec.targets.skills.map((t) => t.skillId));

  const targetSkills: GroundingSkill[] = spec.targets.skills
    .filter((t) => kb.skills.has(t.skillId))
    .map((t): GroundingSkill => {
      const s = kb.getSkill(t.skillId);
      const prereqs = kb.prerequisiteClosure(t.skillId);
      return {
        skillId: t.skillId,
        role: t.role,
        name: s.name,
        domain: s.domain,
        curriculumNodeId: s.curriculumNodeId,
        curriculumOrigin: s.curriculumOrigin,
        knowledgeCeiling: t.knowledgeCeiling,
        problemTypes: kb.getProblemTypesForSkill(t.skillId).map((pt) => ({
          id: pt.id,
          name: pt.name,
          knowledgeLevel: pt.knowledgeLevel,
          thinkingLevel: pt.thinkingLevel,
        })),
        satisfiedPrerequisites: prereqs.filter((p) => masteredSet.has(p) && !weakSet.has(p)),
        weakPrerequisites: prereqs.filter((p) => weakSet.has(p)),
      };
    });

  // bucket → target binding (doc 14 C4.1 §6) — the generator MUST honour this
  const bucketBindings = {} as Record<keyof ExerciseDistribution, BucketBinding>;
  for (const bucket of DISTRIBUTION_BUCKETS) {
    const matched = spec.targets.skills.filter((t) => t.buckets.includes(bucket));
    const role: TargetRole = matched[0]?.role ?? BUCKET_DEFAULT_ROLE[bucket];
    bucketBindings[bucket] = {
      role,
      skillIds: matched.map((t) => t.skillId),
      knowledgeCeiling: matched.length > 0 ? highestK(matched.map((t) => t.knowledgeCeiling)) : 'K2',
      allowAboveGradeKnowledge: role === 'FRONTIER',
    };
  }

  // forbidden as a REQUIRED skill: blocking gaps + any above-grade skill the
  // planner selected NO target for. A selected PREREQUISITE_REPAIR / THINKING
  // target that happens to be above grade is fine — the planner chose it.
  const forbidden = new Set<string>(blockingSet);
  for (const s of kb.skills.values()) {
    if (s.curriculumOrigin > spec.schoolGrade && !anySelected.has(s.id as SkillId)) forbidden.add(s.id);
  }

  const kAnchor = KNOWLEDGE_LEVELS.indexOf(spec.difficulty.kMax);
  const tAnchor = THINKING_LEVELS.indexOf(spec.difficulty.tMax);
  const referenceExamples: GroundingExample[] = spec.targets.skillIds.flatMap((skillId) =>
    referenceLibrary
      .filter((ex) => ex.skillId === skillId)
      .map((ex) => ({
        ex,
        score:
          Math.abs(KNOWLEDGE_LEVELS.indexOf(ex.knowledgeLevel) - kAnchor) +
          Math.abs(THINKING_LEVELS.indexOf(ex.thinkingLevel) - tAnchor),
      }))
      .sort((a, b) => a.score - b.score || a.ex.id.localeCompare(b.ex.id))
      .slice(0, MAX_EXAMPLES_PER_SKILL)
      .map(({ ex }) => ({
        skillId: ex.skillId,
        ...(ex.problemTypeId ? { problemTypeId: ex.problemTypeId } : {}),
        knowledgeLevel: ex.knowledgeLevel,
        thinkingLevel: ex.thinkingLevel,
        prompt: ex.prompt,
        answerFormat: ex.answerSpec.kind,
        hintRungs: ex.hints.length,
      })),
  );

  const body = {
    generationSpecId: spec.generationSpecId,
    curriculumRevision: spec.provenance.curriculumRevision,
    curriculumContentHash: spec.provenance.curriculumContentHash,
    schoolGrade: spec.schoolGrade,
    language: spec.constraints.language,
    plan: spec.generationPlan,
    difficulty: spec.difficulty,
    constraints: spec.constraints,
    targetSkills,
    bucketBindings,
    knowledgeLevels: KNOWLEDGE_LEVEL_MEANING,
    thinkingLevels: THINKING_LEVEL_MEANING,
    referenceExamples,
    forbiddenRequiredSkillIds: [...forbidden].sort() as SkillId[],
    outputSchemaName: GROUNDING_SCHEMA_NAME,
    builderVersion: GROUNDING_BUILDER_VERSION,
  } as const;

  return { ...body, groundingHash: stableHash(body) };
}

/** Buckets that still need items, from a spec's plan. */
export function bucketsToFill(plan: SpecGenerationPlan): Array<[keyof ExerciseDistribution, number]> {
  return Object.entries(plan.distribution).filter(([, n]) => n > 0) as Array<
    [keyof ExerciseDistribution, number]
  >;
}
