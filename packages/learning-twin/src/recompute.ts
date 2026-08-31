import type { ChildLearningTwin, Evidence, GradeContext } from '@copilot/domain';
import type { KnowledgeBase } from '@copilot/math-data';
import { buildLearningTwin } from './twin.js';
import type { MasteryConfig } from './config.js';

/**
 * Minimal read port — any evidence source that can hand back a child's stream.
 * `@copilot/evidence`'s `EvidenceService.history` satisfies this structurally.
 */
export interface EvidenceReader {
  history(childId: string): Promise<readonly Evidence[]>;
}

export interface RecomputeInput {
  readonly childId: string;
  readonly gradeContext: GradeContext;
  readonly evidenceReader: EvidenceReader;
  readonly knowledgeBase: KnowledgeBase;
  readonly asOf?: Date;
  readonly config?: MasteryConfig;
}

/**
 * The recompute "job": pull the full evidence stream and rebuild the twin from
 * scratch. Because the ledger is append-only and `buildLearningTwin` is pure,
 * running this twice over an unchanged ledger produces an identical twin
 * (idempotent recompute — Phase 3 acceptance).
 */
export async function recomputeTwin(input: RecomputeInput): Promise<ChildLearningTwin> {
  const evidence = await input.evidenceReader.history(input.childId);
  return buildLearningTwin({
    childId: input.childId as ChildLearningTwin['childId'],
    gradeContext: input.gradeContext,
    evidence,
    knowledgeBase: input.knowledgeBase,
    ...(input.asOf ? { asOf: input.asOf } : {}),
    ...(input.config ? { config: input.config } : {}),
  });
}
