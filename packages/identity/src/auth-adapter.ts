/**
 * AuthAdapter port (doc 22 §3, invariant A-2).
 *
 * The domain never sees passwords / OTP / magic links — only `authUserId`.
 * ID-Q1 LOCKS the pilot provider as Supabase Auth; `SupabaseAuthAdapter` is a
 * later (I7) implementation. Swapping to Clerk / Auth0 / a self-hosted IdP is one
 * adapter.
 */
export interface AuthIdentity {
  readonly authUserId: string;
  readonly email: string | undefined;
  readonly phone: string | undefined;
}

export interface AuthAdapter {
  /** Verify a bearer token from the client; returns the provider identity or null. */
  verifyToken(bearer: string): Promise<AuthIdentity | null>;
  /** Provider-side user creation (register). Returns the provider subject id. */
  createUser(input: {
    email?: string;
    phone?: string;
    password: string;
  }): Promise<string>;
}

/**
 * Deterministic in-memory adapter for tests / local dev — mirrors the
 * `InMemoryLedgerStore` / `MockLlmProvider` pattern. Tokens are just the
 * `authUserId` string; `createUser` mints `auth_<n>` ids.
 */
export class InMemoryAuthAdapter implements AuthAdapter {
  readonly #byId = new Map<string, AuthIdentity>();
  #seq = 0;

  constructor(private readonly idPrefix = 'auth') {}

  verifyToken(bearer: string): Promise<AuthIdentity | null> {
    return Promise.resolve(this.#byId.get(bearer) ?? null);
  }

  createUser(input: { email?: string; phone?: string; password: string }): Promise<string> {
    if (!input.password || input.password.length < 8) {
      return Promise.reject(new Error('password too short'));
    }
    this.#seq += 1;
    const authUserId = `${this.idPrefix}_${this.#seq}`;
    this.#byId.set(authUserId, {
      authUserId,
      email: input.email,
      phone: input.phone,
    });
    return Promise.resolve(authUserId);
  }

  /** Test helper — register a pre-existing provider identity (e.g. for verifyToken). */
  seed(identity: AuthIdentity): void {
    this.#byId.set(identity.authUserId, identity);
  }
}
