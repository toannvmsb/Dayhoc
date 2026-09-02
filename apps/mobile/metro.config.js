// apps/mobile is a STANDALONE npm project (not part of the workspace); its
// node_modules is complete. Metro's defaults are enough. Hierarchical lookup
// from apps/mobile/node_modules/* resolves this project's react@19 (RN 0.81)
// before ever reaching the repo root — the web app's react@18 there is never
// used by the app bundle (verified: `expo export` builds clean).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
