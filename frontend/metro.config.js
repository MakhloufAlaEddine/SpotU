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

// CRITICAL: Limit file watching to source dirs only (avoid ENOSPC in container)
// Metro will still READ node_modules for bundling, just won't WATCH them
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
