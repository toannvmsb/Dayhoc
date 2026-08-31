/* eslint-disable */
/**
 * Phase 2 — identity core + append-only evidence ledger.
 *
 * `evidence`, `ai_inferences`, `teacher_contributions` and `uploads` are INSERT-only:
 * a BEFORE UPDATE/DELETE trigger raises an exception no matter who the caller is
 * (DB Model §6.2). Corrections are new rows, never mutations.
 *
 * skill_id / problem_type_id are TEXT, not FKs — the curriculum/skill graph is
 * versioned static data owned by @copilot/math-data, validated at the app layer.
 * (Small decision, noted in CLAUDE.md.)
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- identity core (minimal) ---
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    role: { type: 'text', notNull: true, check: "role IN ('parent','child','teacher','admin')" },
    auth_ref: { type: 'text' },
    locale: { type: 'text', notNull: true, default: 'vi' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('families', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    owner_parent_id: { type: 'uuid', references: 'users', onDelete: 'RESTRICT' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('parents', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    family_id: { type: 'uuid', notNull: true, references: 'families', onDelete: 'CASCADE' },
    display_name: { type: 'text', notNull: true },
  });

  pgm.createTable('teachers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
  });

  pgm.createTable('child_profiles', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    family_id: { type: 'uuid', notNull: true, references: 'families', onDelete: 'CASCADE' },
    display_name: { type: 'text', notNull: true },
    school_grade: { type: 'smallint', notNull: true, check: 'school_grade BETWEEN 1 AND 9' },
    school_context: { type: 'jsonb', notNull: true, default: '{}' },
    goals: { type: 'jsonb', notNull: true, default: '[]' },
    available_time_profile: { type: 'smallint' },
    access_pin: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('teacher_invites', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    family_id: { type: 'uuid', notNull: true, references: 'families', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    teacher_id: { type: 'uuid', references: 'teachers', onDelete: 'SET NULL' },
    class_ref: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'pending', check: "status IN ('pending','accepted','revoked')" },
    invited_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- AI provenance (append-only) ---
  pgm.createTable('ai_inferences', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    model: { type: 'text', notNull: true },
    provider: { type: 'text', notNull: true },
    operation: { type: 'text', notNull: true },
    prompt_ref: { type: 'text' },
    raw_output: { type: 'jsonb', notNull: true },
    schema_version: { type: 'text', notNull: true },
    schema_valid: { type: 'boolean', notNull: true },
    confidence: { type: 'numeric(4,3)' },
    latency_ms: { type: 'integer' },
    token_in: { type: 'integer' },
    token_out: { type: 'integer' },
    cost_usd: { type: 'numeric(10,6)' },
    safety_flags: { type: 'jsonb', notNull: true, default: '[]' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- uploads (append-only metadata; storage is S3-compatible) ---
  pgm.createTable('uploads', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    kind: { type: 'text', notNull: true },
    storage_key: { type: 'text', notNull: true },
    status: { type: 'text', notNull: true, default: 'stored' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- evidence ledger (append-only) ---
  pgm.createTable('evidence', {
    id: { type: 'text', primaryKey: true },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    source: { type: 'text', notNull: true },
    occurred_at: { type: 'timestamptz', notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    skill_id: { type: 'text' },
    problem_type_id: { type: 'text' },
    result: { type: 'jsonb', notNull: true },
    reasoning_quality: { type: 'text' },
    hint_dependency: { type: 'numeric(4,3)' },
    time_spent_seconds: { type: 'integer' },
    confidence_tier: { type: 'text', notNull: true, check: "confidence_tier IN ('A','B','C','D')" },
    provenance: { type: 'text', notNull: true, check: "provenance IN ('manual','scan','assessment','teacher','parent')" },
    ai_inference_id: { type: 'uuid', references: 'ai_inferences', onDelete: 'SET NULL' },
  });
  pgm.createIndex('evidence', ['child_id', 'occurred_at']);
  pgm.createIndex('evidence', ['child_id', 'skill_id']);

  pgm.createTable('teacher_contributions', {
    id: { type: 'text', primaryKey: true },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    contributed_as: { type: 'text', notNull: true, check: "contributed_as IN ('teacher','parent')" },
    actor_user_id: { type: 'text', notNull: true },
    occurred_on: { type: 'date', notNull: true },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    taught_skill_ids: { type: 'jsonb', notNull: true, default: '[]' },
    problem_type_ids: { type: 'jsonb', notNull: true, default: '[]' },
    homework_refs: { type: 'jsonb', notNull: true, default: '[]' },
    exam_ref: { type: 'jsonb' },
  });
  pgm.createIndex('teacher_contributions', ['child_id', 'occurred_on']);

  // --- enforce append-only at the database (defense in depth) ---
  pgm.sql(`
    CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'table % is append-only: % is not permitted', TG_TABLE_NAME, TG_OP
        USING ERRCODE = 'restrict_violation';
    END;
    $$ LANGUAGE plpgsql;
  `);
  for (const table of ['evidence', 'ai_inferences', 'teacher_contributions', 'uploads']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    `);
  }
};

exports.down = (pgm) => {
  for (const table of ['evidence', 'ai_inferences', 'teacher_contributions', 'uploads']) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table};`);
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table};`);
  }
  pgm.sql('DROP FUNCTION IF EXISTS reject_ledger_mutation();');
  pgm.dropTable('teacher_contributions');
  pgm.dropTable('evidence');
  pgm.dropTable('uploads');
  pgm.dropTable('ai_inferences');
  pgm.dropTable('teacher_invites');
  pgm.dropTable('child_profiles');
  pgm.dropTable('teachers');
  pgm.dropTable('parents');
  pgm.dropTable('families');
  pgm.dropTable('users');
};
