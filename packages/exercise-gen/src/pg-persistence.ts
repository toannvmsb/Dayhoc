import type { Pool } from 'pg';
import type { ExerciseGenerationSpec } from '@copilot/domain';
import type { GeneratedExerciseSetRecord, GenerationSpecRecord, GenerationStore } from './persistence.js';

/**
 * PostgreSQL backend for `generation_specs` / `generated_exercise_sets` (doc 14
 * C5 §13; tables from migration `1757030400000_generated_exercises.js` +
 * `1757116800000_cost_actuals_and_target_provenance.js`). INSERT-only — the
 * tables carry `reject_ledger_mutation` triggers on UPDATE/DELETE regardless of
 * caller, same pattern as `PgLedgerStore`.
 */
export class PgGenerationStore implements GenerationStore {
  constructor(private readonly pool: Pool) {}

  async putSpec(r: GenerationSpecRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO generation_specs
         (id, child_id, planner_version, target_selector_version, curriculum_revision,
          curriculum_content_hash, twin_version, gap_snapshot_version, school_grade,
          parent_goal, session_goal, total_questions, spec, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        r.id,
        r.childId,
        r.plannerVersion,
        r.targetSelectorVersion,
        r.curriculumRevision,
        r.curriculumContentHash,
        r.twinVersion,
        r.gapSnapshotVersion,
        r.schoolGrade,
        r.parentGoal,
        r.sessionGoal,
        r.totalQuestions,
        JSON.stringify(r.spec),
        r.createdAt,
      ],
    );
  }

  async putExerciseSet(r: GeneratedExerciseSetRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO generated_exercise_sets
         (id, generation_spec_id, grounding_hash, generator_name, provider, model,
          model_version, validator_version, generation_attempts, repair_attempts,
          final_disposition, delivered, items, validation, trace, cost_event_ref, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        r.id,
        r.generationSpecId,
        r.groundingHash,
        r.generatorName,
        r.provider,
        r.model,
        r.modelVersion,
        r.validatorVersion,
        r.generationAttempts,
        r.repairAttempts,
        r.finalDisposition,
        r.delivered,
        JSON.stringify(r.items),
        JSON.stringify(r.validation),
        JSON.stringify(r.trace),
        r.costEventRef,
        r.createdAt,
      ],
    );
  }

  async listExerciseSets(generationSpecId: string): Promise<readonly GeneratedExerciseSetRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM generated_exercise_sets WHERE generation_spec_id = $1 ORDER BY created_at ASC`,
      [generationSpecId],
    );
    return rows.map(rowToSetRecord);
  }

  async getSpec(id: string): Promise<GenerationSpecRecord | undefined> {
    const { rows } = await this.pool.query(`SELECT * FROM generation_specs WHERE id = $1`, [id]);
    const row = rows[0] as Record<string, unknown> | undefined;
    return row ? rowToSpecRecord(row) : undefined;
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any -- pg returns untyped rows; narrowed here. */
function rowToSpecRecord(row: any): GenerationSpecRecord {
  return {
    id: row.id,
    childId: row.child_id,
    plannerVersion: row.planner_version,
    targetSelectorVersion: row.target_selector_version,
    curriculumRevision: row.curriculum_revision,
    curriculumContentHash: row.curriculum_content_hash,
    twinVersion: row.twin_version,
    gapSnapshotVersion: row.gap_snapshot_version,
    schoolGrade: Number(row.school_grade),
    parentGoal: row.parent_goal,
    sessionGoal: row.session_goal,
    totalQuestions: Number(row.total_questions),
    spec: (typeof row.spec === 'string' ? JSON.parse(row.spec) : row.spec) as ExerciseGenerationSpec,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function rowToSetRecord(row: any): GeneratedExerciseSetRecord {
  const parseJson = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
  return {
    id: row.id,
    generationSpecId: row.generation_spec_id,
    groundingHash: row.grounding_hash,
    generatorName: row.generator_name,
    provider: row.provider,
    model: row.model,
    modelVersion: row.model_version ?? null,
    validatorVersion: row.validator_version,
    generationAttempts: Number(row.generation_attempts),
    repairAttempts: Number(row.repair_attempts),
    finalDisposition: row.final_disposition,
    delivered: row.delivered,
    items: parseJson(row.items),
    validation: parseJson(row.validation),
    trace: parseJson(row.trace),
    costEventRef: row.cost_event_ref ?? null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
