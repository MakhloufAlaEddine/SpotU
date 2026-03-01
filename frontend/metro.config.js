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


// Limit file watching to source directory only to avoid ENOSPC (inotify limit)
const { exclusionList } = require('metro-config');
config.resolver.blockList = exclusionList([
  /node_modules\/.*\/node_modules\/react-native\/.*/,
  /node_modules\/.*\/(android|ios|windows|macos|__tests__|\.git)(\/.*)?$/,
]);

// Only watch source files, not all of node_modules
config.watchFolders = [];

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

module.exports = config;
