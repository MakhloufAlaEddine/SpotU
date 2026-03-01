import { useState, useEffect, useRef, useCallback } from 'react';
import { storage } from './storage';
import { api } from './api';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BASE_WS = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');

export interface ChatMessage {
  message_id: string;
  conversation_id: string;
  sender_id: string;
  sender_name: string;
  sender_picture?: string;
  content: string;
  created_at: string;
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
}

// ── Hook: canal de notifications temps réel ────────────────────────────────────

export function useNotifications() {
  const [unreadTotal, setUnreadTotal] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(async () => {
    const token = await storage.get('winek_token');
    if (!token) return;

    const url = `${BASE_WS}/api/ws/notifications?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'unread_total') {
          setUnreadTotal(data.count ?? 0);
        }
      } catch {}
    };

    ws.onclose = () => {
      // Reconnexion automatique après 5s
      reconnectRef.current = setTimeout(() => {
        if (wsRef.current === ws) connect();
      }, 5000);
    };

    ws.onerror = () => {};
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null;
        ws.close();
      }
    };
  }, []);

  return { unreadTotal };
}

// ── Hook: chat temps réel ──────────────────────────────────────────────────────
export function useChat(conversationId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const loadHistory = useCallback(async () => {
    if (!conversationId) return;
    try {
      const data = await api.get<ChatMessage[]>(`/conversations/${conversationId}/messages`);
      setMessages(data || []);
    } catch {}
  }, [conversationId]);

  const connect = useCallback(async () => {
    if (!conversationId) return;
    const token = await storage.get('winek_token');
    if (!token) return;

    const url = `${BASE_WS}/api/ws/chat/${conversationId}?token=${token}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);
    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (wsRef.current === ws) connect();
      }, 3000);
    };
    ws.onerror = () => setIsConnected(false);
    ws.onmessage = (e) => {
      try {
        const msg: ChatMessage = JSON.parse(e.data);
        setMessages(prev => [...prev, msg]);
      } catch {}
    };
  }, [conversationId]);

  useEffect(() => {
    setMessages([]);
    setIsConnected(false);
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

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ content }));
    }
  }, []);

  return { messages, sendMessage, isConnected, loadHistory };
}

export async function getOrCreateConversation(type: string, context_id: string): Promise<Conversation> {
  return api.post<Conversation>('/conversations', { type, context_id });
}
