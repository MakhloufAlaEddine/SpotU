import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ── Config visuelle par type ──────────────────────────────────────────────────
const NOTIF_CFG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  booking_new:       { icon: 'calendar-outline',          color: Colors.primary,  bg: Colors.primary + '1A',  label: 'Réservation' },
  new_booking:       { icon: 'calendar-outline',          color: Colors.primary,  bg: Colors.primary + '1A',  label: 'Réservation' },
  booking_accepted:  { icon: 'checkmark-circle-outline',  color: '#10B981',       bg: '#10B9811A',             label: 'Acceptée' },
  booking_refused:   { icon: 'close-circle-outline',      color: '#EF4444',       bg: '#EF44441A',             label: 'Refusée' },
  booking_pending:   { icon: 'time-outline',              color: '#F59E0B',       bg: '#F59E0B1A',             label: 'En attente' },
  booking_status:    { icon: 'calendar-outline',          color: Colors.primary,  bg: Colors.primary + '1A',  label: 'Réservation' },
  spotyu_join:       { icon: 'person-add-outline',        color: '#10B981',       bg: '#10B9811A',             label: 'Rejoint' },
  spotyu_leave:      { icon: 'person-remove-outline',     color: '#F59E0B',       bg: '#F59E0B1A',             label: 'Quitté' },
  spotyu_vote:       { icon: 'star-outline',              color: '#FBBF24',       bg: '#FBBF241A',             label: 'Évaluation' },
  spotyu_cancelled:  { icon: 'close-circle',              color: '#EF4444',       bg: '#EF44441A',             label: 'Annulé' },
  spotyu_restored:   { icon: 'refresh-circle',            color: '#10B981',       bg: '#10B9811A',             label: 'Restauré' },
  spotyu_updated:    { icon: 'create-outline',            color: '#F59E0B',       bg: '#F59E0B1A',             label: 'Mis à jour' },
  info:              { icon: 'information-circle-outline', color: Colors.muted,   bg: Colors.card,             label: 'Info' },
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

function bookingToNotif(b: any, isCoach: boolean) {
  const svcTitle  = b.service?.title || 'une séance';
  const coachName = b.coach?.name || '';
  const coachPic  = b.coach?.picture || '';
  const userName  = b.user?.name || '';
  const userPic   = b.user?.picture || '';

  let type: string;
  let action_text: string;
  let sender_name: string;
  let sender_picture: string;

  if (isCoach) {
    type          = b.status === 'pending' ? 'new_booking' : b.status === 'accepted' ? 'booking_accepted' : 'booking_refused';
    action_text   = b.status === 'pending' ? 'souhaite réserver' : b.status === 'accepted' ? 'a confirmé sa réservation' : 'a annulé sa réservation';
    sender_name   = userName;
    sender_picture = userPic;
  } else {
    type          = b.status === 'accepted' ? 'booking_accepted' : b.status === 'refused' ? 'booking_refused' : 'booking_pending';
    action_text   = b.status === 'accepted' ? 'a accepté votre réservation' : b.status === 'refused' ? 'a refusé votre réservation' : 'n\'a pas encore répondu';
    sender_name   = coachName;
    sender_picture = coachPic;
  }

  return {
    id: b.booking_id,
    type,
    action_text,
    content_title: svcTitle,
    sender_name,
    sender_picture,
    time: b.created_at || new Date().toISOString(),
    action: b.service?.service_id ? `/service/${b.service.service_id}` : '/planning',
    read: b.status !== 'pending',
  };
}

// ── Item notification ─────────────────────────────────────────────────────────
function NotifItem({ item, onPress }: { item: any; onPress: () => void }) {
  const cfg = NOTIF_CFG[item.type] || NOTIF_CFG.info;
  const hasSender = !!item.sender_name;

  return (
    <TouchableOpacity
      style={[ni.row, !item.read && ni.rowUnread]}
      onPress={onPress}
      activeOpacity={0.75}
      testID={`notif-${item.id}`}
    >
      {/* Avatar ou icône */}
      {hasSender ? (
        <View style={ni.avatarWrap}>
          {item.sender_picture ? (
            <Image source={{ uri: item.sender_picture }} style={ni.avatar} />
          ) : (
            <View style={[ni.avatarFallback, { backgroundColor: cfg.bg }]}>
              <Text style={[ni.avatarInitial, { color: cfg.color }]}>
                {item.sender_name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          {/* Badge type */}
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
  const router = useRouter();
  const [notifs, setNotifs]     = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [me, bookings, dbNotifs] = await Promise.all([
        api.get<any>('/auth/me'),
        api.get<any[]>('/bookings/mine').catch(() => []),
        api.get<any[]>('/users/me/notifications').catch(() => []),
      ]);
      const isCoach = me?.role === 'coach' || me?.is_coach;

      // Booking → notification
      const bookingList = Array.isArray(bookings)
        ? bookings.map(b => bookingToNotif(b, isCoach))
        : [];

      // DB notifications (SpotYou, etc.)
      const dbList = Array.isArray(dbNotifs)
        ? dbNotifs.map(n => {
            const d = n.data || {};
            // Routing intelligent
            let action = '/planning';
            if (d.point_id) action = `/spot-you/${d.point_id}`;
            else if (d.service_id) action = `/service/${d.service_id}`;

            return {
              id: n.id,
              type: n.type || d.type || 'info',
              sender_name: d.sender_name || '',
              sender_picture: d.sender_picture || '',
              action_text: d.action_text || n.body || '',
              content_title: d.content_title || '',
              time: n.created_at || new Date().toISOString(),
              action,
              read: n.read,
            };
          })
        : [];

      const merged = [...bookingList, ...dbList];
      merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
      setNotifs(merged);
      setUnreadCount(merged.filter(n => !n.read).length);
    } catch {
      setNotifs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const markAllRead = async () => {
    try {
      await api.patch('/users/me/notifications/read-all', {});
      setNotifs(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {}
  };

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

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : notifs.length === 0 ? (
        <View style={s.center} testID="empty-notifs">
          <Ionicons name="notifications-outline" size={56} color={Colors.muted} />
          <Text style={s.emptyTitle}>Aucune notification</Text>
          <Text style={s.emptySub}>
            Vos activités (réservations, SpotYou, évaluations) apparaîtront ici.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifs}
          keyExtractor={n => n.id}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          renderItem={({ item }) => (
            <NotifItem item={item} onPress={() => router.push(item.action as any)} />
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
