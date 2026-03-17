import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { subscribeNewNotification } from '../../lib/chat';
import { buildCacheKey, cacheGet, cacheSet, isFresh, cacheAgeMinutes, getTtl, SCHEMA_VERSION } from '../../lib/cache';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';
import { StaleBanner, ErrorNoData } from '../../components/OfflineBanner';
import { registerScreenRefresh } from '../../hooks/useNetwork';
import { UserAvatar } from '../../components/UserAvatar';
import { ScreenLoader } from '../../components/ScreenLoader';
import { EmptyState } from '../../components/EmptyState';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

// ── Config visuelle par type ──────────────────────────────────────────────────
const NOTIF_CFG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  new_booking:       { icon: 'calendar-outline',           color: Colors.primary,  bg: Colors.primary + '1A',  label: 'Réservation' },
  booking_accepted:  { icon: 'checkmark-circle-outline',   color: '#10B981',       bg: '#10B9811A',             label: 'Acceptée' },
  booking_refused:   { icon: 'close-circle-outline',       color: '#EF4444',       bg: '#EF44441A',             label: 'Refusée' },
  spotyu_join:       { icon: 'person-add-outline',         color: '#10B981',       bg: '#10B9811A',             label: 'Rejoint' },
  spotyu_leave:      { icon: 'person-remove-outline',      color: '#F59E0B',       bg: '#F59E0B1A',             label: 'Quitté' },
  spotyu_vote:       { icon: 'star-outline',               color: '#FBBF24',       bg: '#FBBF241A',             label: 'Évaluation SpotYou' },
  spotyu_cancelled:  { icon: 'close-circle',               color: '#EF4444',       bg: '#EF44441A',             label: 'SpotYou annulé' },
  spotyu_restored:   { icon: 'refresh-circle',             color: '#10B981',       bg: '#10B9811A',             label: 'SpotYou restauré' },
  spotyu_updated:    { icon: 'create-outline',             color: '#F59E0B',       bg: '#F59E0B1A',             label: 'SpotYou mis à jour' },
  profile_review:    { icon: 'star-half-outline',          color: '#8B5CF6',       bg: '#8B5CF61A',             label: 'Évaluation profil' },
  info:              { icon: 'information-circle-outline', color: Colors.muted,    bg: Colors.card,             label: 'Info' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}j`;
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

// ── Item notification ─────────────────────────────────────────────────────────
function NotifItem({ item, onPress }: { item: any; onPress: () => void }) {
  const cfg = NOTIF_CFG[item.type] || NOTIF_CFG.info;
  const hasImage = !!item.image_url;
  const hasSender = !!item.sender_name;

  return (
    <TouchableOpacity
      style={[ni.row, !item.read && ni.rowUnread]}
      onPress={onPress}
      activeOpacity={0.75}
      testID={`notif-${item.id}`}
    >
      {/* Avatar: SpotYou image > Sender avatar > icon */}
      {hasImage ? (
        <View style={ni.avatarWrap}>
          <Image source={{ uri: item.image_url }} style={ni.avatar} />
          <View style={[ni.typeBadge, { backgroundColor: cfg.color }]}>
            <Ionicons name={cfg.icon} size={9} color="#fff" />
          </View>
        </View>
      ) : hasSender ? (
        <View style={ni.avatarWrap}>
          <UserAvatar uri={item.sender_picture} name={item.sender_name} size={46} bgColor={cfg.bg} color={cfg.color} />
          <View style={[ni.typeBadge, { backgroundColor: cfg.color }]}>
            <Ionicons name={cfg.icon} size={9} color="#fff" />
          </View>
        </View>
      ) : (
        <View style={[ni.iconBox, { backgroundColor: cfg.bg }]}>
          <Ionicons name={cfg.icon} size={22} color={cfg.color} />
        </View>
      )}

      {/* Contenu */}
      <View style={ni.content}>
        <View style={ni.topRow}>
          <View style={{ flex: 1 }}>
            {hasSender ? (
              <Text style={ni.senderName} numberOfLines={1}>{item.sender_name}</Text>
            ) : (
              <Text style={[ni.senderName, { color: Colors.foreground }]} numberOfLines={1}>
                {NOTIF_CFG[item.type]?.label || 'Notification'}
              </Text>
            )}
          </View>
          <Text style={ni.time}>{timeAgo(item.time)}</Text>
        </View>

        {/* Action + contenu concerné */}
        <Text style={ni.action} numberOfLines={2}>
          {hasSender ? item.action_text : item.action_text || item.subtitle}
          {item.content_title ? (
            <Text style={ni.contentTitle}> «{item.content_title}»</Text>
          ) : null}
        </Text>
      </View>

      {!item.read && <View style={ni.dot} />}
      <Ionicons name="chevron-forward" size={14} color={Colors.muted} style={{ marginLeft: 4 }} />
    </TouchableOpacity>
  );
}

// ── Écran principal ───────────────────────────────────────────────────────────
export default function NotificationsScreen() {
  const router = useGuardedRouter();
  const { user } = useAuth();
  const [notifs, setNotifs]     = useState<any[]>([]);
  const [screenState, setScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const parseNotifs = (dbNotifs: any[]) => (Array.isArray(dbNotifs) ? dbNotifs.map(n => {
    const d = n.data || {};
    let action = '/planning';
    if (d.point_id) action = `/spot-you/${d.point_id}`;
    else if (d.service_id) action = `/service/${d.service_id}`;
    else if (d.profile_id) action = `/user/${d.profile_id}`;
    return {
      id: n.id,
      type: d.type === 'chat_message' ? 'chat_message' : (n.type || d.type || 'info'),
      sender_name: d.sender_name || n.title || '',
      sender_picture: d.sender_picture || '',
      image_url: d.image_url || '',
      action_text: d.action_text || n.body || '',
      content_title: d.content_title || '',
      time: n.created_at || new Date().toISOString(),
      action: d.type === 'chat_message' && d.conversationId ? `/chat/${d.conversationId}` : action,
      read: n.read,
    };
  }) : []);

  const load = useCallback(async (isRefresh = false) => {
    const userId = user?.user_id;
    const notifKey = buildCacheKey({ path: '/users/me/notifications', userId, schemaVersion: SCHEMA_VERSION });
    const notifTtl = getTtl('/users/me/notifications') ?? 60_000;

    // 1. Cache immédiat
    let loadedFromCache = false;
    if (!isRefresh) {
      const cached = await cacheGet(notifKey);
      if (cached) {
        loadedFromCache = true;
        const parsed = parseNotifs(cached.data as any[]);
        setNotifs(parsed);
        setUnreadCount(parsed.filter((n: any) => !n.read).length);
        const fresh = isFresh(cached);
        setScreenState(fresh ? 'ready_fresh' : 'ready_cached');
        setStaleMinutes(fresh ? null : cacheAgeMinutes(cached));
        if (fresh) return;
      }
    }

    if (isRefresh) setRefreshing(true);

    // 2. Fetch réseau
    try {
      const dbNotifs = await api.get<any[]>('/users/me/notifications');
      const notifList = parseNotifs(dbNotifs);
      setNotifs(notifList);
      setUnreadCount(notifList.filter(n => !n.read).length);
      setScreenState('ready_fresh');
      setStaleMinutes(null);
      await cacheSet(notifKey, dbNotifs, notifTtl);
    } catch {
      // Utilise loadedFromCache (variable locale) pour éviter le bug de closure sur notifs
      if (!loadedFromCache) setScreenState('error_no_data');
      else setScreenState('ready_cached');
    } finally {
      setRefreshing(false);
    }
  }, [user?.user_id]);

  const markAllRead = async () => {
    try {
      await api.patch('/users/me/notifications/read-all', {});
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  };

  const handleNotifPress = useCallback(async (item: any) => {
    if (!item.read) {
      try {
        await api.patch(`/users/me/notifications/${item.id}/read`, {});
        setNotifs(prev => prev.map(n => n.id === item.id ? { ...n, read: true } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
      } catch {}
    }
    router.push(item.action as any);
  }, [router]);

  // Écouter les nouvelles notifications via WebSocket
  useEffect(() => {
    return subscribeNewNotification(() => load());
  }, [load]);

  useEffect(() => {
    return registerScreenRefresh('notifications', () => load(true), 8);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.header}>
          <Text style={s.headerTitle}>Notifications</Text>
          {unreadCount > 0 && (
            <TouchableOpacity onPress={markAllRead} testID="mark-all-read-btn">
              <Text style={s.readAllBtn}>Tout lire ({unreadCount})</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>

      {screenState === 'ready_cached' && <StaleBanner staleMinutes={staleMinutes} />}

      {screenState === 'loading_initial' ? (
        <ScreenLoader />
      ) : screenState === 'error_no_data' ? (
        <ErrorNoData onRetry={() => load(true)} testID="notif-error-no-data" />
      ) : notifs.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="Aucune notification"
          subtitle="Vos activités (réservations, SpotYou, évaluations) apparaîtront ici."
          testID="empty-notifs"
        />
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={n => n.id}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <NotifItem item={item} onPress={() => handleNotifPress(item)} />
          )}
          ItemSeparatorComponent={() => (
            <View style={{ height: 1, backgroundColor: Colors.border, marginLeft: 74 }} />
          )}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
}

const ni = StyleSheet.create({
  row:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  rowUnread:    { backgroundColor: Colors.primary + '08' },

  // Icône système
  iconBox:      { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },

  // Avatar expéditeur
  avatarWrap:   { position: 'relative', width: 46, height: 46, flexShrink: 0 },
  avatar:       { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.card },
  avatarFallback: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { fontSize: 18, fontWeight: '700' },
  typeBadge:    { position: 'absolute', bottom: -2, right: -2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.background },

  // Contenu
  content:      { flex: 1, gap: 2 },
  topRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  senderName:   { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  time:         { fontSize: 11, color: Colors.muted, marginLeft: 6, flexShrink: 0 },
  action:       { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  contentTitle: { fontSize: 13, color: Colors.foreground, fontWeight: '600' },

  // Indicateur non lu
  dot:          { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, flexShrink: 0 },
});

const s = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  readAllBtn:  { fontSize: 13, fontWeight: '600', color: Colors.primary },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptySub:    { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
