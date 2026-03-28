// metro.config.js — configuration propre pour environnement conteneurisé
//
// PROBLÈME ENVIRONNEMENT : Le pod Kubernetes partage la limite inotify du node host
// (max_user_watches = 12 288). Le host et d'autres containers consomment déjà ~9 000+
// watches, ne laissant que ~2 000-3 000 disponibles. node_modules seul nécessiterait
// ~5 000 watches → ENOSPC.
//
// SOLUTION : Monkey-patch fs.watch pour ignorer node_modules (jamais modifié pendant
// le développement) — seuls les fichiers sources (~300 dirs) reçoivent des watches.
// Metro continue à lire node_modules via le crawl initial (pas via watches).
// ─────────────────────────────────────────────────────────────────────

// ── Monkey-patch fs.watch : exclure node_modules des watches inotify ──
const fs = require('fs');
const _origWatch = fs.watch;
fs.watch = function patchedWatch(filepath, options, callback) {
  if (typeof filepath === 'string' && filepath.includes('/node_modules/')) {
    // Retourner un faux watcher — node_modules n'a pas besoin de watches
    // (jamais modifié en développement sans redémarrage serveur)
    const noop = { close: () => {} };
    if (typeof options === 'function') options.call?.(null, 'rename', null);
    return noop;
  }
  return _origWatch.call(this, filepath, options, callback);
};

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// ── Cache disque stable ──────────────────────────────────────────────
const cacheRoot = process.env.METRO_CACHE_ROOT
  || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(cacheRoot, 'cache') }),
];

// ── Utiliser Watchman (évite fs.watch massif → ENOSPC) ──────────────
// Les répertoires ignorés sont définis dans .watchmanconfig
// (ignore_dirs : ReactAndroid, ReactCommon, android, ios…)
config.resolver.useWatchman = true;
config.watcher = { watchman: { deferStates: [] } };

// ── Limiter les workers CPU dans le conteneur ────────────────────────
config.maxWorkers = 2;

// ── Exclure les dossiers natifs du résolveur (cohérence watchmanconfig) ─
// Règle : bloquer les dossiers volumineux inutiles (code natif Java/C++,
// frontend Chrome DevTools) mais NE PAS bloquer build/ ou dist/ de façon
// générique car expo-router, react-navigation etc. y publient leur code JS.
config.resolver.blockList = [
  // Très gros dossiers natifs React Native (Java/C++/Kotlin)
  /node_modules\/.*\/ReactAndroid\/.*/,
  /node_modules\/.*\/ReactCommon\/.*/,
  /node_modules\/.*\/ReactApple\/.*/,
  /node_modules\/.*\/ReactNativeDependencies\/.*/,
  // Sous-dossiers android/ios des packages (code natif non-JS)
  /node_modules\/[^/]+\/android\/(src|build|gradle|res)\/.*/,
  /node_modules\/[^/]+\/ios\/(build|RCT|React)\/.*/,
  // Gradle/Maven (pas de JS dedans)
  /node_modules\/.*\/local-maven-repo\/.*/,
  /node_modules\/.*\/gradle\/.*/,
  // Chrome DevTools frontend bundlé (> 80 000 fichiers)
  /node_modules\/@react-native\/debugger-frontend\/.*/,
  // Gradle plugin (Kotlin/Java, aucun JS)
  /node_modules\/@react-native\/gradle-plugin\/.*/,
  // Build artifacts web (pas nécessaires pour bundling mobile)
  /node_modules\/.*\/web-build\/.*/,
  // Double-nested node_modules (sauf expo)
  /node_modules\/(?!expo[/\\]).*\/node_modules\/.*/,
  // Divers
  /\.git\/.*/,
  /\.metro-cache\/.*/,
];

config.resolver.unstable_enablePackageExports = false;

module.exports = config;
