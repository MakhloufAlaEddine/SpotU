import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { api } from '../../lib/api';
import { Conversation, useNotifications } from '../../lib/chat';

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

function ConvItem({ item, currentUserId }: { item: Conversation; currentUserId: string }) {
  const router = useRouter();
  const other = item.other_participant;
  const isGroup = item.type === 'tagpoint_group';

  const title = isGroup
    ? item.context_title
    : other?.name ?? item.context_title;

  const subtitle = isGroup
    ? item.context_title
    : item.type === 'service'
    ? `Service · ${item.context_title}`
    : `SpotYou · ${item.context_title}`;

  return (
    <TouchableOpacity
      style={[st.item, item.unread_count > 0 && st.itemUnread]}
      onPress={() => router.push(`/chat/${item.conversation_id}` as any)}
      testID={`conv-item-${item.conversation_id}`}
      activeOpacity={0.7}
    >
      {/* Avatar */}
      <View style={st.avatarWrap}>
        {isGroup ? (
          item.context_image ? (
            <Image source={{ uri: item.context_image }} style={st.avatar} />
          ) : (
            <View style={[st.avatar, { backgroundColor: Colors.primaryLight }]}>
              <Ionicons name="people" size={22} color={Colors.primary} />
            </View>
          )
        ) : other?.picture ? (
          <Image source={{ uri: other.picture }} style={st.avatar} />
        ) : (
          <View style={[st.avatar, { backgroundColor: Colors.card }]}>
            <Text style={st.avatarInitial}>{(other?.name ?? '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        {item.unread_count > 0 && (
          <View style={st.unreadDot}>
            <Text style={st.unreadDotText}>{item.unread_count > 9 ? '9+' : item.unread_count}</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View style={st.content}>
        <View style={st.row}>
          <Text style={[st.title, item.unread_count > 0 && st.titleUnread]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={st.time}>
            {item.last_message ? timeAgo(item.last_message.created_at) : timeAgo(item.last_message_at)}
          </Text>
        </View>
        <View style={st.row}>
          <TypeBadge type={item.type} />
          {item.last_message ? (
            <Text style={[st.preview, item.unread_count > 0 && st.previewUnread]} numberOfLines={1}>
              {item.last_message.sender_id === currentUserId ? 'Vous : ' : ''}
              {item.last_message.content}
            </Text>
          ) : (
            <Text style={st.preview} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function ChatListScreen() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');

  // Canal notifications WS — rechargement automatique quand un nouveau message arrive
  const { unreadTotal } = useNotifications();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [me, convs] = await Promise.all([
        api.get<any>('/auth/me'),
        api.get<Conversation[]>('/conversations'),
      ]);
      setCurrentUserId(me.user_id);
      setConversations(convs || []);
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Rechargement à chaque fois que l'onglet prend le focus (retour depuis un chat)
  useFocusEffect(
    useCallback(() => { load(); }, [load])
  );

  // Rechargement en temps réel quand le total non-lus change (nouveau message reçu)
  // useEffect avec unreadTotal pour détecter les changements WS
  const prevUnreadRef = React.useRef(unreadTotal);
  React.useEffect(() => {
    if (prevUnreadRef.current !== unreadTotal) {
      prevUnreadRef.current = unreadTotal;
      load();
    }
  }, [unreadTotal]);

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

      {conversations.length === 0 && !loading ? (
        <View style={st.empty}>
          <Ionicons name="chatbubbles-outline" size={56} color={Colors.muted} />
          <Text style={st.emptyTitle}>Aucune conversation</Text>
          <Text style={st.emptyDesc}>
            Contacte un coach ou rejoins un SpotYou pour commencer à discuter.
          </Text>
        </View>
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
  badge: {
    borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
    marginRight: 4,
  },
  badgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  preview: { fontSize: 13, color: Colors.muted, flex: 1 },
  previewUnread: { color: Colors.foreground, fontWeight: '500' },
  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: Spacing.xxl, gap: Spacing.md,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptyDesc: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
