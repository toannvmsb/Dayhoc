import type { ExerciseGenerationSpec } from '@copilot/domain';
import type { OrchestratorResult } from './orchestrator.js';

/**
 * Persistence contract for AI exercise generation (doc 14 C4 §L).
 * Tables `generation_specs` + `generated_exercise_sets` (migration
 * `1757030400000_generated_exercises.js`) — append-only. No consumer wires this
 * yet (C5); it exists so the runtime has a seam and the trace→row mapping is
 * tested.
 */

export interface GenerationSpecRecord {
  readonly id: string;
  readonly childId: string;
  readonly plannerVersion: string;
  readonly targetSelectorVersion: string;
  readonly curriculumRevision: string;
  readonly curriculumContentHash: string;
  readonly twinVersion: string;
  readonly gapSnapshotVersion: string;
  readonly schoolGrade: number;
  readonly parentGoal: string;
  readonly sessionGoal: string;
  readonly totalQuestions: number;
  readonly spec: ExerciseGenerationSpec;
  readonly createdAt: string;
}

export interface GeneratedExerciseSetRecord {
  readonly id: string;
  readonly generationSpecId: string;
  readonly groundingHash: string;
  readonly generatorName: string;
  readonly provider: string;
  readonly model: string;
  readonly modelVersion: string | null;
  readonly validatorVersion: string;
  readonly generationAttempts: number;
  readonly repairAttempts: number;
  readonly finalDisposition: string;
  readonly delivered: boolean;
  readonly items: unknown;
  readonly validation: unknown;
  readonly trace: unknown;
  readonly costEventRef: string | null;
  readonly createdAt: string;
}

export interface GenerationStore {
  putSpec(record: GenerationSpecRecord): Promise<void>;
  putExerciseSet(record: GeneratedExerciseSetRecord): Promise<void>;
  listExerciseSets(generationSpecId: string): Promise<readonly GeneratedExerciseSetRecord[]>;
}

export class InMemoryGenerationStore implements GenerationStore {
  readonly #specs = new Map<string, GenerationSpecRecord>();
  readonly #sets: GeneratedExerciseSetRecord[] = [];

  putSpec(record: GenerationSpecRecord): Promise<void> {
    if (this.#specs.has(record.id)) return Promise.reject(new Error(`spec ${record.id} already stored (append-only)`));
    this.#specs.set(record.id, record);
    return Promise.resolve();
  }

  putExerciseSet(record: GeneratedExerciseSetRecord): Promise<void> {
    if (!this.#specs.has(record.generationSpecId))
      return Promise.reject(new Error(`no stored spec ${record.generationSpecId} — set must trace back to a spec`));
    this.#sets.push(record);
    return Promise.resolve();
  }

  listExerciseSets(generationSpecId: string): Promise<readonly GeneratedExerciseSetRecord[]> {
    return Promise.resolve(this.#sets.filter((s) => s.generationSpecId === generationSpecId));
  }

  getSpec(id: string): GenerationSpecRecord | undefined {
    return this.#specs.get(id);
  }
}

/** Build the append-only rows for one orchestration run. */
export function toGenerationRecords(
  spec: ExerciseGenerationSpec,
  result: OrchestratorResult,
  opts: { setId: string; costEventRef?: string | null; now?: () => Date } = { setId: 'ges_1' },
): { specRecord: GenerationSpecRecord; setRecord: GeneratedExerciseSetRecord } {
  const now = (opts.now ?? (() => new Date()))().toISOString();
  const trace = result.trace;
  const validation = result.status === 'delivered' ? result.validation : result.lastValidation;
  return {
    specRecord: {
      id: spec.generationSpecId,
      childId: spec.childId,
      plannerVersion: spec.provenance.plannerVersion,
      targetSelectorVersion: spec.provenance.targetSelectorVersion,
      curriculumRevision: spec.provenance.curriculumRevision,
      curriculumContentHash: spec.provenance.curriculumContentHash,
      twinVersion: spec.provenance.twinVersion,
      gapSnapshotVersion: spec.provenance.gapSnapshotVersion,
      schoolGrade: spec.schoolGrade,
      parentGoal: spec.goal.parentGoal,
      sessionGoal: spec.goal.sessionGoal,
      totalQuestions: spec.generationPlan.totalQuestions,
      spec,
      createdAt: now,
    },
    setRecord: {
      id: opts.setId,
      generationSpecId: spec.generationSpecId,
      groundingHash: trace.groundingHash,
      generatorName: trace.generatorName,
      provider: trace.provider,
      model: trace.model,
      modelVersion: null,
      validatorVersion: trace.validatorVersion,
      generationAttempts: trace.generationAttempts,
      repairAttempts: trace.repairAttempts,
      finalDisposition: trace.finalDisposition,
      delivered: result.status === 'delivered',
      items: result.status === 'delivered' ? result.batch.items : [],
      validation: validation ?? null,
      trace,
      costEventRef: opts.costEventRef ?? null,
      createdAt: now,
    },
  };
}
