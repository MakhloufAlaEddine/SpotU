// metro.config.js — configuration propre pour environnement conteneurisé
//
// Pourquoi ces réglages ?
// ─────────────────────────────────────────────────────────────────────
// Le kernel du pod a une limite inotify de 12 288 watches/user.
// node_modules contient ~8 000 répertoires, dont ~2 000 de code natif
// (Java/C++) inutiles pour le bundler JS. Sans configuration adaptée,
// FallbackWatcher (fs.watch) crée une watch par dossier → ENOSPC.
//
// Solution :
//   1. resolver.useWatchman = true  → Watchman (daemon) gère les watches
//      de façon plus efficace qu'inotify brut via fs.watch.
//   2. .watchmanconfig              → exclut les ~2 000 dirs natifs,
//      ramenant le total à ~6 000 < 12 288 avec marge de sécurité.
//   3. PAS de watchFolders          → chaque entrée créerait une instance
//      de watcher supplémentaire sur le même arbre (N × 8000 watches).
//   4. blockList résolveur          → exclut les dossiers natifs de la
//      résolution de modules (cohérence avec .watchmanconfig).
// ─────────────────────────────────────────────────────────────────────

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
