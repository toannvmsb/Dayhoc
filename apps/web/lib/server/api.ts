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

function pool(): Pool {
  if (!globalThis.__dzPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — the DạyZi web app needs Postgres (see LOCAL_DB.md)');
    }
    globalThis.__dzPool = new Pool({ connectionString, max: 8 });
  }
  return globalThis.__dzPool;
}

export function getApi(): ReturnType<typeof createProductionApi> {
  if (!globalThis.__dzApi) {
    const { adapter } = resolveAuthAdapter(process.env);
    globalThis.__dzApi = createProductionApi({ pool: pool(), authAdapter: adapter });
  }
  return globalThis.__dzApi;
}

export function getBearer(): string | null {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
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
