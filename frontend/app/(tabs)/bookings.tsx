import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ── Config visuelle par type ──────────────────────────────────────────────────
const NOTIF_CFG: Record<string, { icon: any; color: string; bg: string }> = {
  booking_new:       { icon: 'calendar-outline',         color: Colors.primary, bg: Colors.primary + '1A' },
  booking_accepted:  { icon: 'checkmark-circle-outline', color: Colors.primary, bg: Colors.primary + '1A' },
  booking_refused:   { icon: 'close-circle-outline',     color: '#FF4444',      bg: '#FF44441A' },
  booking_pending:   { icon: 'time-outline',             color: '#FF9500',      bg: '#FF95001A' },
  spotyu_cancelled:  { icon: 'close-circle',             color: '#EF4444',      bg: '#EF44441A' },
  spotyu_restored:   { icon: 'refresh-circle',           color: Colors.primary, bg: Colors.primary + '1A' },
  spotyu_updated:    { icon: 'create-outline',           color: '#F59E0B',      bg: '#F59E0B1A' },
  info:              { icon: 'information-circle-outline', color: Colors.muted, bg: Colors.card },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `il y a ${days}j`;
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function bookingToNotif(b: any, isCoach: boolean) {
  const svcTitle  = b.service?.title || 'une séance';
  const coachName = b.coach?.name || 'le coach';
  const userName  = b.user?.name || 'un utilisateur';
  let type: string;
  let title: string;
  let subtitle: string;

  if (isCoach) {
    type     = b.status === 'pending' ? 'booking_new' : b.status === 'accepted' ? 'booking_accepted' : 'booking_refused';
    title    = b.status === 'pending' ? 'Nouvelle réservation' : b.status === 'accepted' ? 'Séance confirmée' : 'Séance refusée';
    subtitle = b.status === 'pending'
      ? `${userName} souhaite réserver : ${svcTitle}`
      : `${svcTitle} — ${b.status === 'accepted' ? 'confirmée' : 'refusée'}`;
  } else {
    type     = b.status === 'accepted' ? 'booking_accepted' : b.status === 'refused' ? 'booking_refused' : 'booking_pending';
    title    = b.status === 'accepted' ? 'Séance acceptée !' : b.status === 'refused' ? 'Séance refusée' : 'En attente du coach';
    subtitle = b.status === 'accepted'
      ? `${coachName} a accepté votre réservation pour ${svcTitle}`
      : b.status === 'refused'
      ? `${coachName} n'est pas disponible pour ${svcTitle}`
      : `${coachName} n'a pas encore répondu pour ${svcTitle}`;
  }
  return { id: b.booking_id, type, title, subtitle, time: b.created_at || new Date().toISOString(), action: '/planning', read: true };
}

// ── Item notification ─────────────────────────────────────────────────────────
function NotifItem({ item, onPress }: { item: any; onPress: () => void }) {
  const cfg = NOTIF_CFG[item.type] || NOTIF_CFG.info;
  return (
    <TouchableOpacity
      style={[ni.row, !item.read && ni.rowUnread]}
      onPress={onPress}
      activeOpacity={0.75}
      testID={`notif-${item.id}`}
    >
      <View style={[ni.iconBox, { backgroundColor: cfg.bg }]}>
        <Ionicons name={cfg.icon} size={22} color={cfg.color} />
      </View>
      <View style={ni.content}>
        <View style={ni.topRow}>
          <Text style={ni.title} numberOfLines={1}>{item.title}</Text>
          <Text style={ni.time}>{timeAgo(item.time)}</Text>
        </View>
        <Text style={ni.sub} numberOfLines={2}>{item.subtitle}</Text>
      </View>
      {!item.read && <View style={ni.dot} />}
      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
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
      const [me, bookings, spotYouNotifs] = await Promise.all([
        api.get<any>('/auth/me'),
        api.get<any[]>('/bookings/mine').catch(() => []),
        api.get<any[]>('/users/me/notifications').catch(() => []),
      ]);
      const isCoach = me?.role === 'coach' || me?.is_coach;
      const bookingList = Array.isArray(bookings) ? bookings.map(b => bookingToNotif(b, isCoach)) : [];
      const spotYouList = Array.isArray(spotYouNotifs)
        ? spotYouNotifs.map(n => ({
            id: n.id,
            type: n.type,
            title: n.title,
            subtitle: n.body,
            time: n.created_at || new Date().toISOString(),
            action: n.data?.point_id ? `/spot-you/${n.data.point_id}` : '/planning',
            read: n.read,
          }))
        : [];
      const merged = [...bookingList, ...spotYouList];
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
              <Text style={s.readAllBtn}>Tout lire</Text>
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
            Vos réservations et événements SpotYou apparaîtront ici.
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
            <View style={{ height: 1, backgroundColor: Colors.border, marginLeft: 70 }} />
          )}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}
    </View>
  );
}

const ni = StyleSheet.create({
  row:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowUnread:  { backgroundColor: Colors.primary + '08' },
  iconBox:    { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  content:    { flex: 1, gap: 3 },
  topRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title:      { fontSize: 14, fontWeight: '700', color: Colors.foreground, flex: 1 },
  time:       { fontSize: 11, color: Colors.muted, marginLeft: 8 },
  sub:        { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, alignSelf: 'center' },
});

const s = StyleSheet.create({
  header:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  readAllBtn:  { fontSize: 13, fontWeight: '600', color: Colors.primary },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyTitle:  { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptySub:    { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});
