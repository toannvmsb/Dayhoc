/* eslint-disable */
/**
 * AI cost telemetry v1.1 (Pricing/AI Cost/Routing v1.1 §10, §12).
 * See docs/implementation/15_AI_COST_AND_MODEL_ROUTING.md + Group A of doc 17.
 *
 * Additive: new nullable columns on `ai_usage_events` + a per-operation cost
 * rollup table. Nothing dropped. Updates the seeded plan budget thresholds to
 * v1.1 (in a config table, not code) via `plan_budget_config`.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- v1.1 telemetry columns (§10) — all nullable, additive ---
  pgm.addColumns('ai_usage_events', {
    model_version: { type: 'text' },
    price_config_effective_date: { type: 'date' },
    retry_count: { type: 'integer', notNull: true, default: 0 },
    escalated_from: { type: 'text' },
    generation_spec_id: { type: 'text' },
    learning_context_source: { type: 'text' },
    k_target: { type: 'text' },
    t_target: { type: 'text' },
  });
  pgm.createIndex('ai_usage_events', ['operation_type', 'created_at']);
  pgm.createIndex('ai_usage_events', 'generation_spec_id', {
    where: 'generation_spec_id IS NOT NULL',
  });

  // --- per-operation cost rollup for forecasting (§12) ---
  pgm.createTable('ai_operation_cost_rollup', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    period: { type: 'text', notNull: true }, // YYYY-MM
    plan: { type: 'text', notNull: true, check: "plan IN ('free','basic','plus','pro')" },
    operation_type: { type: 'text', notNull: true },
    grade: { type: 'integer' },
    k_bucket: { type: 'text' }, // K0-K1 | K2-K3 | K4-K5
    t_bucket: { type: 'text' }, // T1-T2 | T3 | T4-T5
    tier: { type: 'text' }, // standard | advanced
    event_count: { type: 'integer', notNull: true, default: 0 },
    total_cost_vnd: { type: 'bigint', notNull: true, default: 0 },
    retry_or_escalation_count: { type: 'integer', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('ai_operation_cost_rollup', 'ai_op_cost_rollup_uniq', {
    unique: ['period', 'plan', 'operation_type', 'grade', 'k_bucket', 't_bucket', 'tier'],
  });

  // --- plan budget config (§5) — v1.1 numbers, external config not code ---
  pgm.createTable('plan_budget_config', {
    plan: { type: 'text', primaryKey: true, check: "plan IN ('free','basic','plus','pro')" },
    price_vnd: { type: 'integer' }, // null for free
    ai_target_vnd: { type: 'integer', notNull: true },
    ai_operational_ceiling_vnd: { type: 'integer', notNull: true },
    absolute_boundary_vnd: { type: 'integer' }, // null for free
    effective_date: { type: 'date', notNull: true },
    source: { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.sql(`
    INSERT INTO plan_budget_config
      (plan, price_vnd, ai_target_vnd, ai_operational_ceiling_vnd, absolute_boundary_vnd, effective_date, source)
    VALUES
      ('free', NULL,   2000,  3000,  NULL,  '2026-09-01', 'pricing_guardrails_v1.1.yaml'),
      ('basic', 169000, 8000, 10000, 12250, '2026-09-01', 'pricing_guardrails_v1.1.yaml'),
      ('plus', 229000, 15000, 22000, 27250, '2026-09-01', 'pricing_guardrails_v1.1.yaml'),
      ('pro', 329000, 28000, 40000, 52250, '2026-09-01', 'pricing_guardrails_v1.1.yaml')
    ON CONFLICT (plan) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.dropTable('plan_budget_config');
  pgm.dropTable('ai_operation_cost_rollup');
  pgm.dropIndex('ai_usage_events', 'generation_spec_id', { ifExists: true });
  pgm.dropIndex('ai_usage_events', ['operation_type', 'created_at'], { ifExists: true });
  pgm.dropColumns('ai_usage_events', [
    'model_version',
    'price_config_effective_date',
    'retry_count',
    'escalated_from',
    'generation_spec_id',
    'learning_context_source',
    'k_target',
    't_target',
  ]);
};
