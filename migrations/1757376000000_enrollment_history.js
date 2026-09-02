/* eslint-disable */
/**
 * I3 — Historical enrollment (additive — docs 20, 24; Amendment 2).
 *
 * `student_school_enrollments` + `student_class_enrollments` (with
 * `enrollment_type` — PRIMARY vs supplementary). History is NEVER overwritten
 * (E-3): a school/class change is a NEW row + a terminal status on the old one.
 *
 * Constraints:
 *  - ≤ 1 ACTIVE school enrollment per child (partial unique).
 *  - ≤ 1 ACTIVE PRIMARY class enrollment per child per academic year (partial
 *    unique). Supplementary / HSG_TEAM / TUTOR_GROUP / CLUB / OTHER are
 *    unconstrained.
 *
 * Compatibility: the legacy `child_school_enrollment` table is left intact and
 * a VIEW is NOT created over it here — nothing in this migration reads it. When
 * I3's runtime wiring lands (`EnrollmentService.resolveActiveEnrollment`), a
 * compat VIEW `child_school_enrollment` selecting the ACTIVE
 * `student_school_enrollments` row replaces the legacy table read. That VIEW
 * swap is deferred (OPEN_DECISION, PENDING_APPROVAL) because the legacy table
 * has 0 rows in the pilot DB and no runtime consumer is switched yet.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('student_school_enrollments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    school_id: { type: 'uuid', references: 'schools', onDelete: 'SET NULL' }, // nullable for legacy-migrated rows
    academic_year_id: { type: 'uuid', notNull: true, references: 'academic_years', onDelete: 'RESTRICT' },
    grade: { type: 'smallint', notNull: true, check: 'grade BETWEEN 1 AND 12' },
    curriculum_id: { type: 'text', notNull: true, default: 'KET_NOI_TRI_THUC' },
    calendar_id: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'PROPOSED',
      check: "status IN ('PROPOSED','ACTIVE','COMPLETED','TRANSFERRED','WITHDRAWN','REPEATED')",
    },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    source: {
      type: 'text',
      notNull: true,
      default: 'PARENT',
      check: "source IN ('PARENT','TEACHER','SCHOOL','SYSTEM_PROPOSED','SYSTEM_SUGGESTED')",
    },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'SELF_DECLARED',
      check: "verification_status IN ('SELF_DECLARED','SCHOOL_VERIFIED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('student_school_enrollments', 'child_id');
  pgm.sql(`
    CREATE UNIQUE INDEX student_school_enrollments_active_uq
      ON student_school_enrollments (child_id) WHERE status = 'ACTIVE';
  `);

  pgm.createTable('student_class_enrollments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    classroom_id: { type: 'uuid', notNull: true, references: 'classrooms', onDelete: 'CASCADE' },
    academic_year_id: { type: 'uuid', notNull: true, references: 'academic_years', onDelete: 'RESTRICT' },
    school_enrollment_id: { type: 'uuid', references: 'student_school_enrollments', onDelete: 'SET NULL' },
    enrollment_type: {
      type: 'text',
      notNull: true,
      default: 'PRIMARY',
      check: "enrollment_type IN ('PRIMARY','SUPPLEMENTARY','HSG_TEAM','TUTOR_GROUP','CLUB','OTHER')",
    },
    privacy_mode: {
      type: 'text',
      notNull: true,
      default: 'PRIVATE_LEARNING',
      check: "privacy_mode IN ('PRIVATE_LEARNING','LINKED_PRIVATE','LINKED_SHARED')",
    },
    status: { type: 'text', notNull: true, default: 'PROPOSED', check: "status IN ('PROPOSED','ACTIVE','LEFT')" },
    joined_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    left_at: { type: 'timestamptz' },
    source: {
      type: 'text',
      notNull: true,
      default: 'PARENT',
      check: "source IN ('PARENT','TEACHER','SCHOOL','SYSTEM_PROPOSED','SYSTEM_SUGGESTED')",
    },
    verified_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    verified_at: { type: 'timestamptz' },
  });
  pgm.createIndex('student_class_enrollments', 'child_id');
  pgm.createIndex('student_class_enrollments', ['classroom_id', 'status']);
  pgm.sql(`
    CREATE UNIQUE INDEX student_class_enrollments_active_primary_uq
      ON student_class_enrollments (child_id, academic_year_id)
      WHERE status = 'ACTIVE' AND enrollment_type = 'PRIMARY';
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('student_class_enrollments');
  pgm.dropTable('student_school_enrollments');
};
