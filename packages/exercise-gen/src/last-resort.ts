import type { GeneratedItemContent, ItemGenerationSpec, MathKernel, ProblemDNA } from '@copilot/domain';
import { MATH_KERNEL_GROUP } from '@copilot/domain';
import { buildContentFromKernel } from './kernel-templater.js';
import { checkItemSimilarity } from './similarity-gate.js';

/**
 * Deterministic last-resort generator (doc 63 §4). Completes the FINAL
 * unresolved slot of a worksheet when no model could — but ONLY for a
 * MathKernel-supported Group A item. It uses the kernel's exact numbers /
 * operation graph / expected answer with a scenario TEMPLATE (rotated to dodge
 * within-worksheet collisions). It never copies reference wording.
 *
 * It is a RELIABILITY FALLBACK, not a generation source.
 */

export const LAST_RESORT_VERSION = 'last-resort.v1';

export type LastResortResult =
  | { readonly ok: true; readonly content: GeneratedItemContent; readonly variant: number }
  | { readonly ok: false; readonly reason: string };

export interface LastResortInput {
  readonly itemSpec: ItemGenerationSpec;
  readonly kernel: MathKernel | null;
  readonly dna: ProblemDNA;
  /** prompts of the already-accepted sibling slots — for the uniqueness check. */
  readonly siblingPrompts: readonly string[];
  /** reference prompts for the skill — for the leakage check. */
  readonly referencePrompts?: readonly string[];
}

export function deterministicLastResort(input: LastResortInput): LastResortResult {
  const { kernel, dna } = input;
  if (!kernel) return { ok: false, reason: 'no MathKernel — cannot safely template this item' };
  if (MATH_KERNEL_GROUP[kernel.family] !== 'A') {
    return { ok: false, reason: `kernel family ${kernel.family} is Group ${MATH_KERNEL_GROUP[kernel.family]}, not deterministically templatable` };
  }
  const siblings = input.siblingPrompts.map((p, i) => ({ id: `sib-${i}`, prompt: p }));
  const references = (input.referencePrompts ?? []).map((p, i) => ({ id: `ref-${i}`, prompt: p }));

  // rotate the scenario variant until the templated prompt is unique in the worksheet
  for (let variant = 0; variant < 24; variant += 1) {
    const content = buildContentFromKernel(dna, variant);
    const sim = checkItemSimilarity({
      prompt: content.prompt,
      references,
      worksheetSiblings: siblings,
    });
    if (sim.verdict === 'PASS') return { ok: true, content, variant };
  }
  return { ok: false, reason: 'could not find a collision-free scenario variant in 24 tries' };
}
