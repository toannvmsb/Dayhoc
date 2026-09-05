/* eslint-disable */
/**
 * Parent-facing "xoá khỏi danh sách" for uploads (UX fix). Additive, reversible.
 *
 * `uploads` (the raw ledger) is INSERT-only by design — a BEFORE UPDATE/DELETE
 * trigger rejects any change (see `1756598400000_evidence_ledger.js`). A
 * parent's "delete this upload" therefore cannot be a real DELETE; it's a
 * dismiss flag on the MUTABLE `upload_analysis` row (no such trigger there),
 * which just hides the row from `listUploads` going forward. Any evidence
 * already produced from a CONFIRMED upload is untouched — this is not the
 * data-subject deletion workflow, only a list decluttering / "uploaded by
 * mistake" self-serve action.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('upload_analysis', {
    dismissed_at: { type: 'timestamptz' },
    dismissed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('upload_analysis', ['dismissed_at', 'dismissed_by_user_id']);
};
