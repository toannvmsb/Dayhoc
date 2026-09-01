import type {
  ExerciseDistribution,
  ExerciseValidationReasonCode,
  GeneratedExerciseBatch,
  SkillId,
} from '@copilot/domain';
import type { UsageProvider } from '@copilot/ai';
import type { GenerationGrounding } from './grounding.js';

/**
 * ExerciseGenerator (doc 14 C4 §E/§F) — an independent provider interface.
 *
 * The generator is EDUCATION-DUMB. It receives a `GenerationGrounding` (never a
 * child twin / PII) and must:
 *   "generate valid educational content satisfying this specification."
 * It MUST NOT decide skills, targets, problem types, K/T outside the range,
 * distribution, gap repair, advanced, parent goal, readiness or frontier. If it
 * cannot satisfy the grounding it returns a structured inability — never a
 * silently-altered spec.
 */
export interface ExerciseGenerator {
  readonly name: string;
  readonly provider: UsageProvider;
  readonly model: string;
  readonly modelVersion: string | null;
  /** The system-prompt version this generator sends (doc 14 C5 §14); `null` for the mock. */
  readonly promptVersion: string | null;
  generate(request: GenerationRequest): Promise<GenerationOutcome>;
}

export interface GenerationRequest {
  readonly grounding: GenerationGrounding;
  /**
   * When present, (re)generate only these slots instead of a full batch. Each
   * slot carries a DETERMINISTIC instruction derived from a validator finding
   * (never free-text piped straight from the validator — see `repair.ts`).
   */
  readonly regenerate?: readonly SlotRequest[];
}

export interface SlotRequest {
  readonly bucket: keyof ExerciseDistribution;
  readonly skillId: SkillId;
  readonly reasonCode: ExerciseValidationReasonCode | 'SHORTFALL';
  readonly instruction: string;
  /** Item ids being replaced (for the trace / logging). */
  readonly replaces: readonly string[];
}

/** Token usage a live provider call actually consumed (doc 14 C5 §15/§16). */
export interface GenerationUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens?: number;
  readonly outputTokens: number;
}

export type GenerationOutcome =
  | { readonly ok: true; readonly batch: GeneratedExerciseBatch; readonly latencyMs: number; readonly usage?: GenerationUsage }
  | { readonly ok: false; readonly inability: GenerationInability; readonly latencyMs: number; readonly usage?: GenerationUsage };

export interface GenerationInability {
  readonly reason:
    | 'insufficient_grounding'
    | 'cannot_satisfy_constraints'
    | 'provider_error'
    | 'refused';
  readonly detail: string;
  readonly unfilledBuckets?: Partial<Record<keyof ExerciseDistribution, number>>;
}
