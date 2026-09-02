/* eslint-disable */
/**
 * IX / F1 — Learning-state persistence (additive, reversible — docs 04 §4/§5,
 * doc 23 §3).
 *
 * The Learning Twin / gaps / plan are **derived, recomputable** state — the
 * append-only `evidence` stream is the source of truth. These tables PERSIST the
 * latest computed state so the product does not recompute the whole pipeline on
 * every request, and so `child_id` is the durable owner of learning state.
 *
 *   - Derived (replace-on-recompute): `skill_states`, `problem_type_mastery`,
 *     `thinking_state`, `knowledge_gaps`, `gap_prescriptions`, `learning_plans`,
 *     `plan_items`, `learning_state_snapshots`. Each carries
 *     `computed_from_evidence_count` + a version so a stale snapshot is detectable.
 *   - Genuine student work (append-only): `assignments`, `assignment_items`,
 *     `attempts`, `attempt_answers` — these feed BACK into `evidence`.
 *
 * child_id is the stable owner. Nothing here is treated as irreplaceable — a
 * full rebuild from `evidence` overwrites every derived row.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const VERIFICATION_LEVELS =
  "('FORMAT_VERIFIED','DETERMINISTIC_CORRECTNESS_VERIFIED','AI_CROSSCHECK_REQUIRED'," +
  "'AI_CROSSCHECK_PASSED','AI_CROSSCHECK_FAILED','HUMAN_GOLDEN_VERIFIED','UNVERIFIED')";

exports.up = (pgm) => {
  // --- derived: per-skill mastery -----------------------------------
  pgm.createTable('skill_states', {
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    skill_id: { type: 'text', notNull: true },
    mastery: { type: 'numeric(6,3)', notNull: true }, // 0..100
    confidence: { type: 'numeric(4,3)', notNull: true }, // 0..1
    retention: { type: 'numeric(4,3)' },
    evidence_count: { type: 'integer', notNull: true, default: 0 },
    last_observed_at: { type: 'timestamptz' },
    last_verified_at: { type: 'timestamptz' },
    computed_from_evidence_count: { type: 'integer', notNull: true, default: 0 },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('skill_states', 'skill_states_pkey', { primaryKey: ['child_id', 'skill_id'] });

  pgm.createTable('problem_type_mastery', {
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    problem_type_id: { type: 'text', notNull: true },
    mastery: { type: 'numeric(6,3)', notNull: true },
    confidence: { type: 'numeric(4,3)', notNull: true },
    evidence_count: { type: 'integer', notNull: true, default: 0 },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('problem_type_mastery', 'problem_type_mastery_pkey', {
    primaryKey: ['child_id', 'problem_type_id'],
  });

  pgm.createTable('thinking_state', {
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    dimension: { type: 'text', notNull: true },
    demonstrated_level: { type: 'smallint' }, // 1..5 or null
    score: { type: 'numeric(6,3)', notNull: true },
    confidence: { type: 'numeric(4,3)', notNull: true },
    evidence_count: { type: 'integer', notNull: true, default: 0 },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('thinking_state', 'thinking_state_pkey', { primaryKey: ['child_id', 'dimension'] });

  // --- derived: gaps + prescriptions -------------------------------
  pgm.createTable('knowledge_gaps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    gap_type: { type: 'text', notNull: true },
    target_skill_id: { type: 'text', notNull: true },
    root_skill_id: { type: 'text' },
    severity: { type: 'numeric(4,3)', notNull: true },
    priority: { type: 'numeric(8,4)', notNull: true },
    lifecycle_state: { type: 'text', notNull: true },
    blocks_current_learning: { type: 'boolean', notNull: true, default: false },
    blocks_advanced_learning: { type: 'boolean', notNull: true, default: false },
    rationale: { type: 'text' },
    evidence_refs: { type: 'jsonb', notNull: true, default: '[]' },
    detected_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    computed_from_evidence_count: { type: 'integer', notNull: true, default: 0 },
  });
  pgm.createIndex('knowledge_gaps', ['child_id', 'lifecycle_state']);
  pgm.createIndex('knowledge_gaps', ['child_id', 'target_skill_id']);

  pgm.createTable('gap_prescriptions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    gap_id: { type: 'uuid', references: 'knowledge_gaps', onDelete: 'CASCADE' },
    target_skill_id: { type: 'text', notNull: true },
    duration_days: { type: 'integer' },
    sessions: { type: 'integer' },
    minutes_per_session: { type: 'integer' },
    dose: { type: 'jsonb', notNull: true, default: '{}' },
    retest_items: { type: 'integer' },
    retention_check_days: { type: 'integer' },
    status: { type: 'text', notNull: true, default: 'ACTIVE' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('gap_prescriptions', ['child_id', 'status']);

  // --- derived: daily plan ----------------------------------------
  pgm.createTable('learning_plans', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    plan_date: { type: 'date', notNull: true },
    available_minutes: { type: 'integer', notNull: true },
    kind: { type: 'text', notNull: true, default: 'plan' }, // plan | no_plan_needed
    mix: { type: 'jsonb', notNull: true, default: '{}' },
    planner_version: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`
    CREATE UNIQUE INDEX learning_plans_child_date_uq ON learning_plans (child_id, plan_date);
  `);

  pgm.createTable('plan_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    learning_plan_id: { type: 'uuid', notNull: true, references: 'learning_plans', onDelete: 'CASCADE' },
    order_index: { type: 'integer', notNull: true },
    action_kind: { type: 'text', notNull: true }, // school | gapRepair | advanced | thinking | examRevision
    skill_id: { type: 'text' },
    minutes: { type: 'integer', notNull: true },
    payload: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.createIndex('plan_items', 'learning_plan_id');

  // --- derived: the whole-twin blob (fast read + staleness check) --
  pgm.createTable('learning_state_snapshots', {
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    kind: {
      type: 'text',
      notNull: true,
      check: "kind IN ('TWIN','GAPS','CONTEXT','FRONTIER')",
    },
    state: { type: 'jsonb', notNull: true },
    state_version: { type: 'text', notNull: true },
    evidence_count: { type: 'integer', notNull: true, default: 0 },
    content_hash: { type: 'text', notNull: true },
    provenance: { type: 'jsonb', notNull: true, default: '{}' },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('learning_state_snapshots', 'learning_state_snapshots_pkey', {
    primaryKey: ['child_id', 'kind'],
  });

  // --- genuine student work (append-only) -------------------------
  pgm.createTable('assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    learning_plan_id: { type: 'uuid', references: 'learning_plans', onDelete: 'SET NULL' },
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    assigned_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    assigned_by_role: { type: 'text', check: "assigned_by_role IN ('PARENT','TEACHER','SYSTEM')" },
    source: { type: 'text', notNull: true, default: 'LEGACY_PRACTICE' }, // LEGACY_PRACTICE | AI_GENERATED
    generation_spec_id: { type: 'uuid' },
    generated_exercise_set_id: { type: 'uuid' },
    mode: { type: 'text', notNull: true, default: 'WORKSHEET' },
    target_skill_ids: { type: 'jsonb', notNull: true, default: '[]' },
    status: {
      type: 'text',
      notNull: true,
      default: 'ASSIGNED',
      check: "status IN ('ASSIGNED','IN_PROGRESS','COMPLETED','CANCELLED')",
    },
    due_date: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.createIndex('assignments', ['child_id', 'status']);

  pgm.createTable('assignment_items', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    assignment_id: { type: 'uuid', notNull: true, references: 'assignments', onDelete: 'CASCADE' },
    order_index: { type: 'integer', notNull: true },
    question_ref: { type: 'text' }, // reference-library id or generated id
    skill_id: { type: 'text' },
    problem_type_id: { type: 'text' },
    knowledge_level: { type: 'smallint' },
    thinking_level: { type: 'smallint' },
    prompt: { type: 'jsonb', notNull: true },
    answer_spec: { type: 'jsonb', notNull: true },
    hints: { type: 'jsonb', notNull: true, default: '[]' },
  });
  pgm.createIndex('assignment_items', 'assignment_id');

  pgm.createTable('attempts', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    assignment_id: { type: 'uuid', references: 'assignments', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    status: {
      type: 'text',
      notNull: true,
      default: 'IN_PROGRESS',
      check: "status IN ('IN_PROGRESS','SUBMITTED','ABANDONED')",
    },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    submitted_at: { type: 'timestamptz' },
  });
  pgm.createIndex('attempts', ['child_id', 'status']);
  pgm.createIndex('attempts', 'assignment_id');

  pgm.createTable('attempt_answers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    attempt_id: { type: 'uuid', notNull: true, references: 'attempts', onDelete: 'CASCADE' },
    assignment_item_id: { type: 'uuid', notNull: true, references: 'assignment_items', onDelete: 'CASCADE' },
    child_answer: { type: 'jsonb', notNull: true },
    hints_used: { type: 'integer', notNull: true, default: 0 },
    reasoning_text: { type: 'text' },
    time_spent_seconds: { type: 'integer' },
    verification_level: { type: 'text', notNull: true, default: 'UNVERIFIED', check: `verification_level IN ${VERIFICATION_LEVELS}` },
    correct: { type: 'boolean' },
    verified_at: { type: 'timestamptz' },
    evidence_id: { type: 'text' }, // set when this answer was written into the evidence ledger
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('attempt_answers', 'attempt_id');

  // append-only enforcement for genuine student-work tables
  for (const table of ['attempts', 'attempt_answers']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    `);
  }
};

exports.down = (pgm) => {
  for (const table of ['attempts', 'attempt_answers']) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table};`);
  }
  pgm.dropTable('attempt_answers');
  pgm.dropTable('attempts');
  pgm.dropTable('assignment_items');
  pgm.dropTable('assignments');
  pgm.dropTable('learning_state_snapshots');
  pgm.dropTable('plan_items');
  pgm.dropTable('learning_plans');
  pgm.dropTable('gap_prescriptions');
  pgm.dropTable('knowledge_gaps');
  pgm.dropTable('thinking_state');
  pgm.dropTable('problem_type_mastery');
  pgm.dropTable('skill_states');
};
