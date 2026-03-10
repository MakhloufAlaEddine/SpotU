/**
 * hooks/useNetwork.ts — Détection de connectivité temps réel
 *
 * - Expose : status ('online' | 'offline' | 'weak'), wasOffline, isOnline
 * - Registre de callbacks pour le refresh progressif au retour du réseau
 *   (les écrans prioritaires se rechargent en premier)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import NetInfo from '@react-native-community/netinfo';

export type NetworkStatus = 'online' | 'offline' | 'weak';

export interface NetworkState {
  status: NetworkStatus;
  isOnline: boolean;
  /** True pendant 3s après un retour de connexion (utile pour flash "Connexion rétablie") */
  wasOffline: boolean;
}

// ── Registre global pour le refresh progressif ───────────────────────────────
type RefreshFn = () => Promise<void>;
interface RefreshEntry { fn: RefreshFn; priority: number }
const _refreshRegistry = new Map<string, RefreshEntry>();

/**
 * Enregistre un callback de rechargement pour cet écran.
 * priority : plus haut = rechargé en premier. Ecrans visibles → 10, autres → 0.
 * Retourne une fonction de désinscription.
 */
export function registerScreenRefresh(key: string, fn: RefreshFn, priority = 0): () => void {
  _refreshRegistry.set(key, { fn, priority });
  return () => _refreshRegistry.delete(key);
}

async function triggerProgressiveRefresh(): Promise<void> {
  const sorted = [..._refreshRegistry.entries()].sort((a, b) => b[1].priority - a[1].priority);
  for (const [, entry] of sorted) {
    try { await entry.fn(); } catch { /* silencieux */ }
    // Petit délai entre chaque refresh pour ne pas saturer le serveur
    await new Promise(r => setTimeout(r, 350));
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useNetwork(): NetworkState {
  const [status, setStatus] = useState<NetworkStatus>('online');
  const [wasOffline, setWasOffline] = useState(false);
  const prevOfflineRef = useRef(false);
  const wasOfflineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Vérification initiale
    NetInfo.fetch().then(state => {
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      if (!connected) {
        setStatus('offline');
        prevOfflineRef.current = true;
      }
    });

    const unsub = NetInfo.addEventListener(state => {
      const connected = !!state.isConnected && state.isInternetReachable !== false;
      const effectiveType = (state as any).details?.effectiveType as string | undefined;

      let next: NetworkStatus = 'online';
      if (!connected) next = 'offline';
      else if (effectiveType === '2g' || effectiveType === 'slow-2g') next = 'weak';

      setStatus(next);

      // Retour réseau : signaler + déclencher refresh progressif
      if (prevOfflineRef.current && connected) {
        if (wasOfflineTimerRef.current) clearTimeout(wasOfflineTimerRef.current);
        setWasOffline(true);
        wasOfflineTimerRef.current = setTimeout(() => setWasOffline(false), 3000);
        triggerProgressiveRefresh();
      }

      prevOfflineRef.current = !connected;
    });

    return () => {
      unsub();
      if (wasOfflineTimerRef.current) clearTimeout(wasOfflineTimerRef.current);
    };
  }, []);

  return { status, isOnline: status !== 'offline', wasOffline };
}
