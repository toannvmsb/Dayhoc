/* eslint-disable */
/**
 * Backlog B1-05 + exam link (doc 71).
 *
 *  - assignments.exam_id        — which scheduled exam a "đề ôn thử" was built for (NULL for ordinary practice).
 *                                 ON DELETE SET NULL: deleting an exam never deletes the child's work.
 *  - assignment_items.selection_reason / cooldown_override_reason — the MANDATORY selection log of the
 *    question-library policy ("Claude Instructions" sheet): why each question was served and, if the
 *    semantic anti-repeat cooldown had to be relaxed, which one.
 *
 * Purely additive and nullable — old rows and old code keep working.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('assignments', {
    exam_id: { type: 'uuid', references: 'exams', onDelete: 'SET NULL' },
  });
  pgm.createIndex('assignments', ['exam_id'], { where: 'exam_id IS NOT NULL', name: 'assignments_exam_id_idx' });

  pgm.addColumns('assignment_items', {
    selection_reason: { type: 'text' },
    cooldown_override_reason: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('assignment_items', ['selection_reason', 'cooldown_override_reason']);
  pgm.dropIndex('assignments', ['exam_id'], { name: 'assignments_exam_id_idx' });
  pgm.dropColumns('assignments', ['exam_id']);
};
