/* eslint-disable */
/**
 * Backlog B3-02 — a student joins a classroom with a code from the class teacher.
 *
 * Policy (identity architecture §4.3 + §5): the PARENT is the approval authority for anything that
 * touches the child's record. A code therefore never enrols anyone by itself: redeeming it creates a
 * PROPOSED `student_class_enrollments` row (privacy PRIVATE_LEARNING, so the teacher receives nothing)
 * that the guardian approves or rejects.
 *
 * `classroom_join_codes` — minted by a teacher with an ACTIVE `teacher_class_assignments` row for that
 * classroom; multi-use until it expires (default 14 days) or the teacher revokes it. Purged with the
 * classroom / teacher via FK cascade.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const OLD_SOURCES = "('PARENT','TEACHER','SCHOOL','SYSTEM_PROPOSED','SYSTEM_SUGGESTED')";
const NEW_SOURCES = "('PARENT','TEACHER','SCHOOL','SYSTEM_PROPOSED','SYSTEM_SUGGESTED','STUDENT_JOIN_CODE')";

exports.up = (pgm) => {
  pgm.createTable('classroom_join_codes', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    code: { type: 'text', notNull: true, unique: true },
    classroom_id: { type: 'uuid', notNull: true, references: 'classrooms', onDelete: 'CASCADE' },
    teacher_user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('classroom_join_codes', ['classroom_id', 'teacher_user_id']);

  pgm.addColumns('student_class_enrollments', {
    join_code_id: { type: 'uuid', references: 'classroom_join_codes', onDelete: 'SET NULL' },
  });
  pgm.dropConstraint('student_class_enrollments', 'student_class_enrollments_source_check');
  pgm.addConstraint('student_class_enrollments', 'student_class_enrollments_source_check', {
    check: `source IN ${NEW_SOURCES}`,
  });
};

exports.down = (pgm) => {
  pgm.sql(`DELETE FROM student_class_enrollments WHERE source = 'STUDENT_JOIN_CODE'`);
  pgm.dropConstraint('student_class_enrollments', 'student_class_enrollments_source_check');
  pgm.addConstraint('student_class_enrollments', 'student_class_enrollments_source_check', {
    check: `source IN ${OLD_SOURCES}`,
  });
  pgm.dropColumns('student_class_enrollments', ['join_code_id']);
  pgm.dropTable('classroom_join_codes');
};
