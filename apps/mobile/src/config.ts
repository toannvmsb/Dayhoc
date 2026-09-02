import Constants from 'expo-constants';

/**
 * Resolved, validated runtime config. Fails fast with a readable message rather
 * than making confusing network calls to a wrong URL.
 */
export type Channel = 'dev' | 'staging' | 'production';

interface Config {
  channel: Channel;
  apiBaseUrl: string;
  isProduction: boolean;
  isStaging: boolean;
}

function readExtra(): Record<string, unknown> {
  return (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
}

export class ConfigError extends Error {}

function build(): Config {
  const extra = readExtra();
  const channel = (extra.channel as Channel) ?? 'dev';
  const apiBaseUrl = String(extra.apiBaseUrl ?? '');

  if (!apiBaseUrl) {
    throw new ConfigError(
      'apiBaseUrl chưa được cấu hình. Đặt EXPO_PUBLIC_API_BASE_URL hoặc EXPO_PUBLIC_DEV_HOST rồi khởi động lại.',
    );
  }
  if (!/^https?:\/\/.+\/api\/v1$/.test(apiBaseUrl)) {
    throw new ConfigError(
      `apiBaseUrl không hợp lệ: "${apiBaseUrl}". Cần dạng http(s)://<host>[:port]/api/v1`,
    );
  }
  if (channel === 'production' && !apiBaseUrl.startsWith('https://')) {
    throw new ConfigError(
      `Bản production phải dùng HTTPS cho API (đang là "${apiBaseUrl}").`,
    );
  }
  if (channel === 'production' && /localhost|127\.0\.0\.1|(^|\.)local(\.|$)|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\./.test(apiBaseUrl)) {
    throw new ConfigError('Bản production không được trỏ vào địa chỉ LAN / localhost.');
  }

  return {
    channel,
    apiBaseUrl,
    isProduction: channel === 'production',
    isStaging: channel === 'staging',
  };
}

let cached: Config | { error: string } | null = null;

export function getConfig(): Config {
  if (cached && 'error' in cached) throw new ConfigError(cached.error);
  if (cached) return cached;
  try {
    cached = build();
    return cached;
  } catch (e) {
    cached = { error: e instanceof Error ? e.message : String(e) };
    throw e;
  }
}

/** Non-throwing check used by a startup gate screen. */
export function configStatus(): { ok: true; config: Config } | { ok: false; message: string } {
  try {
    return { ok: true, config: getConfig() };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
