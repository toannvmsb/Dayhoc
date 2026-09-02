/* eslint-disable */
/**
 * M4 — Evidence upload + document-vision ingestion (additive, reversible).
 *
 * Two records per upload:
 *   - `uploads` (EXISTING, append-only ledger) — we only ADD immutable
 *     provenance columns (actor, original metadata, content hash). The
 *     append-only trigger is untouched; ALTER ... ADD COLUMN is DDL, not a row
 *     UPDATE, so it does not fire.
 *   - `upload_analysis` (NEW, MUTABLE) — the processing state machine:
 *     UPLOAD_CREATED → UPLOADED → READING → ANALYZING → MAPPED →
 *     NEEDS_CONFIRMATION → CONFIRMED, with FAILED reachable from any processing
 *     state. Holds the extraction, mapping candidates, confidence, error and the
 *     confirmation actor/time. NO append-only trigger — this row is meant to change.
 *
 * Binary content is never stored here — only `uploads.storage_key`.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const ANALYSIS_STATES =
  "('UPLOAD_CREATED','UPLOADED','READING','ANALYZING','MAPPED','NEEDS_CONFIRMATION','CONFIRMED','FAILED')";

exports.up = (pgm) => {
  // --- immutable ledger: additive provenance columns ---
  pgm.addColumns('uploads', {
    actor_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    original_filename: { type: 'text' },
    mime_type: { type: 'text' },
    byte_size: { type: 'bigint' },
    content_hash: { type: 'text' },
  });

  // --- mutable analysis state ---
  pgm.createTable('upload_analysis', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    upload_id: {
      type: 'uuid',
      notNull: true,
      unique: true,
      references: 'uploads',
      onDelete: 'CASCADE',
    },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    state: {
      type: 'text',
      notNull: true,
      default: 'UPLOAD_CREATED',
      check: `state IN ${ANALYSIS_STATES}`,
    },
    extraction_version: { type: 'text' },
    adapter_provider: { type: 'text' },
    adapter_model: { type: 'text' },
    extraction: { type: 'jsonb' },
    confidence: { type: 'numeric(4,3)' },
    error_code: { type: 'text' },
    error_message: { type: 'text' },
    confirmed_by_user_id: { type: 'uuid', references: 'users', onDelete: 'SET NULL' },
    confirmed_at: { type: 'timestamptz' },
    resulting_evidence_ids: { type: 'jsonb', notNull: true, default: '[]' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('upload_analysis', 'child_id');
  pgm.createIndex('upload_analysis', 'state');
};

exports.down = (pgm) => {
  pgm.dropTable('upload_analysis');
  pgm.dropColumns('uploads', [
    'actor_user_id',
    'original_filename',
    'mime_type',
    'byte_size',
    'content_hash',
  ]);
};
