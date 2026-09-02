/* eslint-disable */
/**
 * I5 — Teacher learning contributions: subject-scoped, provenance-rich
 * (additive — doc 21 §7).
 *
 * `teacher_contributions` gains: `subject_id`, `contribution_type`,
 * `relationship_source_type` / `relationship_source_id`, `confidence`,
 * `visibility`, `attachment_id`, plus a nullable `teacher_user_id` (the legacy
 * `actor_user_id text` is kept). All nullable → pre-I5 rows and callers keep
 * working; the Resolver reads `confidence` only when present (doc 13 behaviour
 * preserved).
 *
 * The table is append-only (INSERT-only trigger). Adding columns is DDL, not a
 * row mutation, so it is allowed. The backfill of existing rows runs with
 * `session_replication_role = replica` (same privileged pattern as retention).
 * The pilot DB has 0 `teacher_contributions`, so the backfill is a no-op here.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('teacher_contributions', {
    subject_id: { type: 'uuid', references: 'subjects', onDelete: 'SET NULL' },
    contribution_type: {
      type: 'text',
      check:
        "contribution_type IN ('CURRENT_LESSON','CURRICULUM_PROGRESS','HOMEWORK','TEST_RESULT'," +
        "'EXAM_NOTICE','EXAM_SCOPE','SKILL_ASSESSMENT','LEARNING_OBSERVATION','STRENGTH','WEAKNESS'," +
        "'BEHAVIOUR_OBSERVATION','ASSIGNMENT','COMMENT')",
    },
    relationship_source_type: {
      type: 'text',
      check: "relationship_source_type IN ('TEACHER_CHILD_LINK','CLASS_ASSIGNMENT')",
    },
    relationship_source_id: { type: 'uuid' },
    confidence: { type: 'text', check: "confidence IN ('A','B','C','D')" },
    visibility: { type: 'text', check: "visibility IN ('PARENT_AND_CHILD','PARENT_ONLY')" },
    attachment_id: { type: 'uuid', references: 'uploads', onDelete: 'SET NULL' },
    teacher_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
  });
  pgm.createIndex('teacher_contributions', ['child_id', 'subject_id']);

  // backfill existing rows (privileged — the table is append-only)
  pgm.sql(`
    SET session_replication_role = replica;
    UPDATE teacher_contributions SET
      subject_id = coalesce(subject_id, (SELECT id FROM subjects WHERE code = 'MATH')),
      contribution_type = coalesce(contribution_type,
        CASE
          WHEN exam_ref IS NOT NULL THEN 'EXAM_NOTICE'
          WHEN jsonb_array_length(coalesce(homework_refs,'[]'::jsonb)) > 0 THEN 'HOMEWORK'
          WHEN jsonb_array_length(coalesce(taught_skill_ids,'[]'::jsonb)) > 0 THEN 'CURRENT_LESSON'
          ELSE 'COMMENT'
        END),
      confidence = coalesce(confidence, CASE contributed_as WHEN 'teacher' THEN 'B' ELSE 'C' END),
      visibility = coalesce(visibility, 'PARENT_AND_CHILD')
    WHERE subject_id IS NULL OR contribution_type IS NULL OR confidence IS NULL OR visibility IS NULL;
    SET session_replication_role = origin;
  `);
};

exports.down = (pgm) => {
  pgm.dropColumns('teacher_contributions', [
    'subject_id',
    'contribution_type',
    'relationship_source_type',
    'relationship_source_id',
    'confidence',
    'visibility',
    'attachment_id',
    'teacher_user_id',
  ]);
};
