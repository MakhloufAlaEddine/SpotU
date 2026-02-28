import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const ORANGE = '#FF9500';

const DAYS_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MONTHS = ['jan','fév','mars','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${DAYS_FULL[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: 'En attente',  color: ORANGE,          bg: 'rgba(255,149,0,0.12)' },
  accepted: { label: 'Acceptée',    color: Colors.primary,  bg: 'rgba(29,191,115,0.12)' },
  refused:  { label: 'Refusée',     color: '#FF4444',       bg: 'rgba(255,68,68,0.12)' },
  cancelled:{ label: 'Annulée',     color: Colors.muted,    bg: 'rgba(139,148,158,0.12)' },
};

function BookingCard({ item, onAccept, onRefuse }: { item: any; onAccept: () => void; onRefuse: () => void }) {
  const sc = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
  const isPending = item.status === 'pending';

  return (
    <View style={card.container}>
      {/* Header: user + status */}
      <View style={card.header}>
        <View style={card.userRow}>
          <View style={card.avatar}>
            {item.user?.picture
              ? <Image source={{ uri: item.user.picture }} style={{ width: '100%', height: '100%' }} />
              : <Text style={card.avatarTxt}>{item.user?.name?.charAt(0)?.toUpperCase() || '?'}</Text>
            }
          </View>
          <View>
            <Text style={card.userName}>{item.user?.name || 'Utilisateur'}</Text>
            {item.scheduled_at && (
              <Text style={card.dateText}>{formatDate(item.scheduled_at)}</Text>
            )}
          </View>
        </View>
        <View style={[card.statusBadge, { backgroundColor: sc.bg }]}>
          <Text style={[card.statusText, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>

      {/* Service name */}
      <Text style={card.serviceTitle} numberOfLines={1}>{item.service?.title || 'Service'}</Text>

      {/* Créneau */}
      {item.slot && (
        <View style={card.slotRow}>
          <Ionicons name="time-outline" size={14} color={ORANGE} />
          <Text style={card.slotText}>
            {item.slot.slot_date
              ? `${formatDate(item.slot.slot_date + 'T00:00:00')} · ${item.slot.start_time}`
              : `${DAYS_FULL[item.slot.day_of_week] ?? ''} · ${item.slot.start_time}`
            }
          </Text>
        </View>
      )}

      {/* Message du user */}
      {item.notes ? (
        <View style={card.noteBox}>
          <Ionicons name="chatbubble-outline" size={13} color={Colors.muted} />
          <Text style={card.noteText} numberOfLines={3}>{item.notes}</Text>
        </View>
      ) : null}

      {/* Actions */}
      {isPending && (
        <View style={card.actions}>
          <TouchableOpacity
            style={card.refuseBtn}
            onPress={onRefuse}
            testID={`refuse-booking-${item.booking_id}`}
          >
            <Ionicons name="close" size={16} color="#FF4444" />
            <Text style={card.refuseTxt}>Refuser</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={card.acceptBtn}
            onPress={onAccept}
            testID={`accept-booking-${item.booking_id}`}
          >
            <Ionicons name="checkmark" size={16} color={Colors.background} />
            <Text style={card.acceptTxt}>Accepter</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  container: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.border },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarTxt: { fontSize: 14, fontWeight: '800', color: Colors.background },
  userName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  dateText: { fontSize: 12, color: Colors.muted, marginTop: 1 },
  statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  serviceTitle: { fontSize: 13, color: Colors.muted, marginBottom: 8 },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  slotText: { fontSize: 13, color: ORANGE, fontWeight: '600' },
  noteBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.background, borderRadius: 10, padding: 10, marginBottom: 10 },
  noteText: { flex: 1, fontSize: 13, color: Colors.muted, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  refuseBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: Radius.full, paddingVertical: 10, borderWidth: 1, borderColor: '#FF4444' },
  refuseTxt: { fontSize: 14, fontWeight: '700', color: '#FF4444' },
  acceptBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 10 },
  acceptTxt: { fontSize: 14, fontWeight: '700', color: Colors.background },
});

type FilterStatus = 'pending' | 'all';

export default function CoachBookingsScreen() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>('pending');

  const load = async () => {
    try {
      const data = await api.get('/bookings/coach');
      setBookings(Array.isArray(data) ? data : []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, []));

  const handleAction = async (bookingId: string, status: 'accepted' | 'refused') => {
    try {
      await api.put(`/bookings/${bookingId}/status`, { status });
      setBookings(prev => prev.map(b =>
        b.booking_id === bookingId ? { ...b, status } : b
      ));
    } catch (err: any) {
      alert(err.message || 'Erreur');
    }
  };

  const filtered = filter === 'pending'
    ? bookings.filter(b => b.status === 'pending')
    : bookings;

  const pendingCount = bookings.filter(b => b.status === 'pending').length;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Demandes de réservation</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Filtres */}
        <View style={s.filters}>
          <TouchableOpacity
            style={[s.filterBtn, filter === 'pending' && s.filterBtnActive]}
            onPress={() => setFilter('pending')}
            testID="filter-pending"
          >
            <Text style={[s.filterTxt, filter === 'pending' && s.filterTxtActive]}>
              En attente {pendingCount > 0 ? `(${pendingCount})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.filterBtn, filter === 'all' && s.filterBtnActive]}
            onPress={() => setFilter('all')}
            testID="filter-all"
          >
            <Text style={[s.filterTxt, filter === 'all' && s.filterTxtActive]}>
              Tout ({bookings.length})
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="calendar-outline" size={56} color={Colors.muted} />
          <Text style={s.emptyTitle}>
            {filter === 'pending' ? 'Aucune demande en attente' : 'Aucune réservation'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.booking_id}
          contentContainerStyle={{ padding: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          renderItem={({ item }) => (
            <BookingCard
              item={item}
              onAccept={() => handleAction(item.booking_id, 'accepted')}
              onRefuse={() => handleAction(item.booking_id, 'refused')}
            />
          )}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  filters: { flexDirection: 'row', padding: 12, gap: 8 },
  filterBtn: { flex: 1, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTxt: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  filterTxtActive: { color: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: Colors.muted, textAlign: 'center' },
});
