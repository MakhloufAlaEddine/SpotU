/**
 * hooks/useScreenData.ts — Modèle d'état d'écran unifié avec cache
 *
 * États :
 *  - loading_initial : premier chargement, aucune donnée disponible
 *  - ready_fresh     : données fraîches du réseau
 *  - ready_cached    : données du cache (stale ou réseau indisponible)
 *  - error_no_data   : erreur ET aucune donnée en cache → afficher retry
 *
 * Flux stale-while-revalidate :
 *  1. Lit le cache → affiche immédiatement si disponible
 *  2. Lance le fetch réseau en parallèle
 *  3. Si fetch OK  → passe en ready_fresh, met à jour le cache
 *  4. Si fetch KO + cache dispo → reste en ready_cached
 *  5. Si fetch KO + pas de cache → passe en error_no_data
 *
 * Important : les erreurs auth (401/403) ne sont JAMAIS masquées par le cache.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import {
  buildCacheKey, cacheGet, cacheSet, isFresh, getTtl, cacheAgeMinutes,
  SCHEMA_VERSION,
} from '../lib/cache';
import { AppNetworkError, shouldFallbackToCache } from '../lib/network-error';

export type ScreenState = 'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data';

export interface ScreenDataResult<T> {
  data: T | null;
  screenState: ScreenState;
  /** Timestamp (ms) de la dernière mise en cache réussie */
  cachedAt: number | null;
  /** Âge du cache en minutes (null si données fraîches) */
  staleMinutes: number | null;
  error: AppNetworkError | null;
  refresh: () => Promise<void>;
  isRefreshing: boolean;
}

export function useScreenData<T = unknown>(
  path: string | null,
  opts?: {
    userId?: string;
    /** Transformation appliquée à la réponse brute (avant stockage en cache) */
    transform?: (raw: unknown) => T;
    /** Désactiver le cache pour cet endpoint (ex: données temps-réel) */
    noCache?: boolean;
  },
): ScreenDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [screenState, setScreenState] = useState<ScreenState>('loading_initial');
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [error, setError] = useState<AppNetworkError | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const mountedRef = useRef(true);

  const buildKey = useCallback((p: string) => {
    const [basePath, queryStr] = p.split('?');
    const params: Record<string, string> = {};
    if (queryStr) {
      queryStr.split('&').forEach(part => {
        const [k, v] = part.split('=');
        if (k) params[k] = v || '';
      });
    }
    return {
      key: buildCacheKey({ path: basePath, params, userId: opts?.userId, schemaVersion: SCHEMA_VERSION }),
      basePath,
      ttl: getTtl(basePath),
    };
  }, [opts?.userId]);

  const load = useCallback(async (isRefresh = false) => {
    if (!path) return;

    const { key, ttl } = buildKey(path);
    const useCache = !opts?.noCache && ttl !== null;

    // ── Étape 1 : cache immédiat sur le premier chargement ────────────────────
    if (!isRefresh && useCache) {
      const cached = await cacheGet<unknown>(key);
      if (cached && mountedRef.current) {
        const transformed = opts?.transform ? opts.transform(cached.data) : cached.data as T;
        setData(transformed);
        setCachedAt(cached.cachedAt);
        const fresh = isFresh(cached);
        setScreenState(fresh ? 'ready_fresh' : 'ready_cached');
        setStaleMinutes(fresh ? null : cacheAgeMinutes(cached));
        // Données fraîches : pas besoin de refetch réseau
        if (fresh) return;
      }
    }

    if (isRefresh) setIsRefreshing(true);

    // ── Étape 2 : fetch réseau ────────────────────────────────────────────────
    try {
      const raw = await api.get<unknown>(path);
      if (!mountedRef.current) return;

      const transformed = opts?.transform ? opts.transform(raw) : raw as T;
      setData(transformed);
      setScreenState('ready_fresh');
      setCachedAt(Date.now());
      setStaleMinutes(null);
      setError(null);

      // Écriture en cache uniquement pour les GETs éligibles
      if (useCache && raw !== null) {
        await cacheSet(key, raw, ttl!);
      }
    } catch (err: unknown) {
      if (!mountedRef.current) return;

      const appErr = err instanceof AppNetworkError
        ? err
        : new AppNetworkError('unknown', (err as Error)?.message || '');

      setError(appErr);

      // Erreurs auth → jamais masquées par le cache
      if (!shouldFallbackToCache(appErr)) {
        setData(null);
        setScreenState('error_no_data');
        return;
      }

      // Si on a déjà des données (cache précédemment chargé) → rester en ready_cached
      setData(prev => {
        if (prev !== null) {
          setScreenState('ready_cached');
          return prev;
        }
        setScreenState('error_no_data');
        return null;
      });
    } finally {
      if (mountedRef.current) setIsRefreshing(false);
    }
  }, [path, buildKey, opts?.noCache]);

  useEffect(() => {
    mountedRef.current = true;
    setScreenState('loading_initial');
    setData(null);
    setError(null);
    load(false);
    return () => { mountedRef.current = false; };
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { data, screenState, cachedAt, staleMinutes, error, refresh, isRefreshing };
}
