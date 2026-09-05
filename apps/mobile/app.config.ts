import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Dynamic Expo config (M-hardening §2 / §23).
 *
 * The API base URL and the build channel come from the environment, never a
 * hardcoded LAN IP in source:
 *
 *   DZ_ENV                 dev | staging | production   (default: dev)
 *   EXPO_PUBLIC_API_BASE_URL   full override, e.g. https://api.dayzi.vn/api/v1
 *   EXPO_PUBLIC_DEV_HOST       LAN host for `dev` when no explicit URL,
 *                             e.g. 10.16.55.71  ->  http://10.16.55.71:3100/api/v1
 *
 * `EXPO_PUBLIC_*` values are inlined into the JS bundle by Expo, so a staging
 * build and a production build carry different, fixed URLs.
 */
type Channel = 'dev' | 'staging' | 'production';

const CHANNEL: Channel = ((): Channel => {
  const v = (process.env.DZ_ENV ?? '').toLowerCase();
  return v === 'staging' || v === 'production' ? v : 'dev';
})();

function resolveApiBaseUrl(): string {
  if (process.env.EXPO_PUBLIC_API_BASE_URL) return process.env.EXPO_PUBLIC_API_BASE_URL;
  if (CHANNEL === 'staging') return 'https://staging.dayzi.vn/api/v1';
  if (CHANNEL === 'production') return 'https://app.dayzi.vn/api/v1';
  const host = process.env.EXPO_PUBLIC_DEV_HOST ?? 'localhost';
  return `http://${host}:3100/api/v1`;
}

const API_BASE_URL = resolveApiBaseUrl();

// build-time guard — a production bundle must never carry a non-HTTPS / LAN API
if (CHANNEL === 'production') {
  if (!API_BASE_URL.startsWith('https://')) {
    throw new Error(`[app.config] production build needs an HTTPS API URL, got "${API_BASE_URL}"`);
  }
  if (/localhost|127\.0\.0\.1|192\.168\.|10\.\d|172\.(1[6-9]|2\d|3[01])\./.test(API_BASE_URL)) {
    throw new Error(`[app.config] production build must not point at a LAN address: "${API_BASE_URL}"`);
  }
}

const NAME = CHANNEL === 'production' ? 'DạyZi' : `DạyZi (${CHANNEL})`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: 'dayzi',
  scheme: 'dayzi',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  // SDK 57 removed the top-level `splash` key — splash config now lives in the
  // `expo-splash-screen` plugin (see plugins below).
  assetBundlePatterns: ['**/*'],
  // The DạyZi brand mark (cobalt→violet gradient + white speech bubble) — same
  // asset as `apps/web/app/icon.png`. Product decision (2026-09-05): mobile
  // screens follow Hướng 1A (cream/teal, see src/theme.ts) but the app
  // icon/splash keep the DạyZi brand identity.
  icon: './assets/icon.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: CHANNEL === 'production' ? 'vn.dayzi.app' : `vn.dayzi.app.${CHANNEL}`,
    infoPlist: {
      NSCameraUsageDescription: 'DạyZi cần camera để bạn chụp trang vở / bài kiểm tra của con.',
      NSPhotoLibraryUsageDescription: 'DạyZi cần truy cập ảnh để bạn tải bài của con lên.',
      // dev/staging talk to plain-HTTP LAN hosts; production is HTTPS only.
      NSAppTransportSecurity:
        CHANNEL === 'production' ? { NSAllowsArbitraryLoads: false } : { NSAllowsArbitraryLoads: true },
    },
  },
  android: {
    package: CHANNEL === 'production' ? 'vn.dayzi.app' : `vn.dayzi.app.${CHANNEL}`,
    permissions: ['CAMERA', 'READ_EXTERNAL_STORAGE'],
    adaptiveIcon: { backgroundColor: '#3B5BFF', foregroundImage: './assets/icon.png' },
  },
  web: { bundler: 'metro' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-splash-screen', { backgroundColor: '#3B5BFF', image: './assets/icon.png', imageWidth: 160 }],
    [
      'expo-image-picker',
      {
        photosPermission: 'DạyZi cần truy cập ảnh để bạn tải bài của con lên.',
        cameraPermission: 'DạyZi cần camera để bạn chụp trang vở / bài kiểm tra của con.',
      },
    ],
  ],
  extra: {
    ...(config.extra ?? {}),
    router: { root: './app' },
    channel: CHANNEL,
    apiBaseUrl: API_BASE_URL,
    // a production JS bundle must never carry a localhost / http API URL
    apiIsSecure: API_BASE_URL.startsWith('https://'),
  },
});
