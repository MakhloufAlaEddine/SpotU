/**
 * useSpotYouListLive — Hook centralisé pour les mises à jour temps réel WebSocket.
 *
 * Établit une connexion WS par SpotYou dans la liste, gère le cycle de vie focus/blur.
 * Reconnexion automatique en cas de coupure réseau (délai 4s, annulée si screen blur).
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

const RECONNECT_DELAY_MS = 4000;

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
  const pointsRef = useRef<any[]>([]);
  const onUpdateRef = useRef(onUpdate);
  // true quand on ferme intentionnellement (screen blur) — bloque la reconnexion auto
  const intentionalCloseRef = useRef(false);

  useEffect(() => { onUpdateRef.current = onUpdate; });

  // Connecte un seul SpotYou et programme une reconnexion en cas de coupure
  const connectOne = useCallback(async (pid: string) => {
    const token = await storage.get('spotu_token');
    if (!token || !BASE_WS || intentionalCloseRef.current) return;
    if (wsMap.current.has(pid)) return; // déjà connecté

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

    ws.onclose = () => {
      wsMap.current.delete(pid);
      // Reconnexion auto uniquement si fermeture non intentionnelle
      // et si le SpotYou est toujours dans la liste affichée
      if (!intentionalCloseRef.current) {
        setTimeout(() => {
          if (
            !intentionalCloseRef.current &&
            pointsRef.current.some((p: any) => p.point_id === pid)
          ) {
            connectOne(pid);
          }
        }, RECONNECT_DELAY_MS);
      }
    };
  }, []); // stable — intentionalCloseRef et pointsRef sont des refs

  const connectLiveAll = useCallback(async (pts: any[]) => {
    const ids = pts.map((p: any) => p.point_id as string);

    // Fermer les WS des SpotYou retirés de la liste
    for (const [pid, ws] of wsMap.current) {
      if (!ids.includes(pid)) { ws.close(); wsMap.current.delete(pid); }
    }

    // Connecter les nouveaux (limité à `cap`)
    for (const pid of ids.slice(0, cap)) {
      connectOne(pid);
    }
  }, [cap, connectOne]);

  // Met à jour la ref + connecte/ajuste les WS quand le nombre d'items change
  useEffect(() => {
    pointsRef.current = points;
    if (points.length > 0) connectLiveAll(points);
  }, [points.length, connectLiveAll]);

  // Reconnect au focus — cleanup intentionnel au blur (bloque la reconnexion auto)
  useFocusEffect(
    useCallback(() => {
      intentionalCloseRef.current = false; // écran actif
      if (pointsRef.current.length > 0) connectLiveAll(pointsRef.current);
      return () => {
        intentionalCloseRef.current = true; // fermeture intentionnelle → pas de reconnexion
        for (const ws of wsMap.current.values()) ws.close();
        wsMap.current.clear();
      };
    }, [connectLiveAll]),
  );
}
