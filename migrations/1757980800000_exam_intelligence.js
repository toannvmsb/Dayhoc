/* eslint-disable */
/**
 * M6 — Exam intelligence (additive, reversible).
 *
 *   create exam (date / subject / scope / notes)
 *     → revision map (deterministic, recomputed on read — not stored)
 *     → record result (per-question awarded score)
 *     → post-exam diagnosis (classify each lost point)
 *
 *   - `exams` — MUTABLE: `status` advances SCHEDULED → SCOPE_CONFIRMED →
 *     COMPLETED. `scope_skill_ids` is the parent/teacher-confirmed scope;
 *     `inferred_scope` is the engine's guess kept for provenance.
 *   - `exam_results` — one row per exam: the raw per-question outcomes plus the
 *     computed diagnosis blob. Rewritten if the parent re-enters marks.
 *
 * The revision plan itself is deterministic (exam + fresh twin/gaps) and is
 * recomputed on every read — nothing to persist.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const EXAM_STATUS = "('SCHEDULED','SCOPE_CONFIRMED','COMPLETED','CANCELLED')";

exports.up = (pgm) => {
  pgm.createTable('exams', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    exam_date: { type: 'date', notNull: true },
    subject: { type: 'text', notNull: true },
    notes: { type: 'text' },
    scope_skill_ids: { type: 'jsonb' },
    inferred_scope: { type: 'jsonb' },
    status: { type: 'text', notNull: true, default: 'SCHEDULED', check: `status IN ${EXAM_STATUS}` },
    created_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('exams', ['child_id', 'exam_date']);

  pgm.createTable('exam_results', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    exam_id: { type: 'uuid', notNull: true, unique: true, references: 'exams', onDelete: 'CASCADE' },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    outcomes: { type: 'jsonb', notNull: true, default: '[]' },
    diagnosis: { type: 'jsonb' },
    recorded_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    recorded_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('exam_results');
  pgm.dropTable('exams');
};
