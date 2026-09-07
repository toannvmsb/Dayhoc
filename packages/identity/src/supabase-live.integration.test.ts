import { afterAll, describe, expect, it } from 'vitest';
import { SupabaseAuthAdapter } from './supabase-auth-adapter.js';

/**
 * doc 67 §D3 — real Supabase Auth round-trip against the staging project.
 * Gated on `RUN_LIVE_SUPABASE=1` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
 * Creates a throwaway user, signs in for a real JWT, verifies it via JWKS,
 * then hard-deletes the user.
 */
const LIVE =
  process.env.RUN_LIVE_SUPABASE === '1' &&
  !!process.env.SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.SUPABASE_JWT_SECRET;

const URL_ = process.env.SUPABASE_URL ?? '';
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

describe.skipIf(!LIVE)('doc 67 §D3 — Supabase Auth (staging, live)', () => {
  const email = `d3-auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@dayzi-staging.test`;
  const password = `Stg!${Math.random().toString(36).slice(2, 12)}A9`;
  let userId = '';

  afterAll(async () => {
    if (!userId) return;
    await fetch(`${URL_}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { apikey: SRK, Authorization: `Bearer ${SRK}` },
    }).catch(() => undefined);
  });

  it('createUser → signInWithPassword → verifyToken round-trips', async () => {
    const adapter = new SupabaseAuthAdapter({
      supabaseUrl: URL_,
      jwtSecret: process.env.SUPABASE_JWT_SECRET!,
      serviceRoleKey: SRK,
    });

    userId = await adapter.createUser({ email, password });
    expect(userId).toMatch(/[0-9a-f-]{36}/);

    const jwt = await adapter.signInWithPassword({ email, password });
    expect(jwt.split('.').length).toBe(3); // a real JWT

    const identity = await adapter.verifyToken(jwt);
    expect(identity?.authUserId).toBe(userId);

    // a garbage token is rejected, not accepted
    expect(await adapter.verifyToken('not.a.jwt')).toBeNull();
  }, 30_000);
});
