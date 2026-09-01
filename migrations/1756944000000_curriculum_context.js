/* eslint-disable */
/**
 * Curriculum Clock + Learning Context Resolver persistence (doc 13, doc 17 Group B3).
 *
 * - `child_school_enrollment` : which curriculum / grade / academic year / calendar
 *   a child follows (the clock's input).
 * - `lesson_confirmations`    : ⊕ append-only. A parent/teacher confirming or
 *   correcting the current lesson — NEVER a destructive context overwrite; it is
 *   one more signal for the resolver.
 * - `learning_context_snapshots` : ⊕ append-only. Each resolver run's expected +
 *   resolved + pace_delta, so the resolved context is a replayable projection.
 * - `curriculum_calendars` : optional per-school override of the code-shipped
 *   calendar (MVP does not force users to pick a school).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('child_school_enrollment', {
    child_id: { type: 'uuid', primaryKey: true, references: 'child_profiles', onDelete: 'CASCADE' },
    curriculum_id: { type: 'text', notNull: true, default: 'KET_NOI_TRI_THUC' },
    grade: { type: 'integer', notNull: true },
    academic_year: { type: 'text', notNull: true }, // e.g. 2026-2027
    calendar_id: { type: 'text' }, // null → resolve by (curriculum, grade, year)
    section_label: { type: 'text' },
    joined_on: { type: 'date' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('lesson_confirmations', {
    id: { type: 'text', primaryKey: true },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    lesson_id: { type: 'text', notNull: true }, // KB curriculum-node id, e.g. C.G7.6.21
    topic_note: { type: 'text' },
    source: { type: 'text', notNull: true, check: "source IN ('TEACHER_UPDATE','PARENT_UPDATE')" },
    confidence: { type: 'text', notNull: true, check: "confidence IN ('VERIFIED','STRONG','SUPPORTING','ESTIMATED')" },
    confirmed_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'SET NULL' },
    confirmed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('lesson_confirmations', ['child_id', 'confirmed_at']);

  pgm.createTable('learning_context_snapshots', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    computed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expected: { type: 'jsonb' }, // clock estimate + window + calendar provenance
    resolved: { type: 'jsonb', notNull: true }, // lessonId + source + confidence + window + guardrailApplied
    pace_delta: { type: 'numeric(4,3)', notNull: true, default: 0 },
    pace_delta_hypothesis: { type: 'jsonb' },
    strongest_signal_at: { type: 'timestamptz' },
    strongest_signal_source: { type: 'text' },
  });
  pgm.createIndex('learning_context_snapshots', ['child_id', 'computed_at']);

  pgm.createTable('curriculum_calendars', {
    calendar_id: { type: 'text', primaryKey: true },
    curriculum_id: { type: 'text', notNull: true },
    grade: { type: 'integer', notNull: true },
    academic_year: { type: 'text', notNull: true },
    version: { type: 'integer', notNull: true, default: 1 },
    status: { type: 'text', notNull: true, default: 'PROVISIONAL', check: "status IN ('PROVISIONAL','VERIFIED')" },
    effective_from: { type: 'date', notNull: true },
    effective_to: { type: 'date', notNull: true },
    source: { type: 'text', notNull: true },
    region: { type: 'text' },
    school_override_id: { type: 'text' },
    data: { type: 'jsonb', notNull: true }, // school_start_date, holidays, semesters, pacing
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // append-only enforcement
  for (const table of ['lesson_confirmations', 'learning_context_snapshots']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    `);
  }
};

exports.down = (pgm) => {
  for (const table of ['lesson_confirmations', 'learning_context_snapshots']) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table};`);
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table};`);
  }
  pgm.dropTable('curriculum_calendars');
  pgm.dropTable('learning_context_snapshots');
  pgm.dropTable('lesson_confirmations');
  pgm.dropTable('child_school_enrollment');
};
