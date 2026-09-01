/* eslint-disable */
/**
 * Cost telemetry: ACTUAL vs ESTIMATED (doc 14 C4.1 §12) + target-selector
 * provenance (§13). Additive, nullable columns only.
 *
 * - `ai_usage_events.actual_cost_usd/vnd` — computed from the provider response
 *   after the call. `estimated_cost_*` stays the forecast; `actual_cost_*` is
 *   the accounting source of truth (null until the call returns; mock → 0).
 * - `generation_specs.target_selector_version` — which deterministic target
 *   selector produced the spec's typed targets.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('ai_usage_events', {
    actual_cost_usd: { type: 'numeric(14,8)' }, // null until the call returns
    actual_cost_vnd: { type: 'integer' },
  });
  pgm.addColumns('generation_specs', {
    target_selector_version: { type: 'text', notNull: true, default: 'unversioned' },
  });
  pgm.alterColumn('generation_specs', 'target_selector_version', { default: null });
};

exports.down = (pgm) => {
  pgm.dropColumns('generation_specs', ['target_selector_version']);
  pgm.dropColumns('ai_usage_events', ['actual_cost_usd', 'actual_cost_vnd']);
};
