/**
 * lib/cache.ts — Couche cache persistante (AsyncStorage)
 *
 * Responsabilités :
 *  - Construire des clés de cache structurées (méthode, path, params normalisés, userId, schemaVersion)
 *  - Stocker les entrées avec métadonnées (data, cachedAt, ttlMs, source, schemaVersion)
 *  - Distinguer cache frais vs stale via isFresh / isStale
 *  - Invalider de manière ciblée après mutation
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// Incrémenter si le schéma des données évolues (force invalidation globale)
export const SCHEMA_VERSION = 1;

// ── TTL par préfixe d'endpoint (ms) ──────────────────────────────────────────
const CACHE_TTL_MAP: Record<string, number> = {
  '/tag-points/mine':        5 * 60_000,
  '/tag-points/saved':       10 * 60_000,
  '/tag-points':             10 * 60_000,
  '/services/saved':         15 * 60_000,
  '/services':               15 * 60_000,
  '/users/profile':          5 * 60_000,
  '/users/me/notifications': 1 * 60_000,
  '/users/me/activity-feed': 3 * 60_000,
  '/conversations':          2 * 60_000,
  '/planning':               5 * 60_000,
  '/auth/me':                10 * 60_000,
};

export function getTtl(basePath: string): number | null {
  for (const prefix of Object.keys(CACHE_TTL_MAP)) {
    if (basePath === prefix || basePath.startsWith(prefix + '?') || basePath.startsWith(prefix + '/')) {
      return CACHE_TTL_MAP[prefix];
    }
  }
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CacheKeyOptions {
  method?: string;
  path: string;
  /** Params normalisés (clés triées alphabétiquement) */
  params?: Record<string, string>;
  /** Inclure si la donnée est privée (profil, conversations…) */
  userId?: string;
  schemaVersion?: number;
}

export interface CacheEntry<T = unknown> {
  data: T;
  cachedAt: number;
  ttlMs: number;
  source: 'network' | 'prefetch';
  schemaVersion: number;
}

// ── Clé de cache ──────────────────────────────────────────────────────────────

export function buildCacheKey(opts: CacheKeyOptions): string {
  const method = opts.method || 'GET';
  const parts: string[] = [method, opts.path];

  if (opts.params && Object.keys(opts.params).length > 0) {
    const sorted = Object.entries(opts.params)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    parts.push(sorted);
  }

  if (opts.userId) parts.push(`uid:${opts.userId}`);
  parts.push(`sv:${opts.schemaVersion ?? SCHEMA_VERSION}`);

  return `spotu_cache:${parts.join('|')}`;
}

// ── Fraîcheur ─────────────────────────────────────────────────────────────────

export function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.cachedAt < entry.ttlMs;
}

export function isStale(entry: CacheEntry): boolean {
  return !isFresh(entry);
}

/** Retourne depuis combien de minutes le cache a été mis à jour. */
export function cacheAgeMinutes(entry: CacheEntry): number {
  return Math.floor((Date.now() - entry.cachedAt) / 60_000);
}

// ── Lecture / Écriture ────────────────────────────────────────────────────────

export async function cacheGet<T = unknown>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    // Invalider si la version de schéma a changé
    if (entry.schemaVersion !== SCHEMA_VERSION) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function cacheSet<T = unknown>(
  key: string,
  data: T,
  ttlMs: number,
  source: 'network' | 'prefetch' = 'network',
): Promise<void> {
  try {
    const entry: CacheEntry<T> = {
      data,
      cachedAt: Date.now(),
      ttlMs,
      source,
      schemaVersion: SCHEMA_VERSION,
    };
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // L'écriture échoue silencieusement (stockage plein, etc.)
  }
}

/**
 * Invalide de manière ciblée les clés de cache dont le nom contient l'un des patterns.
 * Exemple : cacheInvalidate(['/tag-points', '/planning']) supprime toutes les entrées
 * qui contiennent '/tag-points' OU '/planning' dans leur clé.
 */
export async function cacheInvalidate(patterns: string[]): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const toDelete = allKeys.filter(k =>
      k.startsWith('spotu_cache:') &&
      patterns.some(p => k.includes(p)),
    );
    if (toDelete.length > 0) await AsyncStorage.multiRemove(toDelete);
  } catch {
    // Silencieux
  }
}

/** Vide tout le cache de l'application. */
export async function cacheClear(): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const cacheKeys = allKeys.filter(k => k.startsWith('spotu_cache:'));
    if (cacheKeys.length > 0) await AsyncStorage.multiRemove(cacheKeys);
  } catch {}
}
