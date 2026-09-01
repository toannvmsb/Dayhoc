/* eslint-disable */
/**
 * AI exercise generation persistence (doc 14 C4 §L).
 *
 * NO live provider yet — the Mock generator writes here in tests / demo. Every
 * generated set traces back to its `ExerciseGenerationSpec` (spec payload +
 * revision + content hash) and records the grounding hash, generator + validator
 * versions, attempt counts and the final disposition. `cost_event_ref` is
 * nullable (filled once a live provider + AICostLedger row exists).
 *
 * `generation_specs` and `generated_exercise_sets` are append-only (⊕) — a new
 * generation attempt writes a new row, never mutates an old one.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const rejectMutation = (pgm, table) => {
  pgm.sql(`
    CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
  `);
};

exports.up = (pgm) => {
  pgm.createTable('generation_specs', {
    id: { type: 'text', primaryKey: true }, // ExerciseGenerationSpec.generationSpecId
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    planner_version: { type: 'text', notNull: true },
    curriculum_revision: { type: 'text', notNull: true },
    curriculum_content_hash: { type: 'text', notNull: true },
    twin_version: { type: 'text', notNull: true },
    gap_snapshot_version: { type: 'text', notNull: true },
    school_grade: { type: 'integer', notNull: true },
    parent_goal: { type: 'text', notNull: true },
    session_goal: { type: 'text', notNull: true },
    total_questions: { type: 'integer', notNull: true },
    spec: { type: 'jsonb', notNull: true }, // the full ExerciseGenerationSpec payload
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('generation_specs', 'child_id');
  pgm.createIndex('generation_specs', 'curriculum_content_hash');
  rejectMutation(pgm, 'generation_specs');

  pgm.createTable('generated_exercise_sets', {
    id: { type: 'text', primaryKey: true },
    generation_spec_id: { type: 'text', notNull: true, references: 'generation_specs', onDelete: 'CASCADE' },
    grounding_hash: { type: 'text', notNull: true },
    generator_name: { type: 'text', notNull: true },
    provider: { type: 'text', notNull: true }, // 'mock' until a live provider lands
    model: { type: 'text', notNull: true },
    model_version: { type: 'text' },
    validator_version: { type: 'text', notNull: true },
    generation_attempts: { type: 'integer', notNull: true },
    repair_attempts: { type: 'integer', notNull: true },
    final_disposition: {
      type: 'text',
      notNull: true,
      check: "final_disposition IN ('DELIVER','REPAIR','REGENERATE_SLOTS','QUARANTINE','GENERATOR_INABILITY')",
    },
    delivered: { type: 'boolean', notNull: true },
    items: { type: 'jsonb', notNull: true }, // the validated GeneratedExercise[]
    validation: { type: 'jsonb', notNull: true }, // BatchValidationResult (findings, reasonCodes, ...)
    trace: { type: 'jsonb', notNull: true }, // GenerationTrace (operations, attempts, ...)
    cost_event_ref: { type: 'text' }, // ai_usage_events.request_id — nullable until a live provider
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('generated_exercise_sets', 'generation_spec_id');
  pgm.createIndex('generated_exercise_sets', 'final_disposition');
  rejectMutation(pgm, 'generated_exercise_sets');
};

exports.down = (pgm) => {
  pgm.dropTable('generated_exercise_sets');
  pgm.dropTable('generation_specs');
};
