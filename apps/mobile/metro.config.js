// Expo + npm-workspaces monorepo Metro config. Lets Metro see the repo root
// node_modules and (type-only) workspace packages. The mobile app deliberately
// has NO runtime dependency on server packages (@copilot/api / pg) — only
// type-only imports from @copilot/api-contract and @copilot/domain, which are
// erased at build time.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
