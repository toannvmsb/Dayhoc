/* eslint-disable */
/**
 * P9 — billing readiness (productionization phase). Additive + reversible.
 *
 *   - `family_subscriptions` gains the columns a real store subscription
 *     needs: WHO issued it (`source`: none/manual/apple/google), the store's
 *     own id for correlating renewal/cancellation webhooks
 *     (`store_transaction_id`), the grace-period end while a renewal payment
 *     is retrying (`grace_period_end`), and whether it will renew
 *     (`auto_renew`). `status` gains 'grace_period' and 'expired' to match
 *     `@copilot/domain`'s `SubscriptionStatus` state machine.
 *   - `billing_webhook_events` — INSERT-only idempotency ledger. Apple/Google
 *     redeliver webhooks at-least-once; a row here (unique on
 *     (store, store_event_id)) is how `@copilot/billing`'s
 *     `shouldProcessWebhookEvent` check gets its "already seen" set without
 *     re-running `applyBillingEvent` twice for the same store notification.
 *
 * Still MOCK: no code path in this migration or its callers can talk to
 * Apple/Google or charge a card. `source` defaults to 'none'/'manual' exactly
 * as before; a family's plan is unaffected until a real receipt/webhook is
 * validated (`@copilot/billing`'s Apple/Google adapters throw until real
 * credentials + integration code exist).
 *
 * @type {import('node-pg-migrate').ColumnDefinitions | undefined}
 */
exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE family_subscriptions
      DROP CONSTRAINT IF EXISTS family_subscriptions_status_check;
    ALTER TABLE family_subscriptions
      ADD CONSTRAINT family_subscriptions_status_check
      CHECK (status IN ('active','past_due','cancelled','grace_period','expired'));
  `);

  pgm.addColumns('family_subscriptions', {
    source: {
      type: 'text',
      notNull: true,
      default: 'manual',
      check: "source IN ('none','manual','apple','google')",
    },
    store_transaction_id: { type: 'text' },
    grace_period_end: { type: 'timestamptz' },
    auto_renew: { type: 'boolean', notNull: true, default: false },
  });

  pgm.createTable('billing_webhook_events', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    store: { type: 'text', notNull: true, check: "store IN ('apple','google')" },
    store_event_id: { type: 'text', notNull: true },
    received_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    processed_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('billing_webhook_events', 'billing_webhook_events_dedupe_uq', {
    unique: ['store', 'store_event_id'],
  });

  // This table postdates 1758153600000_rls_deny_by_default.js's deny-all
  // sweep — enable RLS here so it isn't left as the one un-covered table.
  pgm.sql(`ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;`);
};

exports.down = (pgm) => {
  pgm.dropTable('billing_webhook_events');
  pgm.dropColumns('family_subscriptions', ['source', 'store_transaction_id', 'grace_period_end', 'auto_renew']);
  pgm.sql(`
    ALTER TABLE family_subscriptions
      DROP CONSTRAINT IF EXISTS family_subscriptions_status_check;
    ALTER TABLE family_subscriptions
      ADD CONSTRAINT family_subscriptions_status_check
      CHECK (status IN ('active','past_due','cancelled'));
  `);
};
