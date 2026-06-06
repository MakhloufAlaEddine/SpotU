import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { api } from '../../lib/api';
import { Conversation, subscribeChatInbox, subscribeUnreadTotal, ChatInboxEvent } from '../../lib/chat';
import { buildCacheKey, cacheGet, cacheSet, isFresh, cacheAgeMinutes, getTtl, SCHEMA_VERSION } from '../../lib/cache';
import { useAuth } from '../../context/AuthContext';
import { StaleBanner, ErrorNoData } from '../../components/OfflineBanner';
import { registerScreenRefresh } from '../../hooks/useNetwork';
import { UserAvatar } from '../../components/UserAvatar';
import { ScreenLoader } from '../../components/ScreenLoader';
import { EmptyState } from '../../components/EmptyState';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'à l\'instant';
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}j`;
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

function TypeBadge({ type }: { type: string }) {
  const label = type === 'service' ? 'SERVICE'
    : type === 'tagpoint_group' ? 'GROUPE'
    : 'PRIVÉ';
  const color = type === 'service' ? Colors.service
    : type === 'tagpoint_group' ? Colors.primary
    : Colors.coaching;
  return (
    <View style={[st.badge, { borderColor: color }]}>
      <Text style={[st.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

/** Retourne un libellé lisible — jamais un ID brut (ex: "pt_demo009") */
function resolveDisplayTitle(raw: string | null | undefined): string {
  if (!raw) return 'Sans titre';
  // Si ça ressemble à un ID brut généré (pt_xxx, conv_xxx, etc.)
  if (/^(pt|conv|svc|user)_/.test(raw)) return 'SpotYou supprimé';
  return raw;
}

function ConvItem({ item, currentUserId }: { item: Conversation; currentUserId: string }) {
  const router = useGuardedRouter();
  const other = item.other_participant;
  const isGroup = item.type === 'tagpoint_group';
  const isArchived = item.context_deleted === true;

  const contextLabel = resolveDisplayTitle(item.context_title);

  const title = isGroup
    ? contextLabel
    : other?.name ?? contextLabel;

  const subtitle = isGroup
    ? contextLabel
    : item.type === 'service'
    ? `Service · ${contextLabel}`
    : `SpotYou · ${contextLabel}`;

  return (
    <TouchableOpacity
      style={[st.item, item.unread_count > 0 && st.itemUnread, isArchived && st.itemArchived]}
      onPress={() => router.push(`/chat/${item.conversation_id}` as any)}
      testID={`conv-item-${item.conversation_id}`}
      activeOpacity={0.7}
    >
      {/* Avatar — légèrement assombri si archivé */}
      <View style={[st.avatarWrap, isArchived && { opacity: 0.55 }]}>
        {isGroup ? (
          item.context_image ? (
            <Image source={{ uri: item.context_image }} style={st.avatar} />
          ) : (
            <View style={[st.avatar, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="people" size={22} color={Colors.primary} />
            </View>
          )
        ) : (
          <UserAvatar uri={other?.picture} name={other?.name} size={48} bgColor={Colors.card} />
        )}
        {!isArchived && item.unread_count > 0 && (
          <View style={st.unreadDot}>
            <Text style={st.unreadDotText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
          </View>
        )}
        {isArchived && (
          <View style={st.archivedBadgeIcon} testID={`conv-archived-${item.conversation_id}`}>
            <Ionicons name="archive-outline" size={10} color={Colors.muted} />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={st.content}>
        <View style={st.row}>
          <Text style={[
            st.title,
            item.unread_count > 0 && !isArchived && st.titleUnread,
            isArchived && st.titleArchived,
          ]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[st.time, isArchived && st.timeArchived]}>
            {item.last_message ? timeAgo(item.last_message.created_at) : timeAgo(item.last_message_at)}
          </Text>
        </View>
        <View style={st.row}>
          {isArchived ? (
            <View style={st.archivedTag} testID={`conv-archived-tag-${item.conversation_id}`}>
              <Text style={st.archivedTagText}>ARCHIVÉE</Text>
            </View>
          ) : (
            <TypeBadge type={item.type} />
          )}
          <Text style={[st.preview, item.unread_count > 0 && !isArchived && st.previewUnread, isArchived && st.previewArchived]} numberOfLines={1}>
            {isArchived
              ? 'Contenu lié non disponible — Lecture seule'
              : item.last_message
                ? `${item.last_message.sender_id === currentUserId ? 'Vous : ' : ''}${item.last_message.content}`
                : subtitle
            }
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ChatListScreen() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [screenState, setScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const loadRef = useRef<(isRefresh?: boolean) => Promise<void>>(async () => {});

  const load = useCallback(async (isRefresh = false) => {
    const userId = user?.user_id;
    const { buildCacheKey, cacheGet, cacheSet, isFresh, cacheAgeMinutes, getTtl, SCHEMA_VERSION } = require('../../lib/cache');
    const convKey = buildCacheKey({ path: '/conversations', userId, schemaVersion: SCHEMA_VERSION });
    const convTtl = getTtl('/conversations') ?? 2 * 60_000;

    // 1. Cache immédiat sur le premier chargement
    if (!isRefresh) {
      const cached = await cacheGet(convKey);
      if (cached) {
        setConversations(Array.isArray(cached.data) ? cached.data : []);
        const fresh = isFresh(cached);
        setScreenState(fresh ? 'ready_fresh' : 'ready_cached');
        setStaleMinutes(fresh ? null : cacheAgeMinutes(cached));
        if (fresh) return;
      }
    }

    if (isRefresh) setRefreshing(true);

    // 2. Fetch réseau
    try {
      const [me, convs] = await Promise.all([
        api.get<any>('/auth/me'),
        api.get<Conversation[]>('/conversations'),
      ]);
      const convList = convs || [];
      setCurrentUserId(me.user_id || userId || '');
      setConversations(convList);
      setScreenState('ready_fresh');
      setStaleMinutes(null);
      setNetworkFailed(false);
      await cacheSet(convKey, convList, convTtl);
    } catch {
      setNetworkFailed(true);
      if (conversations.length === 0) setScreenState('error_no_data');
      else setScreenState('ready_cached');
    } finally {
      setRefreshing(false);
    }
  }, [user?.user_id]);

  loadRef.current = load;

  const applyInboxUpdate = useCallback((event: ChatInboxEvent) => {
    setConversations(prev => {
      const idx = prev.findIndex(c => c.conversation_id === event.conversation_id);
      if (idx === -1) {
        loadRef.current(true);
        return prev;
      }
      const conv = prev[idx];
      const updated: Conversation = {
        ...conv,
        last_message_at: event.created_at,
        last_message: {
          content: event.preview,
          created_at: event.created_at,
          sender_id: '',
          sender_name: event.sender_name,
        },
        unread_count: (conv.unread_count || 0) + 1,
      };
      return [updated, ...prev.filter((_, i) => i !== idx)];
    });
  }, []);

  // Enregistrement refresh progressif
  useEffect(() => registerScreenRefresh('chat', () => load(true), 8), []);

  // Rechargement réseau à chaque focus (ignore le cache frais)
  useFocusEffect(useCallback(() => { load(true); }, [load]));

  // Preview temps réel via WS + refetch si le total non-lus change
  useEffect(() => subscribeChatInbox(applyInboxUpdate), [applyInboxUpdate]);

  useEffect(() => {
    const prevRef = { current: null as number | null };
    return subscribeUnreadTotal((count) => {
      if (prevRef.current === null) {
        prevRef.current = count;
        return;
      }
      if (prevRef.current !== count) {
        prevRef.current = count;
        load(true);
      }
    });
  }, [load]);

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  return (
    <View style={st.container}>
      <SafeAreaView edges={['top']} style={st.safeHeader}>
        <View style={st.header}>
          <View style={{ width: 40 }} />
          <View style={st.headerCenter}>
            <Text style={st.headerTitle}>Messages</Text>
            {totalUnread > 0 && (
              <View style={st.headerBadge}>
                <Text style={st.headerBadgeText}>{totalUnread}</Text>
              </View>
            )}
          </View>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Indicateur stale — uniquement si le refresh réseau a échoué */}
      {screenState === 'ready_cached' && networkFailed && <StaleBanner staleMinutes={staleMinutes} />}

      {screenState === 'loading_initial' ? (
        <ScreenLoader />
      ) : screenState === 'error_no_data' ? (
        <ErrorNoData onRetry={() => load(true)} testID="chat-error-no-data" />
      ) : conversations.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title="Aucune conversation"
          subtitle="Contacte un coach ou rejoins un SpotYou pour commencer à discuter."
          testID="empty-conversations"
        />
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={c => c.conversation_id}
          renderItem={({ item }) => <ConvItem item={item} currentUserId={currentUserId} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />}
          ItemSeparatorComponent={() => <View style={st.separator} />}
          contentContainerStyle={{ paddingBottom: 24 }}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safeHeader: { backgroundColor: Colors.header },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  headerBadge: {
    backgroundColor: Colors.primary, borderRadius: 10,
    minWidth: 20, height: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5,
  },
  headerBadgeText: { color: Colors.background, fontSize: 11, fontWeight: '700' },
  item: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, gap: 12,
  },
  itemUnread: { backgroundColor: 'rgba(0,191,165,0.04)' },
  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 72 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  avatarInitial: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  unreadDot: {
    position: 'absolute', top: -2, right: -2,
    backgroundColor: Colors.primary, borderRadius: 9,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4, borderWidth: 1.5, borderColor: Colors.background,
  },
  unreadDotText: { color: Colors.background, fontSize: 10, fontWeight: '800' },
  content: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  title: { fontSize: 15, fontWeight: '600', color: Colors.foreground, flex: 1 },
  titleUnread: { color: Colors.foreground, fontWeight: '700' },
  time: { fontSize: 12, color: Colors.muted },
  timeArchived: { color: 'rgba(255,255,255,0.2)' },
  badge: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
    marginRight: 4,
  },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  preview: { fontSize: 13, color: Colors.muted, flex: 1 },
  previewUnread: { color: Colors.foreground, fontWeight: '500' },
  previewArchived: { color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' },

  // ── Archived conversation ──────────────────────────────────────────────────
  itemArchived: { opacity: 0.7 },
  titleArchived: { color: 'rgba(255,255,255,0.4)', fontWeight: '500' },
  archivedBadgeIcon: {
    position: 'absolute', bottom: -2, right: -2,
    backgroundColor: Colors.card, borderRadius: 8,
    width: 16, height: 16, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  archivedTag: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    marginRight: 4, borderColor: 'rgba(255,255,255,0.15)',
  },
  archivedTagText: {
    fontSize: 8, fontWeight: '700', color: 'rgba(255,255,255,0.35)',
    letterSpacing: 0.5,
  },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xxl, gap: Spacing.md,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptyDesc: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
