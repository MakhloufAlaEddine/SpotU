// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk cache store
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];

// Reduce workers to lower resource usage in container
config.maxWorkers = 2;

// Prefer Watchman when available to avoid exhausting the container's
// very low inotify watch limit.
config.watcher = {
  watchman: { deferStates: [] },
  useWatchman: true,
};

// Block heavy node_modules sub-trees that contain ios/android native code
// This dramatically reduces the number of inotify watches needed
// NOTE: expo/node_modules is excluded from the nested-modules block because
// Metro itself needs expo/node_modules/@expo/cli/build/metro-require/require.js
config.resolver.blockList = [
  /node_modules\/.*\/local-maven-repo\/.*/,
  /node_modules\/(?!expo[/\\]).*\/node_modules\/.*/,
  /node_modules\/.*\/\.bin\/.*/,
  /node_modules\/.*\/android\/.*/,
  /node_modules\/.*\/ios\/.*/,
  /node_modules\/.*\/web-build\/.*/,
  /node_modules\/.*\/__tests__\/.*/,
  /node_modules\/.*\/example\/.*/,
  /node_modules\/.*\/docs\/.*/,
  /\.git\/.*/,
];

// Some Expo / RN packages expose complex package export maps that force Metro
// to scan additional subtrees in containers with very low watch limits.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
