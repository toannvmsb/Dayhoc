/* eslint-disable */
/**
 * Durable worksheet-generation job queue (doc 67 §D2).
 *
 * The in-process `InMemoryWorksheetShadowQueue` loses jobs on restart and is
 * single-instance. This table is the persistent, restart-safe, single-writer-or-
 * many-workers queue for SHADOW (and, later, LIVE) worksheet generation.
 *
 * Only the SERIALIZABLE part of a job lives here: the `ExerciseGenerationSpec`,
 * the mode, a pseudonymous child ref, the usage context, and a partial
 * orchestrator config. The non-serializable deps (generators, KB, crosscheck
 * adapter, stores) are rebuilt by each worker from its own factory.
 *
 * NO child PII: `child_ref` is pseudonymous; `spec` is the planner's educational
 * contract (skill ids, buckets, K/T ranges — no name/school/evidence text);
 * `last_error` is a category string, never content.
 *
 * Mutable table (a job moves PENDING → CLAIMED → DONE|FAILED, and CLAIMED can
 * lease-expire back to PENDING) — NOT an append-only ledger.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('worksheet_jobs', {
    id: { type: 'text', primaryKey: true },
    // idempotency: re-enqueue with the same key is a no-op (ON CONFLICT DO NOTHING)
    dedup_key: { type: 'text', notNull: true, unique: true },
    mode: { type: 'text', notNull: true, check: "mode IN ('SHADOW','LIVE')" },
    generation_spec_id: { type: 'text', notNull: true },
    child_ref: { type: 'text' }, // pseudonymous — NOT a child_profiles FK
    spec: { type: 'jsonb', notNull: true },
    usage_context: { type: 'jsonb' },
    config: { type: 'jsonb' },
    state: {
      type: 'text',
      notNull: true,
      default: 'PENDING',
      check: "state IN ('PENDING','CLAIMED','DONE','FAILED')",
    },
    attempts: { type: 'integer', notNull: true, default: 0 },
    max_attempts: { type: 'integer', notNull: true, default: 3 },
    /** earliest time a PENDING job may be claimed (backoff after a failed try). */
    available_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    claimed_by: { type: 'text' },
    claimed_at: { type: 'timestamptz' },
    lease_expires_at: { type: 'timestamptz' },
    last_error: { type: 'text' },
    run_id: { type: 'text' }, // resulting worksheet_generation_runs.id, on DONE
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // the claim query orders by (available_at, created_at) over claimable rows
  pgm.createIndex('worksheet_jobs', ['state', 'available_at', 'created_at'], {
    name: 'worksheet_jobs_claimable_idx',
  });
  pgm.createIndex('worksheet_jobs', ['generation_spec_id'], {
    name: 'worksheet_jobs_spec_idx',
  });
  // `updated_at` is set explicitly by the queue's UPDATE statements — no trigger.
};

exports.down = (pgm) => {
  pgm.dropTable('worksheet_jobs');
};
