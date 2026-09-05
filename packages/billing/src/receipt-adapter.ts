/**
 * Receipt validation port (P9 — billing readiness).
 *
 * The subscription STATE MACHINE (`@copilot/domain` subscription.ts,
 * `applyBillingEvent`) is pure and store-agnostic — it only knows how to turn
 * an already-verified fact into a next state. This is the missing piece in
 * front of it: calling the actual store (Apple App Store Server API / Google
 * Play Developer API) to check a receipt/purchase token is real, then handing
 * back a plain fact the state machine can consume.
 *
 * Same shape as every other external integration in this codebase
 * (`UploadStorageAdapter`, `DocumentVisionAdapter`, `AnalyticsAdapter`,
 * `NotificationDeliveryAdapter`): an interface + a safe no-credential default
 * + a resolver that only activates the real thing when full credentials are
 * present, and throws rather than silently misbehaving if partially
 * configured. Nothing here EVER runs a charge — validating a receipt reads
 * the store's record of a purchase the user already made in the store's own
 * UI; it cannot create one.
 */
import type { BillingSource, Plan } from '@copilot/domain';

export interface ReceiptValidationRequest {
  readonly store: Extract<BillingSource, 'apple' | 'google'>;
  /** Apple: the base64 App Store receipt or a StoreKit2 JWS transaction.
   * Google: the purchase token from the Play Billing Library. */
  readonly receipt: string;
}

export interface ReceiptValidationResult {
  readonly valid: boolean;
  readonly plan: Plan | null;
  readonly storeTransactionId: string | null;
  readonly periodEnd: string | null; // ISO
  readonly autoRenew: boolean;
  /** Present only when `valid` is false — never silently swallowed. */
  readonly reason?: string;
}

export interface ReceiptValidationAdapter {
  readonly name: string;
  validate(req: ReceiptValidationRequest): Promise<ReceiptValidationResult>;
}

export class BillingCredentialsRequiredError extends Error {
  constructor(store: string, missing: readonly string[]) {
    super(`${store} receipt validation requires ${missing.join(', ')} — set them or leave billing on the mock adapter`);
    this.name = 'BillingCredentialsRequiredError';
  }
}

/** Default — no store call, always reports invalid with a clear reason.
 * Safe with no credentials configured; never throws, never charges anything. */
export class NoopReceiptValidationAdapter implements ReceiptValidationAdapter {
  readonly name = 'noop';
  validate(): Promise<ReceiptValidationResult> {
    return Promise.resolve({
      valid: false,
      plan: null,
      storeTransactionId: null,
      periodEnd: null,
      autoRenew: false,
      reason: 'no receipt validation adapter configured (billing is MOCK — see @copilot/billing)',
    });
  }
}

/** Deterministic fake for dev/tests: any receipt string of the form
 * `"mock:<plan>:<transactionId>:<periodEndIso>"` validates; anything else is
 * rejected. Never calls a network. */
export class MockReceiptValidationAdapter implements ReceiptValidationAdapter {
  readonly name = 'mock';
  validate(req: ReceiptValidationRequest): Promise<ReceiptValidationResult> {
    // Only the first 3 ':' are field separators — the ISO periodEnd itself
    // contains ':' (e.g. "2026-06-01T00:00:00.000Z"), so split with a limit
    // and rejoin the remainder rather than splitting on every ':'.
    const parts = req.receipt.split(':');
    if (parts[0] !== 'mock' || parts.length < 4) {
      return Promise.resolve({ valid: false, plan: null, storeTransactionId: null, periodEnd: null, autoRenew: false, reason: 'malformed mock receipt' });
    }
    const [, plan, txnId, ...rest] = parts;
    return Promise.resolve({
      valid: true,
      plan: plan as Plan,
      storeTransactionId: txnId ?? null,
      periodEnd: rest.join(':'),
      autoRenew: true,
    });
  }
}

interface AppleEnv {
  readonly APPLE_ISSUER_ID?: string;
  readonly APPLE_KEY_ID?: string;
  readonly APPLE_PRIVATE_KEY?: string;
  readonly APPLE_BUNDLE_ID?: string;
}

/** Real adapter is intentionally NOT implemented — calling the App Store
 * Server API needs a signed JWT (issuer/key id/private key) and a chosen
 * HTTP client, which is a vendor-integration task for when Apple IAP is
 * actually enabled, not scaffolding. Throws so a half-configured env fails
 * loudly instead of silently validating nothing. */
export class AppleReceiptValidationAdapter implements ReceiptValidationAdapter {
  readonly name = 'apple';
  constructor(env: AppleEnv) {
    const missing = (['APPLE_ISSUER_ID', 'APPLE_KEY_ID', 'APPLE_PRIVATE_KEY', 'APPLE_BUNDLE_ID'] as const).filter(
      (k) => !env[k],
    );
    if (missing.length > 0) throw new BillingCredentialsRequiredError('Apple', missing);
  }
  validate(): Promise<ReceiptValidationResult> {
    throw new Error('AppleReceiptValidationAdapter: App Store Server API call not implemented — enable only after building the real integration');
  }
}

interface GoogleEnv {
  readonly GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?: string;
  readonly GOOGLE_PLAY_PACKAGE_NAME?: string;
}

/** Same as Apple's — needs a Google Cloud service account + the Play
 * Developer API client, a real integration task, not scaffolding. */
export class GooglePlayReceiptValidationAdapter implements ReceiptValidationAdapter {
  readonly name = 'google';
  constructor(env: GoogleEnv) {
    const missing = (['GOOGLE_PLAY_SERVICE_ACCOUNT_JSON', 'GOOGLE_PLAY_PACKAGE_NAME'] as const).filter((k) => !env[k]);
    if (missing.length > 0) throw new BillingCredentialsRequiredError('Google Play', missing);
  }
  validate(): Promise<ReceiptValidationResult> {
    throw new Error('GooglePlayReceiptValidationAdapter: Play Developer API call not implemented — enable only after building the real integration');
  }
}

export interface BillingEnv extends AppleEnv, GoogleEnv {
  readonly DZ_BILLING?: string; // 'mock' | 'live' — anything else stays noop
}

/**
 * Resolve the receipt validation adapter for BOTH stores from the
 * environment. `DZ_BILLING=mock` gives the deterministic fake (dev/tests
 * exercising the full purchase→state flow without a store); `DZ_BILLING=live`
 * requires full Apple AND Google credentials (throws if either is partial);
 * anything else — including production today — is `Noop`. There is no path
 * to a real charge without both an explicit opt-in AND full store
 * credentials, matching the productionization directive: "Do NOT activate
 * charging until explicitly approved."
 */
export function resolveReceiptValidationAdapter(env: BillingEnv): {
  readonly apple: ReceiptValidationAdapter;
  readonly google: ReceiptValidationAdapter;
  readonly kind: 'noop' | 'mock' | 'live';
} {
  if (env.DZ_BILLING === 'mock') {
    const mock = new MockReceiptValidationAdapter();
    return { apple: mock, google: mock, kind: 'mock' };
  }
  if (env.DZ_BILLING === 'live') {
    return { apple: new AppleReceiptValidationAdapter(env), google: new GooglePlayReceiptValidationAdapter(env), kind: 'live' };
  }
  const noop = new NoopReceiptValidationAdapter();
  return { apple: noop, google: noop, kind: 'noop' };
}
