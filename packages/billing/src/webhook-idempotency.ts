/**
 * Webhook idempotency (P9 — billing readiness).
 *
 * Both Apple (App Store Server Notifications V2) and Google (Real-time
 * Developer Notifications via Pub/Sub) redeliver webhooks at-least-once —
 * the same renewal/cancellation notification can and will arrive more than
 * once. Applying `applyBillingEvent` twice for the same underlying store
 * event must be a no-op, not a double-charge-equivalent state corruption.
 *
 * This module only decides "have I seen this event id"; persisting the seen
 * set is the caller's job (a small INSERT-only table, unique on event id —
 * see the `billing_webhook_events` migration). Kept here, not inline in
 * `production-api.ts`, so the decision rule itself — dedupe by
 * `(store, storeEventId)` — is unit-testable without a database.
 */

export interface WebhookEventKey {
  readonly store: 'apple' | 'google';
  readonly storeEventId: string;
}

export function webhookDedupeKey(k: WebhookEventKey): string {
  return `${k.store}:${k.storeEventId}`;
}

/** Pure check against an already-loaded set of previously-processed keys
 * (e.g. `SELECT dedupe_key FROM billing_webhook_events WHERE dedupe_key = $1`
 * mapped to a Set by the caller, or just that one query's row count). */
export function shouldProcessWebhookEvent(key: WebhookEventKey, alreadyProcessed: ReadonlySet<string>): boolean {
  return !alreadyProcessed.has(webhookDedupeKey(key));
}
