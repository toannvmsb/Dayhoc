/* eslint-disable */
/**
 * Raw-photo retention marker (Privacy architecture: raw uploads are kept at most 30 days).
 *
 * `uploads` is INSERT-only, so "the photo bytes are gone" is recorded on the mutable
 * `upload_analysis` row. A NULL `bytes_purged_at` on an old upload means the daily sweep
 * still has to remove the object from storage. Additive and reversible.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('upload_analysis', {
    bytes_purged_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('upload_analysis', ['bytes_purged_at']);
};
