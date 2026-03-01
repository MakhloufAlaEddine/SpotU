// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];

// CRITICAL: Exclude node_modules from file watching to avoid ENOSPC in container
// The blockList pattern is used as ignorePattern in the FallbackWatcher,
// preventing it from setting up inotify watches on node_modules directories.
config.resolver.blockList = [
  // Don't watch node_modules subdirectories (only watch source files)
  new RegExp(`${__dirname.replace(/\//g, '/')}/node_modules/.*`),
];

// Only watch source directories explicitly (not node_modules)
config.watchFolders = [
  path.join(__dirname, 'app'),
  path.join(__dirname, 'lib'),
  path.join(__dirname, 'context'),
  path.join(__dirname, 'constants'),
  path.join(__dirname, 'components'),
  path.join(__dirname, 'assets'),
];

// Reduce workers to lower resource usage
config.maxWorkers = 2;

module.exports = config;
