/**
 * Lightweight in-process rate limiter for the pilot (M-hardening §10).
 *
 * Token bucket keyed by `client + route-class`. In-memory → per-instance only;
 * for a multi-instance deployment swap the store for Redis (the interface is
 * intentionally tiny). Protects login/register/invite-redeem/email-exists/
 * school-search/upload/practice from enumeration and brute force.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateRule {
  /** max requests in the window */
  readonly limit: number;
  /** window in ms */
  readonly windowMs: number;
}

export const RATE_RULES: Record<string, RateRule> = {
  'auth': { limit: 10, windowMs: 60_000 }, // login / register
  'invite': { limit: 8, windowMs: 60_000 }, // redeem code
  'lookup': { limit: 20, windowMs: 60_000 }, // emailExists / school search / subjects
  'upload': { limit: 12, windowMs: 60_000 },
  'practice': { limit: 20, windowMs: 60_000 },
  'write': { limit: 60, windowMs: 60_000 }, // generic mutations
  'read': { limit: 240, windowMs: 60_000 },
};

/** Map a METHOD + path to a rule class. */
export function ruleClassFor(method: string, segs: string[]): keyof typeof RATE_RULES {
  const p = segs.join('/');
  if (p.startsWith('auth/')) return 'auth';
  if (p === 'users/email-exists' || p === 'schools' || p === 'subjects' || p.startsWith('academic-years'))
    return 'lookup';
  if (p.includes('/uploads')) return 'upload';
  if (p.endsWith('/practice') || p.startsWith('assignments/')) return 'practice';
  if (/redeem-code|invite-code|relationship-requests/.test(p)) return 'invite';
  return method === 'GET' ? 'read' : 'write';
}

export interface RateResult {
  readonly ok: boolean;
  readonly retryAfterSec: number;
}

export function checkRate(clientKey: string, ruleClass: keyof typeof RATE_RULES): RateResult {
  const rule = RATE_RULES[ruleClass] ?? RATE_RULES.read!;
  const key = `${ruleClass}:${clientKey}`;
  const now = Date.now();
  const refillPerMs = rule.limit / rule.windowMs;

  let b = buckets.get(key);
  if (!b) {
    b = { tokens: rule.limit, updatedAt: now };
    buckets.set(key, b);
  }
  b.tokens = Math.min(rule.limit, b.tokens + (now - b.updatedAt) * refillPerMs);
  b.updatedAt = now;

  if (b.tokens < 1) {
    return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / refillPerMs / 1000) };
  }
  b.tokens -= 1;
  return { ok: true, retryAfterSec: 0 };
}

/** Best-effort periodic cleanup so the map doesn't grow forever. */
let lastSweep = 0;
export function sweepRateBuckets(): void {
  const now = Date.now();
  if (now - lastSweep < 300_000) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now - b.updatedAt > 600_000) buckets.delete(key);
  }
}
