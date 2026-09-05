import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DevAuthAdapter, SupabaseAuthAdapter } from './supabase-auth-adapter.js';

const SECRET = 'test-jwt-secret';

function b64url(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/** Build a real-shaped HS256 JWT signed with SECRET, for verifyToken tests. */
function makeToken(claims: Record<string, unknown>, secret = SECRET): string {
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url(claims);
  const sig = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/**
 * Build a real-shaped ES256 JWT (like Supabase's current default "JWT
 * Signing Keys" — ECC P-256) plus the JWKS response that would let a
 * verifier check it, for the 2026-09-05 ES256 regression tests below.
 */
function makeEs256Token(claims: Record<string, unknown>, kid = 'test-kid-1') {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const header = b64url({ alg: 'ES256', typ: 'JWT', kid });
  const payload = b64url(claims);
  const signingInput = `${header}.${payload}`;
  const sig = cryptoSign('sha256', Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256' };
  return { token: `${signingInput}.${sig}`, jwksBody: { keys: [jwk] } };
}

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as typeof fetch;
}

describe('P1-P2 — SupabaseAuthAdapter', () => {
  const now = Math.floor(Date.now() / 1000);

  describe('verifyToken', () => {
    it('accepts a validly-signed, unexpired token', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      const token = makeToken({ sub: 'user-1', email: 'a@b.com', aud: 'authenticated', exp: now + 3600 });
      const identity = await adapter.verifyToken(token);
      expect(identity).toEqual({ authUserId: 'user-1', email: 'a@b.com', phone: undefined });
    });

    it('rejects a token signed with the wrong secret', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      const token = makeToken({ sub: 'user-1', aud: 'authenticated', exp: now + 3600 }, 'wrong-secret');
      expect(await adapter.verifyToken(token)).toBeNull();
    });

    it('rejects an expired token', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      const token = makeToken({ sub: 'user-1', aud: 'authenticated', exp: now - 3600 });
      expect(await adapter.verifyToken(token)).toBeNull();
    });

    it('rejects a non-JWT-shaped bearer (e.g. a raw user id, the exact regression this whole file guards against)', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      expect(await adapter.verifyToken('550e8400-e29b-41d4-a716-446655440000')).toBeNull();
    });

    it('rejects an unsupported alg (fail closed)', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      const header = b64url({ alg: 'none', typ: 'JWT' });
      const payload = b64url({ sub: 'user-1', aud: 'authenticated', exp: now + 3600 });
      expect(await adapter.verifyToken(`${header}.${payload}.`)).toBeNull();
    });
  });

  describe('verifyToken — ES256 via JWKS (the 2026-09-05 regression fix)', () => {
    it('accepts a validly-signed ES256 token, fetching the public key from JWKS by kid', async () => {
      const { token, jwksBody } = makeEs256Token({
        sub: 'user-es256',
        email: 'es@b.com',
        aud: 'authenticated',
        exp: now + 3600,
      });
      const fetchImpl = fakeFetch(200, jwksBody);
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET, fetchImpl });
      const identity = await adapter.verifyToken(token);
      expect(identity).toEqual({ authUserId: 'user-es256', email: 'es@b.com', phone: undefined });
      expect(fetchImpl).toHaveBeenCalledWith('https://x.supabase.co/auth/v1/.well-known/jwks.json');
    });

    it('rejects an ES256 token signed by a key not in the JWKS (wrong keypair)', async () => {
      const { jwksBody } = makeEs256Token({ sub: 'user-a', aud: 'authenticated', exp: now + 3600 }, 'kid-a');
      // token signed by a DIFFERENT keypair, but claiming the same kid that's in the (unrelated) JWKS
      const { token: forgedToken } = makeEs256Token(
        { sub: 'user-a', aud: 'authenticated', exp: now + 3600 },
        'kid-a',
      );
      const fetchImpl = fakeFetch(200, jwksBody); // JWKS only has the FIRST keypair's public key
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET, fetchImpl });
      expect(await adapter.verifyToken(forgedToken)).toBeNull();
    });

    it('refetches the JWKS once when the kid is not in the cache (covers key rotation)', async () => {
      const { token, jwksBody } = makeEs256Token(
        { sub: 'user-rotated', aud: 'authenticated', exp: now + 3600 },
        'kid-new',
      );
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ keys: [] }) }) // stale cache, miss
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(jwksBody) }); // refetch, hit
      const adapter = new SupabaseAuthAdapter({
        supabaseUrl: 'https://x.supabase.co',
        jwtSecret: SECRET,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const identity = await adapter.verifyToken(token);
      expect(identity?.authUserId).toBe('user-rotated');
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
  });

  describe('createUser', () => {
    it('calls the admin API and returns the new user id', async () => {
      const fetchImpl = fakeFetch(200, { id: 'new-user-id' });
      const adapter = new SupabaseAuthAdapter({
        supabaseUrl: 'https://x.supabase.co',
        jwtSecret: SECRET,
        serviceRoleKey: 'srk',
        fetchImpl,
      });
      const id = await adapter.createUser({ email: 'a@b.com', password: 'password123' });
      expect(id).toBe('new-user-id');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://x.supabase.co/auth/v1/admin/users',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws without a serviceRoleKey', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      await expect(adapter.createUser({ email: 'a@b.com', password: 'password123' })).rejects.toThrow(
        'serviceRoleKey',
      );
    });
  });

  describe('signInWithPassword — the real regression fix (2026-09-05)', () => {
    it('returns a real access_token from the password grant endpoint', async () => {
      const fetchImpl = fakeFetch(200, { access_token: 'a.real.jwt', refresh_token: 'r' });
      const adapter = new SupabaseAuthAdapter({
        supabaseUrl: 'https://x.supabase.co',
        jwtSecret: SECRET,
        serviceRoleKey: 'srk',
        fetchImpl,
      });
      const bearer = await adapter.signInWithPassword({ email: 'a@b.com', password: 'password123' });
      expect(bearer).toBe('a.real.jwt');
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://x.supabase.co/auth/v1/token?grant_type=password',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('throws with the store status on a failed sign-in (wrong password)', async () => {
      const fetchImpl = fakeFetch(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      const adapter = new SupabaseAuthAdapter({
        supabaseUrl: 'https://x.supabase.co',
        jwtSecret: SECRET,
        serviceRoleKey: 'srk',
        fetchImpl,
      });
      await expect(adapter.signInWithPassword({ email: 'a@b.com', password: 'wrong' })).rejects.toThrow('400');
    });

    it('throws without a serviceRoleKey (used as the apikey header)', async () => {
      const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
      await expect(adapter.signInWithPassword({ email: 'a@b.com', password: 'password123' })).rejects.toThrow(
        'serviceRoleKey',
      );
    });
  });

  describe('DevAuthAdapter (unchanged — dev/in-memory pilot-testing shortcut)', () => {
    it('createUser mints a devauth_ id verifyToken then accepts as-is', async () => {
      const adapter = new DevAuthAdapter();
      const id = await adapter.createUser({ email: 'a@b.com', password: 'password123' });
      expect(id).toMatch(/^devauth_/);
      expect(await adapter.verifyToken(id)).toEqual({ authUserId: id, email: undefined, phone: undefined });
    });
  });
});
