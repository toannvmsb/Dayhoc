import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { InMemoryAuthAdapter, type AuthAdapter, type AuthIdentity } from './auth-adapter.js';

export interface SupabaseAuthAdapterConfig {
  /** e.g. https://<ref>.supabase.co */
  readonly supabaseUrl: string;
  /** The project's LEGACY JWT secret (HS256, shared-secret signing). Still
   * needed for `createUser`'s admin-API auth path is separate (serviceRoleKey);
   * this is only used to verify HS256-signed tokens — see the class doc
   * comment on why that's no longer the only case to handle. */
  readonly jwtSecret: string;
  /** The service-role key — required only for `createUser` (admin API). */
  readonly serviceRoleKey?: string;
  /** Expected `aud` claim; Supabase issues `authenticated`. */
  readonly audience?: string;
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
  /** Clock skew tolerance in seconds. */
  readonly clockToleranceSec?: number;
}

function b64urlToBuf(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

interface Jwk {
  readonly kid?: string;
  readonly kty?: string;
  readonly crv?: string;
  readonly alg?: string;
  readonly x?: string;
  readonly y?: string;
}

/**
 * Supabase Auth adapter (ID-Q1 — LOCKED MVP provider). Verifies a Supabase
 * access token (HS256 shared-secret OR ES256 via the project's JWKS —
 * see below) with the project's key material; `createUser` calls the
 * Supabase admin API. The domain only ever sees `authUserId` (invariant
 * A-2) — no password / OTP / magic-link handling here.
 *
 * **ES256/JWKS support exists because a fresh Supabase project defaults to
 * asymmetric "JWT Signing Keys" (ECC P-256) today, NOT the legacy HS256
 * shared secret** — confirmed live (2026-09-05) against a real project:
 * `SUPABASE_JWT_SECRET` (the "Legacy JWT Secret" dashboard value) verified
 * fine in isolation, but every REAL access token GoTrue actually issued was
 * `alg: "ES256"`, signed with the project's current asymmetric key — an
 * HS256-only verifier rejects every one of them as invalid, silently (no
 * error, `verifyToken` just returns null, which every caller already
 * treats as "not logged in"). Public keys are fetched from
 * `{supabaseUrl}/auth/v1/.well-known/jwks.json` (no secret involved — it's
 * a public endpoint by design) and cached for the adapter's lifetime; a
 * `kid` this cache hasn't seen yet triggers one refetch (covers a key
 * rotation) before giving up.
 *
 * If real Supabase credentials are not configured, use `InMemoryAuthAdapter`
 * instead (see `resolveAuthAdapter`). Live Supabase integration is
 * ENV_REQUIRED (recorded in PENDING_APPROVAL).
 */
export class SupabaseAuthAdapter implements AuthAdapter {
  readonly #cfg: Required<Omit<SupabaseAuthAdapterConfig, 'serviceRoleKey'>> & { serviceRoleKey?: string };
  #jwksCache: Map<string, KeyObject> | null = null;

  constructor(cfg: SupabaseAuthAdapterConfig) {
    if (!cfg.supabaseUrl || !cfg.jwtSecret) {
      throw new Error('SupabaseAuthAdapter requires supabaseUrl + jwtSecret');
    }
    this.#cfg = {
      supabaseUrl: cfg.supabaseUrl.replace(/\/$/, ''),
      jwtSecret: cfg.jwtSecret,
      audience: cfg.audience ?? 'authenticated',
      fetchImpl: cfg.fetchImpl ?? fetch,
      clockToleranceSec: cfg.clockToleranceSec ?? 30,
      ...(cfg.serviceRoleKey ? { serviceRoleKey: cfg.serviceRoleKey } : {}),
    };
  }

  async #getJwk(kid: string | undefined, forceRefetch: boolean): Promise<KeyObject | null> {
    if (!this.#jwksCache || forceRefetch) {
      const res = await this.#cfg.fetchImpl(`${this.#cfg.supabaseUrl}/auth/v1/.well-known/jwks.json`);
      if (!res.ok) return null;
      const body = (await res.json()) as { keys?: readonly Jwk[] };
      const cache = new Map<string, KeyObject>();
      for (const jwk of body.keys ?? []) {
        if (!jwk.kid || jwk.kty !== 'EC') continue; // only ECC keys are relevant here (ES256)
        try {
          cache.set(jwk.kid, createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }));
        } catch {
          // a key this Node version's crypto can't import — skip it, not fatal
        }
      }
      this.#jwksCache = cache;
    }
    if (!kid) return null;
    return this.#jwksCache.get(kid) ?? null;
  }

  async verifyToken(bearer: string): Promise<AuthIdentity | null> {
    const token = bearer.replace(/^Bearer\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(b64urlToBuf(headerB64).toString('utf8'));
      claims = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));
    } catch {
      return null;
    }

    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = b64urlToBuf(sigB64);

    if (header.alg === 'HS256') {
      const expected = createHmac('sha256', this.#cfg.jwtSecret).update(signingInput).digest();
      if (expected.length !== signature.length || !timingSafeEqual(expected, signature)) return null;
    } else if (header.alg === 'ES256') {
      let key = await this.#getJwk(header.kid, false);
      if (!key) key = await this.#getJwk(header.kid, true); // one retry — covers a key rotation
      if (!key) return null;
      // JWT ECDSA signatures are raw r||s ("IEEE P1363"), not the DER
      // encoding Node's crypto.verify defaults to for EC keys.
      const ok = cryptoVerify('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' }, signature);
      if (!ok) return null;
    } else {
      return null; // an algorithm we don't support — fail closed, not open
    }

    const now = Math.floor(Date.now() / 1000);
    const tol = this.#cfg.clockToleranceSec;
    if (typeof claims.exp === 'number' && claims.exp + tol < now) return null;
    if (typeof claims.nbf === 'number' && claims.nbf - tol > now) return null;
    if (claims.aud !== undefined && claims.aud !== this.#cfg.audience) return null;

    const sub = typeof claims.sub === 'string' ? claims.sub : null;
    if (!sub) return null;
    return {
      authUserId: sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      phone: typeof claims.phone === 'string' ? claims.phone : undefined,
    };
  }

  async createUser(input: { email?: string; phone?: string; password: string }): Promise<string> {
    if (!this.#cfg.serviceRoleKey) {
      throw new Error('SupabaseAuthAdapter.createUser needs a serviceRoleKey');
    }
    const res = await this.#cfg.fetchImpl(`${this.#cfg.supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: this.#cfg.serviceRoleKey,
        authorization: `Bearer ${this.#cfg.serviceRoleKey}`,
      },
      body: JSON.stringify({
        ...(input.email ? { email: input.email, email_confirm: true } : {}),
        ...(input.phone ? { phone: input.phone, phone_confirm: true } : {}),
        password: input.password,
      }),
    });
    if (!res.ok) {
      throw new Error(`Supabase admin createUser failed: ${res.status}`);
    }
    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new Error('Supabase admin createUser returned no id');
    return body.id;
  }

  /**
   * Real email/password sign-in against GoTrue's password grant — the piece
   * `createUser` (an ADMIN operation) never produces on its own. Without
   * this, the only "bearer" available after createUser is the Supabase
   * user's raw id, which `verifyToken` correctly rejects (it's not a
   * signed JWT) — confirmed live (2026-09-05): register() returned 200 with
   * that raw id as "bearer", and every subsequent call with it failed
   * silently (`GET /me` → null) instead of erroring, which is exactly the
   * kind of silent-looking-success this method exists to close.
   * Returns the real `access_token` JWT `verifyToken` can validate.
   */
  async signInWithPassword(input: { email?: string; phone?: string; password: string }): Promise<string> {
    if (!this.#cfg.serviceRoleKey) {
      throw new Error('SupabaseAuthAdapter.signInWithPassword needs a serviceRoleKey (used as apikey)');
    }
    const res = await this.#cfg.fetchImpl(`${this.#cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: this.#cfg.serviceRoleKey,
      },
      body: JSON.stringify({
        ...(input.email ? { email: input.email } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        password: input.password,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Supabase sign-in failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) throw new Error('Supabase sign-in returned no access_token');
    return body.access_token;
  }
}

/**
 * A stateless dev auth adapter: the bearer IS the provider subject id
 * (`verifyToken(bearer) → { authUserId: bearer }`), so a session survives a
 * server restart without a real IdP. **Dev only** — `resolveAuthAdapter` picks it
 * only when `DZ_DEV_AUTH=1` AND `NODE_ENV !== 'production'`.
 */
export class DevAuthAdapter implements AuthAdapter {
  #seq = 0;
  verifyToken(bearer: string): Promise<AuthIdentity | null> {
    const t = bearer.replace(/^Bearer\s+/i, '').trim();
    if (!t.startsWith('devauth_')) return Promise.resolve(null);
    return Promise.resolve({ authUserId: t, email: undefined, phone: undefined });
  }
  createUser(input: { email?: string; phone?: string; password: string }): Promise<string> {
    if (!input.password || input.password.length < 8) {
      return Promise.reject(new Error('password too short'));
    }
    this.#seq += 1;
    // deterministic-ish but unique per registration
    return Promise.resolve(`devauth_${Date.now().toString(36)}_${this.#seq}`);
  }
}

/**
 * Pick the auth adapter for the current environment.
 *  - `SUPABASE_URL` + `SUPABASE_JWT_SECRET` → `SupabaseAuthAdapter` (production).
 *  - `DZ_DEV_AUTH=1` (non-production) → `DevAuthAdapter` (browser dev without an IdP).
 *  - else → `InMemoryAuthAdapter` (tests / CI).
 */
export function resolveAuthAdapter(
  env: Record<string, string | undefined> = process.env,
): { adapter: AuthAdapter; kind: 'supabase' | 'dev' | 'in-memory' } {
  if (env.SUPABASE_URL && env.SUPABASE_JWT_SECRET) {
    return {
      adapter: new SupabaseAuthAdapter({
        supabaseUrl: env.SUPABASE_URL,
        jwtSecret: env.SUPABASE_JWT_SECRET,
        ...(env.SUPABASE_SERVICE_ROLE_KEY ? { serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY } : {}),
      }),
      kind: 'supabase',
    };
  }
  if (env.DZ_DEV_AUTH === '1' && env.NODE_ENV !== 'production') {
    return { adapter: new DevAuthAdapter(), kind: 'dev' };
  }
  return { adapter: new InMemoryAuthAdapter(), kind: 'in-memory' };
}
