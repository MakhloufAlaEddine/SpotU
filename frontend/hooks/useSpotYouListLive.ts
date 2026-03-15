/**
 * useSpotYouListLive — Hook centralisé pour les mises à jour temps réel WebSocket.
 *
 * Établit une connexion WS par SpotYou dans la liste, gère le cycle de vie focus/blur.
 * Utilisé dans : spot-me.tsx, saved.tsx, map.tsx
 *
 * @param points  - Liste de SpotYou (doivent avoir un champ `point_id`)
 * @param onUpdate - Callback appelé à chaque mise à jour reçue (participants_count, going_count, is_full)
 * @param cap     - Nombre maximum de connexions simultanées (défaut: 15)
 */
import { useRef, useEffect, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { storage } from '../lib/storage';

const BASE_WS = (process.env.EXPO_PUBLIC_BACKEND_URL || '')
  .replace('https://', 'wss://')
  .replace('http://', 'ws://');

export interface SpotYouLiveUpdate {
  participants_count?: number;
  going_count?: number;
  is_full?: boolean;
}

export function useSpotYouListLive(
  points: any[],
  onUpdate: (pointId: string, update: SpotYouLiveUpdate) => void,
  cap = 15,
): void {
  const wsMap = useRef<Map<string, WebSocket>>(new Map());
  // Ref always-fresh pour éviter stale closures dans les callbacks WS async
  const pointsRef = useRef<any[]>([]);
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; });

  const connectLiveAll = useCallback(async (pts: any[]) => {
    const token = await storage.get('spotu_token');
    if (!token || !BASE_WS) return;

    const ids = pts.map((p: any) => p.point_id as string);

    // Fermer les WS des SpotYou retirés de la liste
    for (const [pid, ws] of wsMap.current) {
      if (!ids.includes(pid)) { ws.close(); wsMap.current.delete(pid); }
    }

    // Connecter les nouveaux (limité à `cap`)
    for (const pid of ids.slice(0, cap)) {
      if (wsMap.current.has(pid)) continue;
      const ws = new WebSocket(`${BASE_WS}/api/ws/spot-you/${pid}`);
      wsMap.current.set(pid, ws);
      ws.onopen = () => ws.send(JSON.stringify({ token }));
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'spotyou_update') {
            onUpdateRef.current(pid, {
              participants_count: msg.participants_count,
              going_count: msg.going_count,
              is_full: msg.is_full,
            });
          }
        } catch {}
      };
      ws.onerror = () => {};
      ws.onclose = () => { wsMap.current.delete(pid); };
    }
  }, [cap]);

  // Met à jour la ref + connecte/ajuste les WS quand le nombre d'items change
  useEffect(() => {
    pointsRef.current = points;
    if (points.length > 0) connectLiveAll(points);
  }, [points.length, connectLiveAll]);

  // Reconnect au focus (via ref stable) — cleanup complet au blur
  useFocusEffect(
    useCallback(() => {
      if (pointsRef.current.length > 0) connectLiveAll(pointsRef.current);
      return () => {
        for (const ws of wsMap.current.values()) ws.close();
        wsMap.current.clear();
      };
    }, [connectLiveAll]),
  );
}
