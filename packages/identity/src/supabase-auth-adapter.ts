import { createHmac, timingSafeEqual } from 'node:crypto';
import { InMemoryAuthAdapter, type AuthAdapter, type AuthIdentity } from './auth-adapter.js';

export interface SupabaseAuthAdapterConfig {
  /** e.g. https://<ref>.supabase.co */
  readonly supabaseUrl: string;
  /** The project JWT secret (HS256). From the Supabase dashboard → API settings. */
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

/**
 * Supabase Auth adapter (ID-Q1 — LOCKED MVP provider). Verifies an HS256 Supabase
 * access token with the project JWT secret; `createUser` calls the Supabase admin
 * API. The domain only ever sees `authUserId` (invariant A-2) — no password / OTP
 * / magic-link handling here.
 *
 * If real Supabase credentials are not configured, use `InMemoryAuthAdapter`
 * instead (see `resolveAuthAdapter`). Live Supabase integration is
 * ENV_REQUIRED (recorded in PENDING_APPROVAL).
 */
export class SupabaseAuthAdapter implements AuthAdapter {
  readonly #cfg: Required<Omit<SupabaseAuthAdapterConfig, 'serviceRoleKey'>> & { serviceRoleKey?: string };

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

  verifyToken(bearer: string): Promise<AuthIdentity | null> {
    const token = bearer.replace(/^Bearer\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return Promise.resolve(null);
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    let header: { alg?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(b64urlToBuf(headerB64).toString('utf8'));
      claims = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));
    } catch {
      return Promise.resolve(null);
    }
    if (header.alg !== 'HS256') return Promise.resolve(null);

    const expected = createHmac('sha256', this.#cfg.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest();
    const got = b64urlToBuf(sigB64);
    if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
      return Promise.resolve(null);
    }

    const now = Math.floor(Date.now() / 1000);
    const tol = this.#cfg.clockToleranceSec;
    if (typeof claims.exp === 'number' && claims.exp + tol < now) return Promise.resolve(null);
    if (typeof claims.nbf === 'number' && claims.nbf - tol > now) return Promise.resolve(null);
    if (claims.aud !== undefined && claims.aud !== this.#cfg.audience) return Promise.resolve(null);

    const sub = typeof claims.sub === 'string' ? claims.sub : null;
    if (!sub) return Promise.resolve(null);
    return Promise.resolve({
      authUserId: sub,
      email: typeof claims.email === 'string' ? claims.email : undefined,
      phone: typeof claims.phone === 'string' ? claims.phone : undefined,
    });
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
