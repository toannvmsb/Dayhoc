/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // workspace packages ship TS source; let Next transpile them
  transpilePackages: [
    '@copilot/api-contract',
    '@copilot/curriculum-clock',
    '@copilot/design-tokens',
    '@copilot/domain',
    '@copilot/education-core',
    '@copilot/gap-engine',
    '@copilot/learning-context',
    '@copilot/learning-twin',
    '@copilot/math-data',
    '@copilot/planning',
    '@copilot/projections',
    '@copilot/reference-library',
  ],
};
export default nextConfig;
