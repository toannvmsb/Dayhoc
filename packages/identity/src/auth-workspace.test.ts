import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryAuthAdapter } from './auth-adapter.js';
import { FamilyService } from './family-service.js';
import { IdentityService } from './identity-service.js';
import { PermissionService } from './permission-service.js';
import { RelationshipService } from './relationship-service.js';
import { InMemoryClassContextReader } from './class-context.js';
import { InMemoryRelationshipStore } from './relationship-store.js';
import { InMemoryIdentityStore } from './store.js';
import { resolveAuthAdapter, SupabaseAuthAdapter } from './supabase-auth-adapter.js';
import { AuthorizationError, ConflictError, WorkspaceNotHeldError } from './errors.js';

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signHs256(payload: object, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

describe('I7 — SupabaseAuthAdapter (HS256 verification)', () => {
  const SECRET = 'test-jwt-secret-000';
  const adapter = new SupabaseAuthAdapter({ supabaseUrl: 'https://x.supabase.co', jwtSecret: SECRET });
  const future = Math.floor(Date.now() / 1000) + 3600;

  it('verifies a well-formed token and returns the provider identity', async () => {
    const token = signHs256({ sub: 'auth-abc', email: 'u@x.com', aud: 'authenticated', exp: future }, SECRET);
    expect(await adapter.verifyToken(token)).toEqual({ authUserId: 'auth-abc', email: 'u@x.com', phone: undefined });
    expect(await adapter.verifyToken(`Bearer ${token}`)).toMatchObject({ authUserId: 'auth-abc' });
  });

  it('rejects a tampered signature', async () => {
    const token = signHs256({ sub: 'auth-abc', aud: 'authenticated', exp: future }, 'the-wrong-secret');
    expect(await adapter.verifyToken(token)).toBeNull();
  });

  it('rejects an expired token and a wrong audience', async () => {
    const expired = signHs256({ sub: 'a', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) - 100 }, SECRET);
    expect(await adapter.verifyToken(expired)).toBeNull();
    const wrongAud = signHs256({ sub: 'a', aud: 'anon', exp: future }, SECRET);
    expect(await adapter.verifyToken(wrongAud)).toBeNull();
  });

  it('createUser calls the Supabase admin API', async () => {
    let calledUrl = '';
    const withKey = new SupabaseAuthAdapter({
      supabaseUrl: 'https://x.supabase.co',
      jwtSecret: SECRET,
      serviceRoleKey: 'svc',
      fetchImpl: (async (url: string) => {
        calledUrl = url;
        return { ok: true, json: async () => ({ id: 'new-auth-id' }) } as Response;
      }) as typeof fetch,
    });
    expect(await withKey.createUser({ email: 'x@y.com', password: 'supersecret' })).toBe('new-auth-id');
    expect(calledUrl).toContain('/auth/v1/admin/users');
  });

  it('resolveAuthAdapter falls back to in-memory when Supabase env is absent', () => {
    const r = resolveAuthAdapter({});
    expect(r.kind).toBe('in-memory');
    const s = resolveAuthAdapter({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_JWT_SECRET: 'k' });
    expect(s.kind).toBe('supabase');
  });

  it('M42 — DZ_DEV_AUTH is strictly non-production (fails closed in prod)', () => {
    // dev auth only when the flag is set AND NODE_ENV !== production
    expect(resolveAuthAdapter({ DZ_DEV_AUTH: '1', NODE_ENV: 'development' }).kind).toBe('dev');
    expect(resolveAuthAdapter({ DZ_DEV_AUTH: '1', NODE_ENV: 'test' }).kind).toBe('dev');
    // production: the flag is IGNORED — never DevAuthAdapter
    expect(resolveAuthAdapter({ DZ_DEV_AUTH: '1', NODE_ENV: 'production' }).kind).not.toBe('dev');
    expect(resolveAuthAdapter({ DZ_DEV_AUTH: '1', NODE_ENV: 'production' }).kind).toBe('in-memory');
    // production WITH Supabase config → supabase, still never dev
    expect(
      resolveAuthAdapter({
        DZ_DEV_AUTH: '1',
        NODE_ENV: 'production',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_JWT_SECRET: 'k',
      }).kind,
    ).toBe('supabase');
  });
});

function makeHarness() {
  const identityStore = new InMemoryIdentityStore();
  const relStore = new InMemoryRelationshipStore();
  const auth = new InMemoryAuthAdapter();
  let seq = 0;
  const newId = () => `w_${(seq += 1).toString().padStart(3, '0')}`;
  const now = () => new Date('2027-02-01T00:00:00Z');
  const identity = new IdentityService({ store: identityStore, auth, newId, now });
  const family = new FamilyService({ store: identityStore, newId, now });
  const permissions = new PermissionService({ store: relStore, classContext: new InMemoryClassContextReader(), newId, now });
  const relationships = new RelationshipService({ store: relStore, identityStore, permissions, newId, now });
  return { identityStore, relStore, auth, identity, family, permissions, relationships };
}

describe('I7 — server-derived session context', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  it('authenticate maps a verified token to the domain user; unknown token → null', async () => {
    const reg = await h.identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' });
    // the InMemoryAuthAdapter uses the authUserId string itself as the bearer
    const authUserId = (await h.identityStore.getUser(reg.user.id))!.authUserId!;
    const resolved = await h.identity.authenticate(authUserId);
    expect(resolved?.user.id).toBe(reg.user.id);
    expect(await h.identity.authenticate('not-a-real-token')).toBeNull();
  });

  it('sessionContext enforces workspace ∈ held roles (no client-asserted role)', async () => {
    const reg = await h.identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' });
    const bearer = (await h.identityStore.getUser(reg.user.id))!.authUserId!;
    await expect(h.identity.sessionContext(bearer, 'PARENT')).resolves.toMatchObject({
      userId: reg.user.id,
      workspace: 'PARENT',
    });
    await expect(h.identity.sessionContext(bearer, 'TEACHER')).rejects.toBeInstanceOf(WorkspaceNotHeldError);
  });

  it('a STUDENT session resolves to the single linked child', async () => {
    const parent = (await h.identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' })).user.id;
    const familyId = await h.family.createFamily(parent);
    const childId = await h.family.createChild({ familyId, creatorUserId: parent, displayName: 'A', schoolGrade: 7 });
    const student = await h.identity.register({ email: 's@x.com', password: 'supersecret', intendedRole: 'STUDENT' });
    const link = await h.identity.linkStudentAccount({
      studentUserId: student.user.id,
      childId,
      linkMethod: 'PARENT_INVITE',
      linkedByUserId: parent,
    });
    expect(link.status).toBe('ACTIVE');
    const bearer = (await h.identityStore.getUser(student.user.id))!.authUserId!;
    await expect(h.identity.sessionContext(bearer, 'STUDENT')).resolves.toMatchObject({ childScope: childId });
  });
});

describe('I7 — privacy-safe discovery: invite codes', () => {
  let h: ReturnType<typeof makeHarness>;
  beforeEach(() => {
    h = makeHarness();
  });

  async function setup() {
    const parent = (await h.identity.register({ email: 'p@x.com', password: 'supersecret', intendedRole: 'PARENT' })).user.id;
    const familyId = await h.family.createFamily(parent);
    const childId = await h.family.createChild({ familyId, creatorUserId: parent, displayName: 'A', schoolGrade: 7 });
    const teacher = (await h.identity.register({ email: 't@x.com', password: 'supersecret', intendedRole: 'TEACHER' })).user.id;
    return { parent, childId, teacher };
  }

  it('a guardian mints a code; a teacher redeems it → PENDING request, ZERO access', async () => {
    const { parent, childId, teacher } = await setup();
    const code = await h.relationships.generateInviteCode({
      childId,
      guardianUserId: parent,
      subjectId: 'subject-math',
      proposedPermissions: ['VIEW_CLASS_CONTEXT', 'SUBMIT_CURRENT_LESSON', 'VIEW_SELECTED_GAPS'],
    });
    // sensitive codes are stripped from the proposal
    expect(code.proposedPermissions).not.toContain('VIEW_SELECTED_GAPS');

    const req = await h.relationships.redeemInviteCode(code.code, teacher);
    expect(req.status).toBe('PENDING');
    expect(req.discoveryMethod).toBe('INVITE_CODE');
    expect(await h.relationships.listChildRelationships(childId)).toHaveLength(0);
    expect((await h.permissions.can(teacher, childId, 'SUBMIT_CURRENT_LESSON', 'subject-math')).allowed).toBe(false);
  });

  it('a non-guardian cannot mint a code', async () => {
    const { childId, teacher } = await setup();
    await expect(
      h.relationships.generateInviteCode({ childId, guardianUserId: teacher }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('an exhausted / expired code cannot be redeemed', async () => {
    const { parent, childId, teacher } = await setup();
    const code = await h.relationships.generateInviteCode({ childId, guardianUserId: parent, uses: 1 });
    await h.relationships.redeemInviteCode(code.code, teacher);
    const teacher2 = (await h.identity.register({ email: 't2@x.com', password: 'supersecret', intendedRole: 'TEACHER' })).user.id;
    await expect(h.relationships.redeemInviteCode(code.code, teacher2)).rejects.toBeInstanceOf(ConflictError);
  });
});
