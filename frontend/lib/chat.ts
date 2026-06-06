import { useState, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { storage } from './storage';
import { api } from './api';
import { buildCacheKey, cacheGet, cacheSet, isFresh, SCHEMA_VERSION } from './cache';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BASE_WS = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export interface ChatMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string | null;
  sender_name: string;
  sender_picture?: string;
  content: string;
  created_at: string;
  deleted_at?: string | null;
}

export interface Conversation {
  conversation_id: string;
  type: 'service' | 'tagpoint_group' | 'tagpoint_private';
  context_id: string;
  context_title: string;
  created_by: string;
  last_message_at: string;
  created_at: string;
  last_message?: { content: string; created_at: string; sender_id: string; sender_name: string } | null;
  unread_count: number;
  other_participant?: { user_id: string; name: string; picture?: string } | null;
  participant_count?: number;
  is_blocked?: boolean;
  context_deleted?: boolean;
}

// ── Emitter module-level pour les nouvelles notifications ─────────────────────
type NotifHandler = (notif: any) => void;
let _notifHandlers: NotifHandler[] = [];

export function subscribeNewNotification(fn: NotifHandler): () => void {
  _notifHandlers.push(fn);
  return () => { _notifHandlers = _notifHandlers.filter(h => h !== fn); };
}

function _emitNewNotification(notif: any) {
  _notifHandlers.forEach(fn => { try { fn(notif); } catch {} });
}

// ── Hook: canal de notifications temps réel ────────────────────────────────────

export function useNotifications() {
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [unreadNotif, setUnreadNotif] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    const token = await storage.get('spotu_token');
    if (!token) return;

    if (wsRef.current) {
      const prev = wsRef.current;
      wsRef.current = null;
      prev.close();
    }

    const url = `${BASE_WS}/api/ws/notifications`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ token }));
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'unread_total') setUnreadTotal(data.count ?? 0);
        if (data.type === 'unread_notif') setUnreadNotif(data.count ?? 0);
        if (data.type === 'new_notification') _emitNewNotification(data.notification);
      } catch {}
    };

    ws.onclose = (e) => {
      if (wsRef.current === ws) wsRef.current = null;
      if (e.code === 4001 || e.code === 4003) return;
      reconnectRef.current = setTimeout(() => {
        if (!wsRef.current) connect();
      }, 5000);
    };

    ws.onerror = () => {};
  }, []);

  useEffect(() => {
    connect();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN)) {
        connect();
      }
    });
    return () => {
      sub.remove();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [connect]);

  return { unreadTotal, unreadNotif };
}

// ── Hook: chat temps réel ──────────────────────────────────────────────────────
export function useChat(conversationId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [historyState, setHistoryState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const wsRef = useRef<WebSocket | null>(null);

  const loadHistory = useCallback(async (isRefresh = false) => {
    if (!conversationId) return;
    const cacheKey = buildCacheKey({ path: `/conversations/${conversationId}/messages`, schemaVersion: SCHEMA_VERSION });
    const ttl = 30 * 60_000; // 30 minutes

    // Étape 1 : lecture cache sur le premier chargement
    if (!isRefresh) {
      const cached = await cacheGet<ChatMessage[]>(cacheKey);
      if (cached?.data) {
        setMessages(Array.isArray(cached.data) ? cached.data : []);
        setHistoryState('loaded');
        if (isFresh(cached)) return;
        // Stale : continuer le fetch en arrière-plan
      }
    }

    // Étape 2 : fetch réseau
    try {
      const data = await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages`);
      const msgs = data || [];
      setMessages(msgs);
      setHistoryState('loaded');
      await cacheSet(cacheKey, msgs, ttl);
    } catch {
      // Si aucun message disponible → état d'erreur
      setMessages(prev => {
        if (prev.length === 0) setHistoryState('error');
        return prev;
      });
    }
  }, [conversationId]);

  const connect = useCallback(async () => {
    if (!conversationId) return;
    const token = await storage.get('spotu_token');
    if (!token) return;

    if (wsRef.current) {
      const prev = wsRef.current;
      wsRef.current = null;
      prev.close();
    }

    const url = `${BASE_WS}/api/ws/chat/${conversationId}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ token }));
    };
    ws.onclose = (e) => {
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
      setIsConnected(false);
      if (e.code === 4001 || e.code === 4003) return;
      setTimeout(() => {
        if (!wsRef.current) connect();
      }, 3000);
    };
    ws.onerror = () => setIsConnected(false);
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);

        if (data.type === 'auth_ok') {
          setIsConnected(true);
          return;
        }

        if (data.type === 'message_deleted') {
          setMessages(prev => prev.map(m =>
            m.message_id === data.message_id
              ? { ...m, deleted_at: new Date().toISOString() }
              : m
          ));
          return;
        }

        if (data.type === 'error') return;

        if (!data.message_id) return;

        const msg: ChatMessage = data;
        setMessages(prev => {
          if (prev.some(m => m.message_id === msg.message_id)) return prev;
          const updated = [...prev, msg];
          const key = buildCacheKey({ path: `/conversations/${conversationId}/messages`, schemaVersion: SCHEMA_VERSION });
          cacheSet(key, updated, 30 * 60_000).catch(() => {});
          return updated;
        });
      } catch {}
    };
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    setIsConnected(false);
    setHistoryState('loading');
    loadHistory();
    connect();
    return () => {
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, [conversationId]);

  // Fallback : polling si le WS est coupé (réseau, origine serveur, etc.)
  useEffect(() => {
    if (!conversationId || isConnected) return;
    const timer = setInterval(() => loadHistory(true), 5000);
    return () => clearInterval(timer);
  }, [conversationId, isConnected, loadHistory]);

  // Reconnexion WS quand l'app revient au premier plan
  useEffect(() => {
    if (!conversationId) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          connect();
        }
      }
    });
    return () => sub.remove();
  }, [conversationId, connect]);

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content }));
    }
  }, []);

  return { messages, sendMessage, isConnected, loadHistory, historyState };
}

export async function getOrCreateConversation(type: string, context_id: string): Promise<Conversation> {
  return api.post<Conversation>('/conversations', { type, context_id });
}
