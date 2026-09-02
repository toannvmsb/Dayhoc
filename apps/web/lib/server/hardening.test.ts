import { describe, expect, it } from 'vitest';
import { checkRate, ruleClassFor } from './rate-limit';
import { assertProductionConfig } from './api';

describe('pilot hardening — rate limiter', () => {
  it('classifies routes into rule buckets', () => {
    expect(ruleClassFor('POST', ['auth', 'login'])).toBe('auth');
    expect(ruleClassFor('POST', ['auth', 'register'])).toBe('auth');
    expect(ruleClassFor('GET', ['schools'])).toBe('lookup');
    expect(ruleClassFor('POST', ['children', 'x', 'uploads'])).toBe('upload');
    expect(ruleClassFor('POST', ['children', 'x', 'practice'])).toBe('practice');
    expect(ruleClassFor('POST', ['teacher', 'redeem-code'])).toBe('invite');
    expect(ruleClassFor('GET', ['children', 'x', 'home'])).toBe('read');
    expect(ruleClassFor('POST', ['children', 'x', 'exams'])).toBe('write');
  });

  it('allows a burst then blocks with a retry-after', () => {
    const key = `t-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 15; i += 1) {
      if (checkRate(key, 'auth').ok) allowed += 1;
    }
    expect(allowed).toBe(10); // auth rule = 10 / 60s
    const blocked = checkRate(key, 'auth');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('separate keys have separate budgets', () => {
    expect(checkRate(`a-${Math.random()}`, 'write').ok).toBe(true);
    expect(checkRate(`b-${Math.random()}`, 'write').ok).toBe(true);
  });
});

describe('pilot hardening — production config guard', () => {
  const base = { NODE_ENV: 'production', DATABASE_URL: 'postgres://x', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_JWT_SECRET: 'k' };

  it('passes a well-formed production env', () => {
    expect(() => assertProductionConfig(base as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('is a no-op outside production', () => {
    expect(() => assertProductionConfig({ NODE_ENV: 'development', DZ_DEV_AUTH: '1' } as NodeJS.ProcessEnv)).not.toThrow();
  });
  it('rejects DZ_DEV_AUTH in production', () => {
    expect(() => assertProductionConfig({ ...base, DZ_DEV_AUTH: '1' } as NodeJS.ProcessEnv)).toThrow(/DZ_DEV_AUTH/);
  });
  it('rejects a production deploy with no Supabase auth', () => {
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' } as NodeJS.ProcessEnv),
    ).toThrow(/SUPABASE/);
  });
  it('rejects a production deploy with no database', () => {
    expect(() =>
      assertProductionConfig({ NODE_ENV: 'production', SUPABASE_URL: 'https://x', SUPABASE_JWT_SECRET: 'k' } as NodeJS.ProcessEnv),
    ).toThrow(/DATABASE_URL/);
  });
});
