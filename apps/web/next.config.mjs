/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // workspace packages ship TS source; let Next transpile them
  transpilePackages: [
    '@copilot/api',
    '@copilot/api-contract',
    '@copilot/curriculum-clock',
    '@copilot/design-tokens',
    '@copilot/domain',
    '@copilot/education-core',
    '@copilot/education-directory',
    '@copilot/evidence',
    '@copilot/exercise-gen',
    '@copilot/gap-engine',
    '@copilot/identity',
    '@copilot/learning-context',
    '@copilot/learning-state',
    '@copilot/learning-twin',
    '@copilot/math-data',
    '@copilot/observability',
    '@copilot/planning',
    '@copilot/practice',
    '@copilot/projections',
    '@copilot/reference-library',
    '@copilot/schemas',
  ],
  experimental: {
    serverComponentsExternalPackages: ['pg', 'pg-native'],
  },
};
export default nextConfig;
