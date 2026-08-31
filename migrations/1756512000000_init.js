/* eslint-disable */
/**
 * Phase 0 — baseline migration.
 *
 * Establishes the extensions and a schema-meta marker only. The real education
 * schema (curriculum, skills, prerequisites, append-only evidence ledger, derived
 * state) lands in Phases 1–2, each behind its own migration. This proves the
 * migrate up/down pipeline works end to end.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createExtension('pgcrypto', { ifNotExists: true });

  pgm.createTable('schema_meta', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.sql(
    `INSERT INTO schema_meta (key, value) VALUES ('mvp_version', '1.0')
     ON CONFLICT (key) DO NOTHING;`,
  );
};

exports.down = (pgm) => {
  pgm.dropTable('schema_meta');
  pgm.dropExtension('pgcrypto', { ifExists: true });
};
