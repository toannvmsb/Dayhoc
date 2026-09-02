import Constants from 'expo-constants';

/**
 * DạyZi mobile API client — talks to the web app's `/api/v1` HTTP surface
 * (apps/web/lib/server/rest.ts), which runs the same `createProductionApi`
 * graph and authorization as the web. The bearer is stored on device.
 */

const BASE: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  'http://localhost:3100/api/v1';

export type Workspace = 'PARENT' | 'STUDENT' | 'TEACHER';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface CallOpts {
  method?: 'GET' | 'POST';
  body?: unknown;
  bearer?: string | null;
  workspace?: Workspace;
  query?: Record<string, string | undefined>;
}

export async function apiCall<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.workspace) headers['x-dz-workspace'] = opts.workspace;

  const res = await fetch(url.toString(), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}

/** A bearer-bound client for a given workspace. */
export function client(bearer: string | null, workspace: Workspace) {
  return {
    get: <T>(path: string, query?: Record<string, string | undefined>) =>
      apiCall<T>(path, { bearer, workspace, query }),
    post: <T>(path: string, body?: unknown) =>
      apiCall<T>(path, { method: 'POST', bearer, workspace, body }),
  };
}

export type Viewer = {
  userId: string;
  displayName: string | null;
  roles: readonly ('PARENT' | 'STUDENT' | 'TEACHER' | 'ADMIN')[];
};

export async function register(input: {
  email: string;
  password: string;
  displayName?: string;
  role?: 'PARENT' | 'TEACHER';
}): Promise<{ bearer: string; viewer: Viewer }> {
  return apiCall('/auth/register', { method: 'POST', body: input });
}

export async function login(email: string): Promise<{ bearer: string; viewer: Viewer }> {
  return apiCall('/auth/login', { method: 'POST', body: { email } });
}
