/* eslint-disable */
/**
 * CONTROLLED INTERNAL LIVE ROLLOUT (doc 69).
 *
 * LIVE generation is gated by BOTH `AI_GENERATION_MODE=LIVE` AND membership in
 * `internal_live_cohort` (pseudonymous family refs — never a raw id). A
 * server-side kill switch (`ai_generation_runtime.kill_switch`) halts all new
 * paid AI calls with NO redeploy. A daily spend ledger (`internal_live_spend`)
 * enforces operational caps and degrades safely on exhaustion. Wave-1 QA
 * sampling (`internal_live_qa_sample`) is short-retention, access-logged, and
 * excluded from analytics.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- allowlist: which families may receive LIVE generation ---------------
  pgm.createTable('internal_live_cohort', {
    family_ref: { type: 'text', primaryKey: true }, // sha256(familyId).slice(0,16) — pseudonymous
    wave: { type: 'integer', notNull: true, default: 1 },
    note: { type: 'text' },
    added_by: { type: 'text', notNull: true }, // pseudonymous admin ref
    added_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    removed_at: { type: 'timestamptz' }, // soft-remove keeps the audit trail
  });

  // --- runtime kill switch (mutable, single row, no redeploy to toggle) ----
  pgm.createTable('ai_generation_runtime', {
    id: { type: 'text', primaryKey: true, check: "id = 'singleton'" },
    kill_switch: { type: 'boolean', notNull: true, default: false },
    kill_reason: { type: 'text' },
    kill_source: { type: 'text' }, // 'manual' | 'safety-autostop'
    killed_by: { type: 'text' }, // pseudonymous ref
    killed_at: { type: 'timestamptz' },
    cleared_by: { type: 'text' },
    cleared_at: { type: 'timestamptz' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`INSERT INTO ai_generation_runtime (id) VALUES ('singleton')`);

  // --- daily operational spend ledger for INTERNAL LIVE -------------------
  pgm.createTable('internal_live_spend', {
    spend_date: { type: 'date', notNull: true },
    kind: { type: 'text', notNull: true, check: "kind IN ('generation','crosscheck')" },
    spent_usd: { type: 'numeric(12,6)', notNull: true, default: 0 },
    calls: { type: 'integer', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`ALTER TABLE internal_live_spend ADD PRIMARY KEY (spend_date, kind)`);

  // --- safety auto-stop audit trail -------------------------------------
  pgm.createTable('internal_live_safety_events', {
    id: { type: 'text', primaryKey: true },
    detected_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    severity: { type: 'text', notNull: true, check: "severity IN ('CRITICAL','WARNING')" },
    signal: { type: 'text', notNull: true },
    detail: { type: 'text', notNull: true },
    window_runs: { type: 'integer', notNull: true, default: 0 },
    kill_switch_activated: { type: 'boolean', notNull: true, default: false },
  });
  pgm.createIndex('internal_live_safety_events', 'detected_at');

  // --- LIVE serving: which completed LIVE runs became a child assignment ---
  // (worksheet_generation_runs is append-only; this mutable table records the
  // one-time SERVE transition so a run is never delivered twice.)
  pgm.createTable('worksheet_run_serving', {
    run_id: { type: 'text', primaryKey: true },
    child_ref: { type: 'text', notNull: true }, // pseudonymous — matched against the authenticated child
    generation_spec_id: { type: 'text', notNull: true },
    // the READY items, held ONLY until the next authenticated request turns them
    // into an assignment (then nulled). Same sensitivity as `assignment_items`;
    // purged on child deletion + on a 48h TTL if never claimed.
    items: { type: 'jsonb' },
    assignment_id: { type: 'uuid' }, // null until actually served
    state: { type: 'text', notNull: true, default: 'PENDING', check: "state IN ('PENDING','SERVED','SKIPPED')" },
    skip_reason: { type: 'text' },
    served_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('worksheet_run_serving', ['child_ref', 'state']);
  pgm.createIndex('worksheet_run_serving', 'created_at');

  // --- Wave-1 QA sampling: SHORT-RETENTION, access-logged, NOT analytics --
  pgm.createTable('internal_live_qa_sample', {
    id: { type: 'text', primaryKey: true },
    run_id: { type: 'text', notNull: true },
    generation_spec_id: { type: 'text', notNull: true },
    child_ref: { type: 'text' }, // pseudonymous
    item_id: { type: 'text', notNull: true },
    criticality: { type: 'text' },
    final_state: { type: 'text' },
    // short-retention QA snapshots — treated as operational review data, purged on schedule
    prompt_snapshot: { type: 'text' },
    worked_solution_snapshot: { type: 'text' },
    answer_snapshot: { type: 'text' },
    sampled_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    retention_until: { type: 'timestamptz', notNull: true },
    purged: { type: 'boolean', notNull: true, default: false },
    access_log: { type: 'jsonb', notNull: true, default: '[]' }, // [{ref, at}] — who opened this sample
  });
  pgm.createIndex('internal_live_qa_sample', 'retention_until');
  pgm.createIndex('internal_live_qa_sample', 'child_ref');
};

exports.down = (pgm) => {
  pgm.dropTable('worksheet_run_serving');
  pgm.dropTable('internal_live_qa_sample');
  pgm.dropTable('internal_live_safety_events');
  pgm.dropTable('internal_live_spend');
  pgm.dropTable('ai_generation_runtime');
  pgm.dropTable('internal_live_cohort');
};
