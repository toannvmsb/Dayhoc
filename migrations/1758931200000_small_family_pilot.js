/* eslint-disable */
/**
 * SMALL FAMILY PILOT (doc 70). Reuses `internal_live_cohort` for LIVE
 * eligibility — adds only pilot metadata, a lightweight parent-feedback ledger,
 * and a pseudonymous product-activity event log for the pilot funnel /
 * retention. Consent stays in the existing `consent_records` table.
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  // pilot vs internal marker on the existing allowlist (auth logic unchanged).
  pgm.addColumns('internal_live_cohort', {
    kind: { type: 'text', notNull: true, default: 'internal', check: "kind IN ('internal','pilot')" },
    // a pilot family must have guardian consent on file for the child before LIVE
    // content is served — this flag just makes the requirement explicit per row.
    consent_required: { type: 'boolean', notNull: true, default: false },
  });

  // append-only parent feedback on a worksheet / day plan.
  pgm.createTable('parent_feedback', {
    id: { type: 'text', primaryKey: true },
    child_ref: { type: 'text', notNull: true }, // pseudonymous
    family_ref: { type: 'text' },
    assignment_id: { type: 'uuid' },
    generation_spec_id: { type: 'text' },
    verdict: {
      type: 'text',
      notNull: true,
      check: "verdict IN ('SUITABLE','TOO_EASY','TOO_HARD','WRONG_CURRENT_TOPIC','ALREADY_MASTERED','CONTENT_QUALITY_ISSUE','OTHER')",
    },
    note: { type: 'text' },
    // a soft hypothesis for later validation — NEVER auto-applied to mastery.
    hypothesis: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('parent_feedback', ['child_ref', 'created_at']);
  pgm.createIndex('parent_feedback', 'verdict');
  pgm.sql(`
    CREATE TRIGGER parent_feedback_no_update BEFORE UPDATE ON parent_feedback
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
    CREATE TRIGGER parent_feedback_no_delete BEFORE DELETE ON parent_feedback
      FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
  `);

  // pseudonymous product-activity log for the pilot funnel + D1/D3/D7 retention.
  // NO child question / answer / evidence content — event name + pseudonymous
  // refs + small operational meta only.
  pgm.createTable('pilot_activity', {
    id: { type: 'text', primaryKey: true },
    family_ref: { type: 'text', notNull: true },
    child_ref: { type: 'text' },
    actor: { type: 'text', notNull: true, check: "actor IN ('PARENT','STUDENT','SYSTEM')" },
    event: { type: 'text', notNull: true },
    meta: { type: 'jsonb', notNull: true, default: '{}' },
    at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('pilot_activity', ['family_ref', 'at']);
  pgm.createIndex('pilot_activity', ['event', 'at']);
};

exports.down = (pgm) => {
  pgm.dropTable('pilot_activity');
  pgm.dropTable('parent_feedback');
  pgm.dropColumns('internal_live_cohort', ['kind', 'consent_required']);
};
