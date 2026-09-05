/**
 * Subscription plans (Pricing + AI Cost Guardrails v1.0 §1).
 *
 * These names are a stable vocabulary shared by billing, the AI budget engine
 * and cost telemetry. Prices and AI budgets live in configuration
 * (`@copilot/ai` pricing/budget registries), NOT here — this file is only the
 * enum so pure code can be plan-aware without importing money constants.
 */
export const PLANS = ['free', 'basic', 'plus', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export const PAID_PLANS = ['basic', 'plus', 'pro'] as const satisfies readonly Plan[];

export function isPaidPlan(plan: Plan): boolean {
  return plan !== 'free';
}

// --- subscription state machine (P9 — billing readiness) -------------------
//
// `family_subscriptions` today (M7) is deliberately MOCK: `plan` + a 3-value
// `status`, no store, no receipt, no idempotency. This section adds the
// STATE part of a real store-billing lifecycle as pure, deterministic
// functions — no I/O, no store SDK, no fetch — so it can be unit-tested and
// reviewed without ever touching a store credential. The actual store
// integration (verifying an Apple/Google receipt, calling their APIs) is a
// separate adapter (`@copilot/billing`); this is only "given a validated
// receipt/webhook fact, what should the row become".
//
// Entitlement stays server-authoritative: nothing here lets a client set its
// own plan — every transition is driven by a `BillingEvent` this module
// receives, never by a client-supplied `plan` field. Plan tier NEVER selects
// an AI model (see `@copilot/domain` entitlements.ts and `@copilot/ai`
// routing.ts) — this file only ever produces `SubscriptionRecord`s.

export const SUBSCRIPTION_STATUSES = [
  'active',
  'grace_period',
  'past_due',
  'cancelled',
  'expired',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Who last set this record. 'manual' = today's MOCK path (support/dev
 * tooling sets the plan directly); 'apple' / 'google' = a receipt-validated
 * store subscription; 'none' = default free tier, no subscription at all. */
export const BILLING_SOURCES = ['none', 'manual', 'apple', 'google'] as const;
export type BillingSource = (typeof BILLING_SOURCES)[number];

export interface SubscriptionRecord {
  readonly plan: Plan;
  readonly status: SubscriptionStatus;
  readonly source: BillingSource;
  /** Store's own subscription/transaction id — null for 'none'/'manual'. Used
   * to correlate renewal/cancellation webhooks to this record. */
  readonly storeTransactionId: string | null;
  readonly currentPeriodEnd: string | null; // ISO
  /** Set only while status === 'grace_period' — the store is retrying a
   * failed renewal payment; entitlement is kept until this passes. */
  readonly gracePeriodEnd: string | null; // ISO
  readonly autoRenew: boolean;
  readonly updatedAt: string; // ISO
}

export function freeSubscription(now: string): SubscriptionRecord {
  return {
    plan: 'free',
    status: 'active',
    source: 'none',
    storeTransactionId: null,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
    autoRenew: false,
    updatedAt: now,
  };
}

/** A fact about a subscription, already verified upstream (a validated store
 * receipt, or a support action) — this module never talks to a store itself. */
export type BillingEvent =
  | { readonly kind: 'purchased'; readonly plan: Plan; readonly source: BillingSource; readonly storeTransactionId: string | null; readonly periodEnd: string; readonly now: string }
  | { readonly kind: 'renewed'; readonly periodEnd: string; readonly now: string }
  | { readonly kind: 'entered_grace_period'; readonly graceEnd: string; readonly now: string }
  | { readonly kind: 'payment_recovered'; readonly periodEnd: string; readonly now: string }
  | { readonly kind: 'cancelled'; readonly now: string } // auto-renew turned off; stays entitled until currentPeriodEnd
  | { readonly kind: 'expired'; readonly now: string } // currentPeriodEnd (or grace) has passed with no recovery
  | { readonly kind: 'upgraded' | 'downgraded'; readonly plan: Plan; readonly periodEnd: string; readonly now: string };

/**
 * Pure state transition — the entire subscription lifecycle in one place so
 * it can be exhaustively tested without a store. Idempotency (not applying
 * the same webhook twice) is the CALLER's job (`@copilot/billing`'s
 * `WebhookIdempotencyGuard`) — this function only computes the next state
 * for an event that's already been decided to apply.
 */
export function applyBillingEvent(current: SubscriptionRecord, event: BillingEvent): SubscriptionRecord {
  switch (event.kind) {
    case 'purchased':
      return {
        plan: event.plan,
        status: 'active',
        source: event.source,
        storeTransactionId: event.storeTransactionId,
        currentPeriodEnd: event.periodEnd,
        gracePeriodEnd: null,
        autoRenew: true,
        updatedAt: event.now,
      };
    case 'renewed':
    case 'payment_recovered':
      return { ...current, status: 'active', currentPeriodEnd: event.periodEnd, gracePeriodEnd: null, updatedAt: event.now };
    case 'entered_grace_period':
      return { ...current, status: 'grace_period', gracePeriodEnd: event.graceEnd, updatedAt: event.now };
    case 'cancelled':
      return { ...current, status: 'active', autoRenew: false, updatedAt: event.now };
    case 'expired':
      return { ...freeSubscription(event.now), source: current.source, storeTransactionId: current.storeTransactionId };
    case 'upgraded':
    case 'downgraded':
      return { ...current, plan: event.plan, status: 'active', currentPeriodEnd: event.periodEnd, gracePeriodEnd: null, updatedAt: event.now };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/** Whether a record still unlocks its `plan`'s entitlements right now.
 * `grace_period` and a not-yet-auto-renewing `cancelled` both stay entitled
 * until their period actually ends — losing access on the FIRST missed
 * payment (rather than after the store's own retry window) would be a worse
 * experience than the cost of a few grace-period days, and matches how
 * Apple/Google themselves keep the app entitled through grace/cancellation. */
export function isEntitled(record: SubscriptionRecord, now: string): boolean {
  if (record.status === 'expired' || record.status === 'past_due') return false;
  if (record.plan === 'free') return true;
  if (record.status === 'grace_period') return record.gracePeriodEnd === null || now <= record.gracePeriodEnd;
  return record.currentPeriodEnd === null || now <= record.currentPeriodEnd;
}
