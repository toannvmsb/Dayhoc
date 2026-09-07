import type { ItemGenerationSpec, MathKernel, ProblemDNA } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import type { ReferenceExample } from '@copilot/reference-library';
import { answerKindFor, pickProblemType, verificationPolicyFor } from './item-spec.js';
import { generateMathKernel } from './math-kernel.js';
import { buildProblemDNA } from './problem-dna.js';

export const SUBSTITUTE_BUILDER_VERSION = 'safe-substitute.v1';

export interface SubstituteResult {
  readonly itemSpec: ItemGenerationSpec;
  readonly kernel: MathKernel | null;
  readonly dna: ProblemDNA;
  /** true only when the substitute is deterministically kernel-backed. */
  readonly kernelBacked: boolean;
}

/**
 * SAFE SUBSTITUTE (doc 68 §5). Rebuild ONE REQUIRED_CORE slot inside its
 * planner-authoritative fallback envelope: the SAME skill, dropped to the
 * envelope's K/T floor and to a kernel-supported problem structure. Everything
 * else — requiredSkillIds, curriculum-safety facts, supporting skills — is
 * carried over verbatim from the original item spec, so the substitute stays
 * curriculum- and prerequisite-safe and still practises the intended skill.
 *
 * AI never lowers K/T: the floor comes from `itemSpec.fallback`, which the
 * deterministic planner set.
 */
export function buildSafeSubstitute(
  original: ItemGenerationSpec,
  kb: KnowledgeBase,
  referenceLibrary: readonly ReferenceExample[],
  usedNumberTuples: readonly (readonly number[])[],
): SubstituteResult | null {
  const env = original.fallback;
  if (!env) return null;

  const skill = kb.skills.get(env.preserveSkillId);
  const structure = env.allowedProblemStructures[0] ?? 'direct_computation';
  const answerKind = answerKindFor(structure, original.domain, skill?.name ?? '');

  const subSpec: ItemGenerationSpec = {
    ...original,
    knowledgeLevel: env.minKnowledgeLevel,
    thinkingLevel: env.minThinkingLevel,
    problemStructure: structure,
    answerKind,
    problemTypeId: pickProblemType(kb, env.preserveSkillId, env.minKnowledgeLevel, env.minThinkingLevel),
    answerVerificationPolicy: verificationPolicyFor(answerKind, structure),
  };

  const refs = referenceLibrary.filter((r) => r.skillId === subSpec.skillId);
  const refTuples = refs
    .map((r) => [...r.prompt.matchAll(/\d+/g)].map((m) => Number(m[0])))
    .filter((t) => t.length > 0);
  const kres = generateMathKernel(subSpec, kb, {
    forbiddenNumberTuples: refTuples,
    recentNumberTuples: usedNumberTuples,
  });
  const kernel = kres.ok ? kres.kernel : null;
  const dna = buildProblemDNA(subSpec, kb, refs, { mathKernel: kernel });

  return { itemSpec: subSpec, kernel, dna, kernelBacked: kernel !== null };
}
