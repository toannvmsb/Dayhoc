/* eslint-disable */
/**
 * Privacy & child-data foundation (anh's decision P-05).
 * See docs/implementation/PRIVACY_ARCHITECTURE.md.
 *
 * Adds: child credentials + quick-access PIN, versioned/auditable consent ledger,
 * AI provider compliance registry, data processing inventory, deletion-workflow
 * log, data-subject-rights request log, and upload retention columns.
 *
 * consent_records / deletion_jobs / rights_requests are append-only (triggers).
 * The child-erasure workflow suspends those triggers for its own transaction.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // --- child auth (Privacy Architecture §2) ---
  pgm.createTable('child_credentials', {
    child_id: { type: 'uuid', primaryKey: true, references: 'child_profiles', onDelete: 'CASCADE' },
    username: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    must_change_password: { type: 'boolean', notNull: true, default: true },
    password_updated_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('child_quick_access', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    pin_hash: { type: 'text', notNull: true },
    device_ref: { type: 'text' },
    scope: { type: 'text', notNull: true, default: 'assigned_work', check: "scope = 'assigned_work'" },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    revoked_at: { type: 'timestamptz' },
  });

  pgm.addColumns('child_profiles', {
    deletion_state: {
      type: 'text',
      notNull: true,
      default: 'active',
      check: "deletion_state IN ('active','deletion_requested','deleted')",
    },
  });

  // --- consent ledger (append-only) ---
  pgm.createTable('consent_records', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true, references: 'child_profiles', onDelete: 'CASCADE' },
    granted_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'RESTRICT' },
    relationship: { type: 'text', notNull: true, default: 'parent' },
    data_categories: { type: 'jsonb', notNull: true },
    purpose: { type: 'text', notNull: true },
    processor: { type: 'text', notNull: true },
    cross_border: { type: 'boolean', notNull: true, default: false },
    destination_region: { type: 'text' },
    policy_version: { type: 'text', notNull: true },
    consent_text_version: { type: 'text', notNull: true },
    method: { type: 'text', notNull: true },
    accepted_at: { type: 'timestamptz', notNull: true },
    withdrawn_at: { type: 'timestamptz' },
  });
  pgm.createIndex('consent_records', ['child_id', 'purpose', 'processor']);

  // --- AI provider compliance registry ---
  pgm.createTable('ai_provider_registry', {
    provider: { type: 'text', primaryKey: true },
    processing_region: { type: 'text', notNull: true },
    cross_border: { type: 'boolean', notNull: true },
    data_categories_allowed: { type: 'jsonb', notNull: true },
    provider_retention: { type: 'text', notNull: true },
    training_allowed: { type: 'boolean', notNull: true, default: false, check: 'training_allowed = false' },
    dpa_status: { type: 'text', notNull: true, check: "dpa_status IN ('signed','pending','not_applicable')" },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- data processing inventory (for a future DPIA) ---
  pgm.createTable('data_processing_inventory', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    data_category: { type: 'text', notNull: true },
    purpose: { type: 'text', notNull: true },
    processor: { type: 'text', notNull: true },
    legal_basis: { type: 'text', notNull: true },
    retention: { type: 'text', notNull: true },
    cross_border: { type: 'boolean', notNull: true, default: false },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  // --- deletion workflow + rights request logs (append-only) ---
  pgm.createTable('deletion_jobs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true },
    requested_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'SET NULL' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    state: { type: 'text', notNull: true, default: 'requested' },
    steps_completed: { type: 'jsonb', notNull: true, default: '[]' },
    completed_at: { type: 'timestamptz' },
    audit_ref: { type: 'text' },
  });

  pgm.createTable('rights_requests', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    child_id: { type: 'uuid', notNull: true },
    requested_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'SET NULL' },
    kind: {
      type: 'text',
      notNull: true,
      check:
        "kind IN ('export','delete_uploads','delete_history','delete_profile','withdraw_consent','stop_processing')",
    },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    fulfilled_at: { type: 'timestamptz' },
    artifact_ref: { type: 'text' },
  });

  // --- upload retention (Privacy Architecture §6: raw schoolwork default 30d) ---
  pgm.addColumns('uploads', {
    retention_expires_at: { type: 'timestamptz', notNull: true, default: pgm.func("now() + interval '30 days'") },
    purged_at: { type: 'timestamptz' },
  });

  // --- append-only enforcement on the new ⊕ tables ---
  for (const table of ['consent_records', 'deletion_jobs', 'rights_requests']) {
    pgm.sql(`
      CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
      CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    `);
  }

  // seed the internal processor + a placeholder for the mock provider
  pgm.sql(`
    INSERT INTO ai_provider_registry
      (provider, processing_region, cross_border, data_categories_allowed, provider_retention, training_allowed, dpa_status)
    VALUES
      ('internal', 'vn', false, '["profile_context","raw_schoolwork","learning_activity","derived_state","ai_insights"]', 'life of data', false, 'not_applicable'),
      ('mock',     'local', false, '["raw_schoolwork","learning_activity","ai_insights"]', 'none', false, 'not_applicable')
    ON CONFLICT (provider) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  for (const table of ['consent_records', 'deletion_jobs', 'rights_requests']) {
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_update ON ${table};`);
    pgm.sql(`DROP TRIGGER IF EXISTS ${table}_no_delete ON ${table};`);
  }
  pgm.dropColumns('uploads', ['retention_expires_at', 'purged_at']);
  pgm.dropTable('rights_requests');
  pgm.dropTable('deletion_jobs');
  pgm.dropTable('data_processing_inventory');
  pgm.dropTable('ai_provider_registry');
  pgm.dropTable('consent_records');
  pgm.dropColumns('child_profiles', ['deletion_state']);
  pgm.dropTable('child_quick_access');
  pgm.dropTable('child_credentials');
};
