import { getConfig } from './config';

/**
 * DạyZi mobile API client — talks to the web app's `/api/v1` HTTP surface
 * (apps/web/lib/server/rest.ts), which runs the same `createProductionApi`
 * graph and authorization as the web. The bearer is stored on device (SecureStore).
 */

export type Workspace = 'PARENT' | 'STUDENT' | 'TEACHER';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly friendly: string,
  ) {
    super(message);
  }
}

export class OfflineError extends ApiError {
  constructor() {
    super(0, 'network request failed', 'Không có kết nối mạng. Kiểm tra Wi-Fi / 4G rồi thử lại.');
  }
}

let onUnauthorized: (() => void) | null = null;
/** AuthProvider registers this so any 401 anywhere clears the session. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

function friendlyFor(status: number, serverMessage: string): string {
  switch (status) {
    case 401:
      return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    case 403:
      return serverMessage && !/HTTP \d/.test(serverMessage)
        ? serverMessage
        : 'Bạn không có quyền thực hiện thao tác này.';
    case 404:
      return 'Không tìm thấy dữ liệu. Có thể đã bị xoá hoặc thay đổi.';
    case 409:
      return serverMessage && !/HTTP \d/.test(serverMessage)
        ? serverMessage
        : 'Dữ liệu vừa thay đổi. Tải lại rồi thử lại.';
    case 413:
      return 'Tệp quá lớn. Chụp lại với chất lượng thấp hơn.';
    case 429:
      return 'Bạn thao tác hơi nhanh. Chờ một chút rồi thử lại.';
    case 500:
    case 502:
    case 503:
      return 'Máy chủ đang gặp sự cố. Thử lại sau ít phút.';
    default:
      return serverMessage && !/HTTP \d/.test(serverMessage)
        ? serverMessage
        : 'Có lỗi xảy ra, thử lại sau.';
  }
}

interface CallOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  bearer?: string | null;
  workspace?: Workspace;
  query?: Record<string, string | undefined>;
  timeoutMs?: number;
}

export async function apiCall<T>(path: string, opts: CallOpts = {}): Promise<T> {
  const base = getConfig().apiBaseUrl;
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.workspace) headers['x-dz-workspace'] = opts.workspace;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch {
    throw new OfflineError();
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `HTTP ${res.status}`;
    if (res.status === 401 && opts.bearer) onUnauthorized?.();
    throw new ApiError(res.status, msg, friendlyFor(res.status, msg));
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
    patch: <T>(path: string, body?: unknown) =>
      apiCall<T>(path, { method: 'PATCH', bearer, workspace, body }),
    del: <T>(path: string) => apiCall<T>(path, { method: 'DELETE', bearer, workspace }),
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

/** Re-validate the stored token; returns the fresh viewer or throws 401. */
export async function whoami(bearer: string): Promise<Viewer> {
  return apiCall('/me', { bearer });
}
