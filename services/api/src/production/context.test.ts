import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IdentityService,
  InMemoryAuthAdapter,
  InMemoryIdentityStore,
} from '@copilot/identity';
import { createApi } from '../api.js';
import { createContextResolver, ForbiddenError, trustedContextAllowed } from './context.js';

describe('I7.1 — fail-closed production guards', () => {
  const orig = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = orig;
    vi.restoreAllMocks();
  });

  it('trustedContextAllowed is forced OFF in production regardless of the request', () => {
    process.env.NODE_ENV = 'production';
    expect(trustedContextAllowed(true)).toBe(false);
    expect(trustedContextAllowed(false)).toBe(false);
    process.env.NODE_ENV = 'test';
    expect(trustedContextAllowed(true)).toBe(true);
    expect(trustedContextAllowed(false)).toBe(false);
  });

  it('the legacy createApi surface throws in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => createApi({ childProfiles: {} })).toThrow(/disabled in production/);
    expect(() => createApi({ childProfiles: {}, allowLegacyInProduction: true })).not.toThrow();
  });

  it('a trusted context is refused when trusted mode is not enabled', async () => {
    const store = new InMemoryIdentityStore();
    const identityService = new IdentityService({ store, auth: new InMemoryAuthAdapter() });
    const reg = await identityService.register({
      email: 'p@x.com',
      password: 'supersecret',
      intendedRole: 'PARENT',
    });
    const derive = createContextResolver({ identityService, allowTrustedContext: false });
    await expect(
      derive({ trusted: { userId: reg.user.id, workspace: 'PARENT' } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('a trusted context (when enabled) still requires a real user holding the workspace', async () => {
    const store = new InMemoryIdentityStore();
    const identityService = new IdentityService({ store, auth: new InMemoryAuthAdapter() });
    const reg = await identityService.register({
      email: 'p@x.com',
      password: 'supersecret',
      intendedRole: 'PARENT',
    });
    const derive = createContextResolver({ identityService, allowTrustedContext: true });
    await expect(
      derive({ trusted: { userId: reg.user.id, workspace: 'PARENT' } }),
    ).resolves.toMatchObject({ userId: reg.user.id, workspace: 'PARENT' });
    // a forged userId / an unheld workspace is still rejected
    await expect(
      derive({ trusted: { userId: 'forged-user', workspace: 'PARENT' } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      derive({ trusted: { userId: reg.user.id, workspace: 'ADMIN' } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('bearer path returns null-session → resolver throws Unauthenticated', async () => {
    const store = new InMemoryIdentityStore();
    const identityService = new IdentityService({ store, auth: new InMemoryAuthAdapter() });
    const derive = createContextResolver({ identityService, allowTrustedContext: false });
    await expect(derive({ bearer: 'nope', workspace: 'PARENT' })).rejects.toMatchObject({ status: 401 });
  });
});
