import { cookies } from 'next/headers';
import { Pool } from 'pg';
import { resolveAuthAdapter } from '@copilot/identity';
import { createProductionApi } from '@copilot/api';

export const SESSION_COOKIE = 'dz_session';

/** One pool + one production-API instance per server process. */
declare global {
  // eslint-disable-next-line no-var
  var __dzPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __dzApi: ReturnType<typeof createProductionApi> | undefined;
}

export function pool(): Pool {
  if (!globalThis.__dzPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — the DạyZi web app needs Postgres (see LOCAL_DB.md)');
    }
    globalThis.__dzPool = new Pool({ connectionString, max: 8 });
  }
  return globalThis.__dzPool;
}

/**
 * Fail fast in production if the deploy is misconfigured (M-hardening §7).
 * Throws once, on first API use — a broken production should not boot serving
 * requests with dev auth or no DB.
 */
export function assertProductionConfig(env = process.env): void {
  if (env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (!env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!env.SUPABASE_URL || !env.SUPABASE_JWT_SECRET) {
    missing.push('SUPABASE_URL + SUPABASE_JWT_SECRET (production auth)');
  }
  if (env.DZ_DEV_AUTH === '1') {
    throw new Error('DZ_DEV_AUTH must NOT be set in production (dev auth is dev-only).');
  }
  if (missing.length > 0) {
    throw new Error(`production config missing: ${missing.join('; ')}`);
  }
}

export function getApi(): ReturnType<typeof createProductionApi> {
  if (!globalThis.__dzApi) {
    assertProductionConfig();
    const { adapter, kind } = resolveAuthAdapter(process.env);
    if (process.env.NODE_ENV === 'production' && kind !== 'supabase') {
      throw new Error(`production requires the Supabase auth adapter, resolved "${kind}"`);
    }
    globalThis.__dzApi = createProductionApi({ pool: pool(), authAdapter: adapter });
  }
  return globalThis.__dzApi;
}

export function getBearer(): string | null {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
}

/** Readiness probe — resolves when Postgres answers. */
export async function pingDb(): Promise<void> {
  await pool().query('SELECT 1');
}

/** The verified identity for the current request, or null. */
export async function getViewer(): Promise<
  | {
      userId: string;
      displayName: string | null;
      roles: readonly ('PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN')[];
    }
  | null
> {
  const bearer = getBearer();
  if (!bearer) return null;
  try {
    return await getApi().whoami(bearer);
  } catch {
    return null;
  }
}

export type WsAuth<W extends 'PARENT' | 'STUDENT' | 'TEACHER'> = { bearer: string; workspace: W };
function wsAuth<W extends 'PARENT' | 'STUDENT' | 'TEACHER'>(workspace: W): WsAuth<W> {
  const bearer = getBearer();
  if (!bearer) throw new Error('NO_SESSION');
  return { bearer, workspace };
}
export const parentAuth = () => wsAuth('PARENT');
export const studentAuth = () => wsAuth('STUDENT');
export const teacherAuth = () => wsAuth('TEACHER');

/**
 * The workspace that best fits the signed-in identity — PARENT if held, else
 * STUDENT, else TEACHER. Used by endpoints that any of the three roles may reach
 * (e.g. the practice runner) so we don't force a PARENT context onto a student.
 */
export async function preferredAuth(): Promise<WsAuth<'PARENT' | 'STUDENT' | 'TEACHER'>> {
  const bearer = getBearer();
  if (!bearer) throw new Error('NO_SESSION');
  const roles = (await getViewer())?.roles ?? [];
  const workspace = roles.includes('PARENT')
    ? 'PARENT'
    : roles.includes('STUDENT')
      ? 'STUDENT'
      : 'TEACHER';
  return { bearer, workspace };
}
