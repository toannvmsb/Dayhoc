/* eslint-disable */
/**
 * AI cost telemetry + pricing registry + plan budget ledger.
 * See docs/implementation/PRICING_AND_COST_GUARDRAILS.md
 * (source: Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2, §5, §7).
 *
 * - `ai_pricing_registry`  : effective-dated public model prices (external config,
 *                            never constants in domain logic — §10.6).
 * - `ai_usage_events`      : one row per AI/OCR call (§7). INSERT-only (trigger).
 * - `plan_budget_ledger`   : per-user per-month rollup for fast budget checks (§5).
 *                            Mutable rollup — the immutable history is `ai_usage_events`.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- pricing registry (effective-dated, external config) ---
  pgm.createTable('ai_pricing_registry', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    model: { type: 'text', notNull: true },
    provider: { type: 'text', notNull: true, check: "provider IN ('openai','anthropic','google')" },
    unit: { type: 'text', notNull: true, check: "unit IN ('per_million_tokens','per_1000_pages')" },
    input_per_million_usd: { type: 'numeric(12,6)' },
    output_per_million_usd: { type: 'numeric(12,6)' },
    pages_per_thousand_usd: { type: 'numeric(12,6)' },
    free_units: { type: 'integer' },
    effective_date: { type: 'date', notNull: true },
    source: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('ai_pricing_registry', ['model', 'effective_date']);

  // --- AI usage events (§7) — INSERT-only ---
  pgm.createTable('ai_usage_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_ref: { type: 'text', notNull: true }, // pseudonymous
    child_ref: { type: 'text' }, // pseudonymous
    plan: { type: 'text', notNull: true, check: "plan IN ('free','basic','plus','pro')" },
    operation_type: { type: 'text', notNull: true },
    provider: { type: 'text', notNull: true },
    model: { type: 'text', notNull: true },
    input_tokens: { type: 'integer' },
    cached_input_tokens: { type: 'integer' },
    output_tokens: { type: 'integer' },
    image_count: { type: 'integer' },
    ocr_pages: { type: 'integer' },
    estimated_cost_usd: { type: 'numeric(14,8)', notNull: true, default: 0 },
    estimated_cost_vnd: { type: 'integer', notNull: true, default: 0 },
    latency_ms: { type: 'integer', notNull: true, default: 0 },
    confidence: { type: 'numeric(5,4)' },
    escalation_reason: { type: 'text' },
    schema_valid: { type: 'boolean', notNull: true, default: true },
    request_id: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('ai_usage_events', ['plan', 'created_at']);
  pgm.createIndex('ai_usage_events', ['user_ref', 'created_at']);
  pgm.createIndex('ai_usage_events', ['child_ref', 'created_at']);

  // --- plan budget rollup (§5) — mutable, keyed by (user, month) ---
  pgm.createTable('plan_budget_ledger', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_ref: { type: 'text', notNull: true },
    billing_month: { type: 'text', notNull: true }, // YYYY-MM
    plan: { type: 'text', notNull: true, check: "plan IN ('free','basic','plus','pro')" },
    ai_spent_vnd: { type: 'integer', notNull: true, default: 0 },
    scan_pages_used: { type: 'integer', notNull: true, default: 0 },
    worksheets_used: { type: 'integer', notNull: true, default: 0 },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('plan_budget_ledger', 'plan_budget_ledger_user_month_uniq', {
    unique: ['user_ref', 'billing_month'],
  });

  // --- INSERT-only enforcement on the telemetry ledger ---
  pgm.sql(`
    CREATE TRIGGER ai_usage_events_no_update BEFORE UPDATE ON ai_usage_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER ai_usage_events_no_delete BEFORE DELETE ON ai_usage_events
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
  `);

  // --- seed the v1.0 published price table (§2) ---
  pgm.sql(`
    INSERT INTO ai_pricing_registry
      (model, provider, unit, input_per_million_usd, output_per_million_usd, pages_per_thousand_usd, free_units, effective_date, source)
    VALUES
      ('gpt-5.6-luna',  'openai',    'per_million_tokens', 0.20, 1.20, NULL, NULL, '2026-08-31', 'Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2'),
      ('gpt-5.6-terra', 'openai',    'per_million_tokens', 2.00, 12.00, NULL, NULL, '2026-08-31', 'Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2'),
      ('gpt-5.6-sol',   'openai',    'per_million_tokens', 4.00, 20.00, NULL, NULL, '2026-08-31', 'Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2'),
      ('claude-sonnet-5','anthropic','per_million_tokens', 2.00, 10.00, NULL, NULL, '2026-08-31', 'Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2'),
      ('google-document-ai-enterprise-ocr','google','per_1000_pages', NULL, NULL, 1.50, 1000, '2026-08-31', 'Pricing_AI_Cost_Guardrails_Model_Routing_v1.0 §2')
    ON CONFLICT DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS ai_usage_events_no_update ON ai_usage_events;`);
  pgm.sql(`DROP TRIGGER IF EXISTS ai_usage_events_no_delete ON ai_usage_events;`);
  pgm.dropTable('plan_budget_ledger');
  pgm.dropTable('ai_usage_events');
  pgm.dropTable('ai_pricing_registry');
};
