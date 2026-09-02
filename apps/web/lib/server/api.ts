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

export type ParentAuth = { bearer: string; workspace: 'PARENT' };
export function parentAuth(): ParentAuth {
  const bearer = getBearer();
  if (!bearer) throw new Error('NO_SESSION');
  return { bearer, workspace: 'PARENT' };
}
