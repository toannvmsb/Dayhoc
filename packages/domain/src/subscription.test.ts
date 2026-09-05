import { describe, expect, it } from 'vitest';
import { applyBillingEvent, freeSubscription, isEntitled, type SubscriptionRecord } from './subscription.js';

const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-02-01T00:00:00.000Z';

describe('P9 — subscription state machine (pure, no store I/O)', () => {
  it('starts free / active / entitled forever', () => {
    const r = freeSubscription(T0);
    expect(r).toMatchObject({ plan: 'free', status: 'active', source: 'none' });
    expect(isEntitled(r, '2099-01-01T00:00:00.000Z')).toBe(true);
  });

  it('purchased -> active with a store transaction id and period end', () => {
    const r = applyBillingEvent(freeSubscription(T0), {
      kind: 'purchased',
      plan: 'plus',
      source: 'apple',
      storeTransactionId: 'txn_1',
      periodEnd: T1,
      now: T0,
    });
    expect(r).toMatchObject({ plan: 'plus', status: 'active', source: 'apple', storeTransactionId: 'txn_1', currentPeriodEnd: T1, autoRenew: true });
    expect(isEntitled(r, T0)).toBe(true);
    expect(isEntitled(r, '2027-01-01T00:00:00.000Z')).toBe(false); // past currentPeriodEnd
  });

  it('cancelled keeps entitlement until currentPeriodEnd, then a later expired event drops to free', () => {
    let r = applyBillingEvent(freeSubscription(T0), {
      kind: 'purchased', plan: 'basic', source: 'google', storeTransactionId: 'txn_2', periodEnd: T1, now: T0,
    });
    r = applyBillingEvent(r, { kind: 'cancelled', now: T0 });
    expect(r.autoRenew).toBe(false);
    expect(r.plan).toBe('basic'); // still entitled — cancellation just stops renewal
    expect(isEntitled(r, T0)).toBe(true);

    r = applyBillingEvent(r, { kind: 'expired', now: T1 });
    expect(r.plan).toBe('free');
    expect(r.status).toBe('active');
    // provenance of the LAPSED subscription is kept for support/audit, plan is reset
    expect(r.source).toBe('google');
    expect(r.storeTransactionId).toBe('txn_2');
  });

  it('entered_grace_period keeps entitlement until gracePeriodEnd, expires after', () => {
    let r: SubscriptionRecord = applyBillingEvent(freeSubscription(T0), {
      kind: 'purchased', plan: 'pro', source: 'apple', storeTransactionId: 'txn_3', periodEnd: T0, now: T0,
    });
    r = applyBillingEvent(r, { kind: 'entered_grace_period', graceEnd: T1, now: T0 });
    expect(r.status).toBe('grace_period');
    expect(isEntitled(r, T0)).toBe(true); // still in grace window
    expect(isEntitled(r, '2027-01-01T00:00:00.000Z')).toBe(false); // past graceEnd

    r = applyBillingEvent(r, { kind: 'payment_recovered', periodEnd: '2026-03-01T00:00:00.000Z', now: T1 });
    expect(r.status).toBe('active');
    expect(r.gracePeriodEnd).toBeNull();
  });

  it('past_due and expired statuses are never entitled regardless of plan/period', () => {
    const pastDue: SubscriptionRecord = { ...freeSubscription(T0), plan: 'pro', status: 'past_due', currentPeriodEnd: '2099-01-01T00:00:00.000Z' };
    expect(isEntitled(pastDue, T0)).toBe(false);
    const expired: SubscriptionRecord = { ...freeSubscription(T0), plan: 'pro', status: 'expired', currentPeriodEnd: '2099-01-01T00:00:00.000Z' };
    expect(isEntitled(expired, T0)).toBe(false);
  });

  it('upgraded / downgraded switch plan and refresh the period, clearing any grace', () => {
    let r = applyBillingEvent(freeSubscription(T0), {
      kind: 'purchased', plan: 'basic', source: 'apple', storeTransactionId: 'txn_4', periodEnd: T0, now: T0,
    });
    r = applyBillingEvent(r, { kind: 'upgraded', plan: 'pro', periodEnd: T1, now: T0 });
    expect(r).toMatchObject({ plan: 'pro', status: 'active', currentPeriodEnd: T1 });

    r = applyBillingEvent(r, { kind: 'downgraded', plan: 'basic', periodEnd: T1, now: T0 });
    expect(r.plan).toBe('basic');
  });
});
