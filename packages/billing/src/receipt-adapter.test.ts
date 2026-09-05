import { describe, expect, it } from 'vitest';
import {
  BillingCredentialsRequiredError,
  MockReceiptValidationAdapter,
  NoopReceiptValidationAdapter,
  resolveReceiptValidationAdapter,
} from './receipt-adapter.js';

describe('P9 — receipt validation adapter', () => {
  it('Noop never validates, never throws, always says why', async () => {
    const r = await new NoopReceiptValidationAdapter().validate();
    expect(r.valid).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it('Mock validates a well-formed fake receipt and rejects a malformed one', async () => {
    const adapter = new MockReceiptValidationAdapter();
    const ok = await adapter.validate({ store: 'apple', receipt: 'mock:plus:txn_123:2026-06-01T00:00:00.000Z' });
    expect(ok).toMatchObject({ valid: true, plan: 'plus', storeTransactionId: 'txn_123', periodEnd: '2026-06-01T00:00:00.000Z' });

    const bad = await adapter.validate({ store: 'google', receipt: 'not-a-mock-receipt' });
    expect(bad.valid).toBe(false);
  });

  describe('resolveReceiptValidationAdapter', () => {
    it('defaults to noop for both stores — including production with no DZ_BILLING', () => {
      const { apple, google, kind } = resolveReceiptValidationAdapter({});
      expect(kind).toBe('noop');
      expect(apple.name).toBe('noop');
      expect(google.name).toBe('noop');
    });

    it('DZ_BILLING=mock opts both stores into the deterministic fake', () => {
      const { apple, google, kind } = resolveReceiptValidationAdapter({ DZ_BILLING: 'mock' });
      expect(kind).toBe('mock');
      expect(apple.name).toBe('mock');
      expect(google.name).toBe('mock');
    });

    it('DZ_BILLING=live throws BillingCredentialsRequiredError when store credentials are missing', () => {
      expect(() => resolveReceiptValidationAdapter({ DZ_BILLING: 'live' })).toThrow(BillingCredentialsRequiredError);
    });

    it('any other DZ_BILLING value stays noop (no accidental live/mock activation)', () => {
      expect(resolveReceiptValidationAdapter({ DZ_BILLING: 'something-else' }).kind).toBe('noop');
    });
  });
});
