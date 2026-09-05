import type { GeneratedItemContent, ProblemDNA } from '@copilot/domain';
import type { UsageProvider } from '@copilot/ai';
import type { GenerationProviderMeta, GenerationUsage } from './generator.js';

/**
 * ItemContentGenerator (doc 56 §1/§2/§4) — generates CONTENT ONLY for 1–2
 * `ProblemDNA`s per call. It has NO educational authority: it never sees or sets
 * skillId, K, T, bucket, requiredSkillIds, origin, problem type, curriculum
 * node, frontier / prerequisite / verification decisions. Those are composed
 * back deterministically by `composeExercise`.
 */
export interface ItemContentGenerator {
  readonly name: string;
  readonly provider: UsageProvider;
  readonly model: string;
  readonly modelVersion: string | null;
  readonly promptVersion: string | null;
  generate(request: ItemGenerationRequest): Promise<ItemGenerationCallOutcome>;
}

export interface ItemGenerationRequest {
  /** 1 or 2 ProblemDNAs — never more (doc 56 §4). */
  readonly problemDNAs: readonly ProblemDNA[];
  /**
   * For a retry: itemId → deterministic instructions derived from the failed
   * acceptance gates (never validator free-text — doc 56 §11).
   */
  readonly retryInstructions?: Readonly<Record<string, readonly string[]>>;
}

export type ItemGenerationCallOutcome =
  | {
      readonly ok: true;
      /** One entry per requested DNA, matched by `itemId`. */
      readonly contents: readonly GeneratedItemContent[];
      readonly latencyMs: number;
      readonly usage?: GenerationUsage;
      readonly providerMeta?: GenerationProviderMeta;
    }
  | {
      readonly ok: false;
      readonly inability: string;
      readonly latencyMs: number;
      readonly usage?: GenerationUsage;
      readonly providerMeta?: GenerationProviderMeta;
    };
