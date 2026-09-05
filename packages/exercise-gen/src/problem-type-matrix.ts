import {
  asSkillId,
  MATH_KERNEL_GROUP,
  type ExerciseGenerationSpec,
  type MathKernelFamily,
} from '@copilot/domain';
import type { KnowledgeBase, ProblemType } from '@copilot/math-data';
import { buildItemGenerationSpecs } from './item-spec.js';
import { resolveMathFamily } from './math-kernel.js';

export const PROBLEM_TYPE_MATRIX_VERSION = 'problem-type-matrix.v1';

export type ProblemTypeGroup = 'A' | 'B' | 'C';

export interface ProblemTypeClassification {
  readonly problemTypeId: string;
  readonly skillId: string;
  readonly name: string;
  readonly knowledgeLevel: string;
  readonly thinkingLevel: string;
  /** The MathKernel family that would cover an item of this type, or null. */
  readonly kernelFamily: MathKernelFamily | null;
  readonly kernelSupport: boolean;
  readonly deterministicVerificationPossible: boolean;
  readonly crosscheckRequired: boolean;
  /** A — deterministic; B — semi-deterministic; C — open / reasoning. */
  readonly group: ProblemTypeGroup;
  readonly implementationStatus: 'implemented' | 'not_applicable';
}

/** Problem types whose thinking demand / name marks them as open reasoning. */
function isOpenReasoning(pt: ProblemType): boolean {
  return (
    pt.thinkingLevel === 'T5' ||
    /chứng minh|proof|tự đặt|tự xây dựng|create|lập luận|giải thích|phản ví dụ|HSG|nâng cao/i.test(pt.name)
  );
}

/**
 * classifyProblemTypes (doc 58 §9) — the matrix. For each KB problem type,
 * derive the kernel family a generated item of that type would resolve to (via
 * a synthetic ItemGenerationSpec-shaped probe) and its A/B/C group.
 */
export function classifyProblemTypes(kb: KnowledgeBase): ProblemTypeClassification[] {
  return kb.problemTypes.map((pt): ProblemTypeClassification => {
    const skill = kb.skills.get(asSkillId(pt.skillId));
    // a minimal probe — resolveMathFamily only reads these fields
    const probe = {
      skillId: pt.skillId,
      problemTypeId: pt.id,
      domain: skill?.domain ?? 'arithmetic',
      knowledgeLevel: pt.knowledgeLevel,
      answerKind: /góc (nhọn|tù|bẹt|vuông)/i.test(skill?.name ?? '')
        ? ('choice' as const)
        : skill?.domain === 'fractions'
          ? ('fraction' as const)
          : ('numeric' as const),
      problemStructure: isOpenReasoning(pt) ? ('explain_or_justify' as const) : ('direct_computation' as const),
    };
    const family = isOpenReasoning(pt)
      ? null
      : resolveMathFamily(probe as unknown as Parameters<typeof resolveMathFamily>[0], kb);
    const group: ProblemTypeGroup = family ? MATH_KERNEL_GROUP[family] : 'C';
    return {
      problemTypeId: pt.id,
      skillId: pt.skillId,
      name: pt.name,
      knowledgeLevel: pt.knowledgeLevel,
      thinkingLevel: pt.thinkingLevel,
      kernelFamily: family,
      kernelSupport: family !== null,
      deterministicVerificationPossible: family !== null,
      crosscheckRequired: family === null,
      group,
      implementationStatus: family !== null ? 'implemented' : 'not_applicable',
    };
  });
}

export interface SpecCoverage {
  readonly totalItems: number;
  readonly kernelCovered: number;
  readonly kernelCoverageRate: number;
  readonly byFamily: Readonly<Record<string, number>>;
  /** items with no kernel — grouped by why. */
  readonly uncovered: readonly { readonly skillId: string; readonly structure: string; readonly answerKind: string }[];
  readonly reasoningItems: number;
}

/**
 * coverageOverSpecs (doc 58 §9/§10) — run `buildItemGenerationSpecs` on each
 * benchmark spec and count how many slots a MathKernel family covers.
 */
export function coverageOverSpecs(
  specs: readonly ExerciseGenerationSpec[],
  kb: KnowledgeBase,
): SpecCoverage {
  let total = 0;
  let covered = 0;
  let reasoning = 0;
  const byFamily: Record<string, number> = {};
  const uncovered: { skillId: string; structure: string; answerKind: string }[] = [];

  for (const spec of specs) {
    for (const is of buildItemGenerationSpecs(spec, kb)) {
      total += 1;
      if (is.answerKind === 'reasoning') reasoning += 1;
      const family = resolveMathFamily(is, kb);
      if (family) {
        covered += 1;
        byFamily[family] = (byFamily[family] ?? 0) + 1;
      } else {
        uncovered.push({ skillId: is.skillId, structure: is.problemStructure, answerKind: is.answerKind });
      }
    }
  }
  return {
    totalItems: total,
    kernelCovered: covered,
    kernelCoverageRate: total > 0 ? covered / total : 0,
    byFamily,
    uncovered,
    reasoningItems: reasoning,
  };
}
