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

// [FIX ENOSPC / SHA-1] Use polling watcher instead of inotify.
// The Kubernetes container has a hard limit of 12 288 inotify watches
// (the kernel /proc entry is read-only — sysctl cannot raise it).
// Polling avoids the "Failed to get SHA-1" crash at the cost of a small
// increase in CPU usage, which is acceptable in a dev container.
config.watcher = {
  watchman: { deferStates: [] },
  // Fall back to node fs.watch / polling when inotify is unavailable
  useWatchman: false,
};

module.exports = config;
