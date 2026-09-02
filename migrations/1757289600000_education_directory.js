/* eslint-disable */
/**
 * I2 — Education directory (additive — docs 20, 23; ID-Q7).
 *
 * `schools` / `academic_years` / `subjects` / `classrooms` +
 * `teacher_school_memberships` / `teacher_class_assignments`. No `class_cohorts`
 * (deferred — the class-name suggestion is a deterministic heuristic, doc 24).
 *
 * Green field: nothing references these yet, so there is no backfill and the
 * rollback is a plain drop. Seeds: academic_years 2025-26 … 2028-29, subjects
 * (MATH ACTIVE, the rest PLANNED).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const DIR_VERIF = "('UNVERIFIED','COMMUNITY_VERIFIED','SYSTEM_VERIFIED')";

exports.up = (pgm) => {
  // --- schools (E-1: NOT identified by name alone) ---
  pgm.createTable('schools', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    official_name: { type: 'text', notNull: true },
    short_name: { type: 'text' },
    school_type: {
      type: 'text',
      notNull: true,
      default: 'OTHER',
      check: "school_type IN ('PRIMARY','LOWER_SECONDARY','UPPER_SECONDARY','K12','OTHER')",
    },
    official_school_code: { type: 'text' },
    province: { type: 'text' },
    district: { type: 'text' },
    ward: { type: 'text' },
    address: { type: 'text' },
    latitude: { type: 'numeric(9,6)' },
    longitude: { type: 'numeric(9,6)' },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'UNVERIFIED',
      check: `verification_status IN ${DIR_VERIF}`,
    },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // soft de-dup key (E-1) — same name at a different address stays a distinct row.
  // COALESCE the nullable address parts so the unique index actually fires.
  pgm.sql(`
    CREATE UNIQUE INDEX schools_identity_uq ON schools (
      lower(official_name),
      lower(coalesce(province,'')),
      lower(coalesce(district,'')),
      lower(coalesce(ward,'')),
      lower(coalesce(address,''))
    );
  `);
  pgm.sql(`
    CREATE UNIQUE INDEX schools_official_code_uq ON schools (official_school_code)
      WHERE official_school_code IS NOT NULL;
  `);

  // --- academic_years (E-2: first-class) ---
  pgm.createTable('academic_years', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    label: { type: 'text', notNull: true, unique: true }, // "2026-2027"
    start_date: { type: 'date', notNull: true },
    end_date: { type: 'date', notNull: true },
    region: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'PLANNED',
      check: "status IN ('PLANNED','ACTIVE','COMPLETED')",
    },
  });

  // --- subjects (first-class; MVP: MATH ACTIVE) ---
  pgm.createTable('subjects', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'text', notNull: true, unique: true },
    name: { type: 'text', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'PLANNED',
      check: "status IN ('ACTIVE','PLANNED')",
    },
  });

  // --- classrooms (identity includes academic year — E-2) ---
  pgm.createTable('classrooms', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    school_id: { type: 'uuid', notNull: true, references: 'schools', onDelete: 'CASCADE' },
    academic_year_id: { type: 'uuid', notNull: true, references: 'academic_years', onDelete: 'RESTRICT' },
    grade: { type: 'smallint', notNull: true, check: 'grade BETWEEN 1 AND 12' },
    class_name: { type: 'text', notNull: true }, // "7C0" — display label, NOT identity
    display_name: { type: 'text' },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'UNVERIFIED',
      check: `verification_status IN ${DIR_VERIF}`,
    },
    status: { type: 'text', notNull: true, default: 'ACTIVE', check: "status IN ('ACTIVE','ARCHIVED')" },
    created_by: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    archived_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('classrooms', 'classrooms_identity_uq', {
    unique: ['school_id', 'academic_year_id', 'grade', 'class_name'],
  });

  // --- teacher ↔ school / class ---
  pgm.createTable('teacher_school_memberships', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    teacher_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    school_id: { type: 'uuid', notNull: true, references: 'schools', onDelete: 'CASCADE' },
    role: { type: 'text', notNull: true, default: 'SUBJECT', check: "role IN ('STAFF','HOMEROOM','SUBJECT','ADMIN')" },
    status: { type: 'text', notNull: true, default: 'ACTIVE', check: "status IN ('ACTIVE','ENDED')" },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'SELF_DECLARED',
      check: "verification_status IN ('SELF_DECLARED','SCHOOL_VERIFIED')",
    },
    valid_from: { type: 'date' },
    valid_until: { type: 'date' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('teacher_school_memberships', ['teacher_user_id', 'status']);

  pgm.createTable('teacher_class_assignments', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    teacher_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    classroom_id: { type: 'uuid', notNull: true, references: 'classrooms', onDelete: 'CASCADE' },
    academic_year_id: { type: 'uuid', notNull: true, references: 'academic_years', onDelete: 'RESTRICT' },
    subject_id: { type: 'uuid', notNull: true, references: 'subjects', onDelete: 'RESTRICT' },
    role: {
      type: 'text',
      notNull: true,
      default: 'SUBJECT_TEACHER',
      check: "role IN ('CLASS_TEACHER','SUBJECT_TEACHER','ASSISTANT')",
    },
    status: { type: 'text', notNull: true, default: 'ACTIVE', check: "status IN ('ACTIVE','ENDED')" },
    verification_status: {
      type: 'text',
      notNull: true,
      default: 'SELF_DECLARED',
      check: "verification_status IN ('SELF_DECLARED','SCHOOL_VERIFIED','PARENT_CONFIRMED')",
    },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    ended_at: { type: 'timestamptz' },
  });
  pgm.createIndex('teacher_class_assignments', ['classroom_id', 'subject_id', 'status']);
  pgm.createIndex('teacher_class_assignments', ['teacher_user_id', 'status']);

  // --- seeds -----------------------------------------------------------
  // Academic years — MOET typical dates (provisional; a school override comes later).
  pgm.sql(`
    INSERT INTO academic_years (label, start_date, end_date, status) VALUES
      ('2025-2026', '2025-09-05', '2026-05-31', 'COMPLETED'),
      ('2026-2027', '2026-09-05', '2027-05-31', 'ACTIVE'),
      ('2027-2028', '2027-09-05', '2028-05-31', 'PLANNED'),
      ('2028-2029', '2028-09-05', '2029-05-31', 'PLANNED')
    ON CONFLICT (label) DO NOTHING;
  `);
  pgm.sql(`
    INSERT INTO subjects (code, name, status) VALUES
      ('MATH', 'Toán', 'ACTIVE'),
      ('VIETNAMESE', 'Ngữ văn', 'PLANNED'),
      ('ENGLISH', 'Tiếng Anh', 'PLANNED'),
      ('SCIENCE', 'Khoa học tự nhiên', 'PLANNED')
    ON CONFLICT (code) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('teacher_class_assignments');
  pgm.dropTable('teacher_school_memberships');
  pgm.dropTable('classrooms');
  pgm.dropTable('subjects');
  pgm.dropTable('academic_years');
  pgm.dropTable('schools');
};
