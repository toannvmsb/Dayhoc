/* eslint-disable */
/**
 * Production worksheet-orchestrator persistence (doc 65 §3).
 *
 * Append-only (⊕): `worksheet_generation_runs`, `worksheet_slots`,
 * `worksheet_slot_attempts`. A re-run writes a new run row; slots/attempts never
 * mutate. `review_queue` is the ONLY mutable table here — a reviewer resolves a
 * row (PENDING → APPROVED/REJECTED/REGENERATE_REQUESTED) exactly once.
 *
 * NO child PII in any of these tables: pseudonymous `child_ref` only, and
 * operational metadata (states, categories, counts, versions, latency, cost).
 * `review_queue` keeps a SHORT-RETENTION prompt/solution snapshot for the
 * reviewer — treated as QA data, purged on the standard schedule.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

const appendOnly = (pgm, table) => {
  pgm.sql(`
    CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
  `);
};

exports.up = (pgm) => {
  pgm.createTable('worksheet_generation_runs', {
    id: { type: 'text', primaryKey: true },
    // plain text (NOT a generation_specs FK) — the worksheet orchestrator owns
    // its own lifecycle; the daily-plan spec is persisted by the C5 path. The
    // child-deletion workflow purges by `generation_spec_id IN (child's specs)`.
    generation_spec_id: { type: 'text', notNull: true },
    child_ref: { type: 'text' }, // pseudonymous — NOT a child_profiles FK
    mode: { type: 'text', notNull: true, check: "mode IN ('SHADOW','LIVE')" },
    worksheet_state: { type: 'text', notNull: true, check: "worksheet_state IN ('READY','READY_WITH_PENDING_CROSSCHECK','FAILED')" },
    ready_slots: { type: 'integer', notNull: true },
    pending_crosscheck_slots: { type: 'integer', notNull: true },
    failed_slots: { type: 'integer', notNull: true },
    orchestrator_version: { type: 'text', notNull: true },
    router_version: { type: 'text', notNull: true },
    retry_context_version: { type: 'text', notNull: true },
    last_resort_version: { type: 'text', notNull: true },
    content_quality_version: { type: 'text', notNull: true },
    item_validator_version: { type: 'text', notNull: true },
    crosscheck_adapter_name: { type: 'text' },
    model_calls: { type: 'integer', notNull: true },
    retries: { type: 'integer', notNull: true },
    fallback_calls: { type: 'integer', notNull: true },
    last_resort_calls: { type: 'integer', notNull: true },
    input_tokens: { type: 'bigint', notNull: true },
    output_tokens: { type: 'bigint', notNull: true },
    estimated_cost_usd: { type: 'numeric(12,6)', notNull: true },
    actual_cost_usd: { type: 'numeric(12,6)', notNull: true },
    cost_ceiling_hit: { type: 'boolean', notNull: true },
    worksheet_latency_ms: { type: 'integer', notNull: true },
    cost_event_refs: { type: 'text[]', notNull: true, default: '{}' }, // ai_usage_events request ids
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('worksheet_generation_runs', 'generation_spec_id');
  pgm.createIndex('worksheet_generation_runs', 'child_ref');
  pgm.createIndex('worksheet_generation_runs', 'created_at');
  appendOnly(pgm, 'worksheet_generation_runs');

  pgm.createTable('worksheet_slots', {
    id: { type: 'text', primaryKey: true }, // `${runId}:${itemId}`
    run_id: { type: 'text', notNull: true, references: 'worksheet_generation_runs', onDelete: 'CASCADE' },
    generation_spec_id: { type: 'text', notNull: true },
    item_id: { type: 'text', notNull: true }, // pseudonymous slot id
    index: { type: 'integer', notNull: true },
    kernel_family: { type: 'text' },
    initial_role: { type: 'text', notNull: true },
    route_reason: { type: 'text', notNull: true },
    final_state: { type: 'text', notNull: true },
    last_resort_used: { type: 'boolean', notNull: true },
    crosscheck_required: { type: 'boolean', notNull: true },
    crosscheck_verdict: { type: 'text' },
    content_quality_codes: { type: 'text[]', notNull: true, default: '{}' },
    review_queue_id: { type: 'text' },
    answer_status: { type: 'text' },
    production_ready: { type: 'boolean', notNull: true },
    slot_latency_ms: { type: 'integer', notNull: true },
  });
  pgm.createIndex('worksheet_slots', 'run_id');
  pgm.createIndex('worksheet_slots', 'final_state');
  appendOnly(pgm, 'worksheet_slots');

  pgm.createTable('worksheet_slot_attempts', {
    id: { type: 'text', primaryKey: true }, // `${runId}:${itemId}:${attempt}`
    run_id: { type: 'text', notNull: true, references: 'worksheet_generation_runs', onDelete: 'CASCADE' },
    item_id: { type: 'text', notNull: true },
    attempt: { type: 'integer', notNull: true },
    model: { type: 'text', notNull: true },
    role: { type: 'text', notNull: true },
    step: { type: 'text', notNull: true },
    accepted: { type: 'boolean', notNull: true },
    failure_category: { type: 'text' },
    retry_reason: { type: 'text' },
    latency_ms: { type: 'integer', notNull: true },
  });
  pgm.createIndex('worksheet_slot_attempts', 'run_id');
  appendOnly(pgm, 'worksheet_slot_attempts');

  pgm.createTable('review_queue', {
    id: { type: 'text', primaryKey: true },
    generation_spec_id: { type: 'text', notNull: true },
    item_id: { type: 'text', notNull: true },
    child_ref: { type: 'text' }, // pseudonymous
    reason: { type: 'text', notNull: true },
    state: { type: 'text', notNull: true, default: 'PENDING', check: "state IN ('PENDING','APPROVED','REJECTED','REGENERATE_REQUESTED')" },
    prompt_snapshot: { type: 'text' }, // short-retention QA snapshot
    worked_solution_snapshot: { type: 'text' },
    detail: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    resolved_at: { type: 'timestamptz' },
    resolved_by: { type: 'text' }, // pseudonymous reviewer id
  });
  pgm.createIndex('review_queue', 'state');
  pgm.createIndex('review_queue', 'generation_spec_id');
  // review_queue is intentionally MUTABLE (one PENDING → resolved transition);
  // guard against a second resolution at the app layer.
};

exports.down = (pgm) => {
  pgm.dropTable('review_queue');
  pgm.dropTable('worksheet_slot_attempts');
  pgm.dropTable('worksheet_slots');
  pgm.dropTable('worksheet_generation_runs');
};
