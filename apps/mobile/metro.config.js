// apps/mobile is a STANDALONE npm project (not part of the workspace) so its
// node_modules is complete and non-hoisted — Metro's defaults are enough.
// The app has no runtime dependency on any @copilot/* package.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
