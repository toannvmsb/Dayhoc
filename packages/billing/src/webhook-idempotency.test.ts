import { describe, expect, it } from 'vitest';
import { shouldProcessWebhookEvent, webhookDedupeKey } from './webhook-idempotency.js';

describe('P9 — webhook idempotency', () => {
  it('processes an unseen event', () => {
    expect(shouldProcessWebhookEvent({ store: 'apple', storeEventId: 'evt_1' }, new Set())).toBe(true);
  });

  it('skips a redelivered event with the same (store, storeEventId)', () => {
    const seen = new Set([webhookDedupeKey({ store: 'apple', storeEventId: 'evt_1' })]);
    expect(shouldProcessWebhookEvent({ store: 'apple', storeEventId: 'evt_1' }, seen)).toBe(false);
  });

  it('does not confuse the same event id across the two stores', () => {
    const seen = new Set([webhookDedupeKey({ store: 'apple', storeEventId: 'evt_1' })]);
    expect(shouldProcessWebhookEvent({ store: 'google', storeEventId: 'evt_1' }, seen)).toBe(true);
  });
});
