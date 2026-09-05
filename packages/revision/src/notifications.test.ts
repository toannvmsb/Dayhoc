import { describe, expect, it, vi } from 'vitest';
import {
  CompositeNotificationProvider,
  ExpoPushProvider,
  ResendEmailAdapter,
  makeNotification,
  resolveNotificationProvider,
  type UserContactLookup,
} from './notifications.js';

const TRIGGER = { targetUserId: 'u1', at: '2026-01-01T00:00:00.000Z', newId: () => '1' };

function fakeFetch(ok: boolean, jsonBody: unknown = {}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(jsonBody),
  }) as unknown as typeof fetch;
}

describe('P7 — real notification providers', () => {
  describe('ResendEmailAdapter', () => {
    it('sends via Resend when the user has an email on file', async () => {
      const contacts: UserContactLookup = { getEmail: async () => 'parent@example.com', getExpoPushToken: async () => null };
      const fetchImpl = fakeFetch(true);
      const adapter = new ResendEmailAdapter({ apiKey: 'k', fromEmail: 'DạyZi <no-reply@dayzi.vn>', appName: 'DạyZi', contacts, fetchImpl });
      const r = await adapter.send('u1', makeNotification('plan_ready', TRIGGER));
      expect(r.delivered).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer k' }) }),
      );
    });

    it('skips (not delivered, no throw) when the user has no email', async () => {
      const contacts: UserContactLookup = { getEmail: async () => null, getExpoPushToken: async () => null };
      const fetchImpl = fakeFetch(true);
      const adapter = new ResendEmailAdapter({ apiKey: 'k', fromEmail: 'x', appName: 'DạyZi', contacts, fetchImpl });
      const r = await adapter.send('u1', makeNotification('plan_ready', TRIGGER));
      expect(r.delivered).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('never throws on a network failure', async () => {
      const contacts: UserContactLookup = { getEmail: async () => 'a@b.com', getExpoPushToken: async () => null };
      const fetchImpl = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      const adapter = new ResendEmailAdapter({ apiKey: 'k', fromEmail: 'x', appName: 'DạyZi', contacts, fetchImpl });
      await expect(adapter.send('u1', makeNotification('plan_ready', TRIGGER))).resolves.toEqual({ delivered: false });
    });
  });

  describe('ExpoPushProvider', () => {
    it('sends when a push token is on file and Expo reports ok', async () => {
      const contacts: UserContactLookup = { getEmail: async () => null, getExpoPushToken: async () => 'ExponentPushToken[xyz]' };
      const fetchImpl = fakeFetch(true, { data: [{ status: 'ok' }] });
      const adapter = new ExpoPushProvider({ contacts, fetchImpl });
      const r = await adapter.send('u1', makeNotification('gap_detected', TRIGGER));
      expect(r.delivered).toBe(true);
    });

    it('reports not-delivered when Expo reports an error status', async () => {
      const contacts: UserContactLookup = { getEmail: async () => null, getExpoPushToken: async () => 'tok' };
      const fetchImpl = fakeFetch(true, { data: [{ status: 'error' }] });
      const adapter = new ExpoPushProvider({ contacts, fetchImpl });
      const r = await adapter.send('u1', makeNotification('gap_detected', TRIGGER));
      expect(r.delivered).toBe(false);
    });

    it('skips when there is no push token', async () => {
      const contacts: UserContactLookup = { getEmail: async () => null, getExpoPushToken: async () => null };
      const fetchImpl = fakeFetch(true);
      const adapter = new ExpoPushProvider({ contacts, fetchImpl });
      const r = await adapter.send('u1', makeNotification('gap_detected', TRIGGER));
      expect(r.delivered).toBe(false);
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe('CompositeNotificationProvider', () => {
    it('is delivered if ANY channel succeeds', async () => {
      const failing = { name: 'a', send: async () => ({ delivered: false }) };
      const succeeding = { name: 'b', send: async () => ({ delivered: true }) };
      const composite = new CompositeNotificationProvider([failing, succeeding]);
      const r = await composite.send('u1', makeNotification('plan_ready', TRIGGER));
      expect(r.delivered).toBe(true);
      expect(composite.name).toBe('composite(a+b)');
    });

    it('is not delivered if every channel fails', async () => {
      const failing = { name: 'a', send: async () => ({ delivered: false }) };
      const composite = new CompositeNotificationProvider([failing, failing]);
      expect((await composite.send('u1', makeNotification('plan_ready', TRIGGER))).delivered).toBe(false);
    });
  });

  describe('resolveNotificationProvider', () => {
    const contacts: UserContactLookup = { getEmail: async () => 'a@b.com', getExpoPushToken: async () => 'tok' };

    it('defaults to noop with no contacts lookup, regardless of other env', () => {
      expect(resolveNotificationProvider({ RESEND_API_KEY: 'k', NOTIFICATION_FROM_EMAIL: 'x' }).kind).toBe('noop');
    });

    it('defaults to noop with contacts but no channel configured', () => {
      expect(resolveNotificationProvider({}, contacts).kind).toBe('noop');
    });

    it('activates email only when RESEND_API_KEY + NOTIFICATION_FROM_EMAIL are both set', () => {
      expect(resolveNotificationProvider({ RESEND_API_KEY: 'k' }, contacts).kind).toBe('noop'); // missing from-email
      expect(resolveNotificationProvider({ RESEND_API_KEY: 'k', NOTIFICATION_FROM_EMAIL: 'x' }, contacts).kind).toBe('email');
    });

    it('activates push only when DZ_PUSH_NOTIFICATIONS=1', () => {
      expect(resolveNotificationProvider({ DZ_PUSH_NOTIFICATIONS: '1' }, contacts).kind).toBe('push');
      expect(resolveNotificationProvider({ DZ_PUSH_NOTIFICATIONS: 'true' }, contacts).kind).toBe('noop'); // not exactly '1'
    });

    it('activates both as a composite when both are configured', () => {
      const r = resolveNotificationProvider(
        { RESEND_API_KEY: 'k', NOTIFICATION_FROM_EMAIL: 'x', DZ_PUSH_NOTIFICATIONS: '1' },
        contacts,
      );
      expect(r.kind).toBe('email+push');
      expect(r.adapter.name).toBe('composite(resend+expo-push)');
    });

    it('DZ_NOTIFICATIONS=console always wins, even with real channels configured', () => {
      const r = resolveNotificationProvider(
        { DZ_NOTIFICATIONS: 'console', RESEND_API_KEY: 'k', NOTIFICATION_FROM_EMAIL: 'x' },
        contacts,
      );
      expect(r.kind).toBe('console');
    });
  });
});
