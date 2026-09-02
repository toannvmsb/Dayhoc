/* eslint-disable */
/**
 * I6 — Academic Progression Engine schema (additive — doc 24).
 *
 * `enrollment_transitions` — a PROPOSED / CONFIRMED / CANCELLED record of a
 * child's move between academic years / grades / schools / classes. Proposals
 * are surfaced, never applied; `confirmTransition` (service) atomically closes
 * the old ACTIVE PRIMARY enrollment and creates the new one. The Learning Twin
 * and `child_id` are never touched (P-5).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('enrollment_transitions', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    transition_type: {
      type: 'text',
      notNull: true,
      check:
        "transition_type IN ('PROMOTION','CLASS_CHANGE','SCHOOL_TRANSFER','REPEAT_GRADE','MANUAL_CORRECTION','GRADUATION')",
    },
    from_school_id: { type: 'uuid', references: 'schools', onDelete: 'SET NULL' },
    from_classroom_id: { type: 'uuid', references: 'classrooms', onDelete: 'SET NULL' },
    from_academic_year_id: { type: 'uuid', references: 'academic_years', onDelete: 'SET NULL' },
    from_grade: { type: 'smallint' },
    to_school_id: { type: 'uuid', references: 'schools', onDelete: 'SET NULL' },
    to_classroom_id: { type: 'uuid', references: 'classrooms', onDelete: 'SET NULL' },
    to_academic_year_id: { type: 'uuid', notNull: true, references: 'academic_years', onDelete: 'RESTRICT' },
    to_grade: { type: 'smallint' },
    suggested_class_name: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'PROPOSED',
      check: "status IN ('PROPOSED','CONFIRMED','CANCELLED')",
    },
    requires_school_confirmation: { type: 'boolean', notNull: true, default: false },
    proposed_by: { type: 'text', notNull: true, check: "proposed_by IN ('SYSTEM','PARENT','TEACHER','SCHOOL')" },
    proposed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    confirmed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    confirmed_at: { type: 'timestamptz' },
  });
  pgm.createIndex('enrollment_transitions', 'child_id');
  // one live transition per (child, target year) — idempotent year-end batch (doc 24 §4)
  pgm.sql(`
    CREATE UNIQUE INDEX enrollment_transitions_live_uq
      ON enrollment_transitions (child_id, to_academic_year_id)
      WHERE status IN ('PROPOSED','CONFIRMED');
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('enrollment_transitions');
};
