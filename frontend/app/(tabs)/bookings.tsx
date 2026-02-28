import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const ORANGE = '#FF9500';
const DAYS = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
const MONTHS = ['jan','fév','mars','avr','mai','juin','juil','aoû','sep','oct','nov','déc'];

function fmtDate(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: any }> = {
  pending:   { label: 'En attente du coach', color: ORANGE,         icon: 'time-outline' },
  accepted:  { label: 'Acceptée',            color: Colors.primary, icon: 'checkmark-circle-outline' },
  refused:   { label: 'Refusée',             color: '#FF4444',      icon: 'close-circle-outline' },
  cancelled: { label: 'Annulée',             color: Colors.muted,   icon: 'ban-outline' },
};

function BookingRow({ item }: { item: any }) {
  const sc = STATUS_CFG[item.status] || STATUS_CFG.pending;

  return (
    <View style={card.wrap} testID={`booking-${item.booking_id}`}>
      <View style={card.imgWrap}>
        <View style={{ width: '100%', height: '100%', backgroundColor: '#1A1000', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="calendar-outline" size={24} color="rgba(255,149,0,0.25)" />
        </View>
      </View>
      <View style={card.info}>
        <Text style={card.title} numberOfLines={2}>{item.service?.title || 'Service'}</Text>
        <View style={card.coachRow}>
          <Ionicons name="person-outline" size={12} color={Colors.muted} />
          <Text style={card.coachName}>{item.coach?.name || 'Coach'}</Text>
        </View>
        {item.slot && (
          <View style={card.slotRow}>
            <Ionicons name="time-outline" size={12} color={ORANGE} />
            <Text style={card.slotTxt}>
              {item.slot.slot_date
                ? `${fmtDate(item.slot.slot_date + 'T00:00:00')} · ${item.slot.start_time}`
                : item.scheduled_at ? fmtDate(item.scheduled_at) : item.slot.start_time}
            </Text>
          </View>
        )}
        <View style={[card.status, { backgroundColor: sc.color + '1A' }]}>
          <Ionicons name={sc.icon} size={12} color={sc.color} />
          <Text style={[card.statusTxt, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  imgWrap: { width: 72, height: 72, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.card },
  info: { flex: 1, gap: 5 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  coachName: { fontSize: 12, color: Colors.muted },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  slotTxt: { fontSize: 12, color: ORANGE, fontWeight: '600' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start', marginTop: 2 },
  statusTxt: { fontSize: 11, fontWeight: '700' },
});

export default function MyBookingsScreen() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await api.get('/bookings/mine');
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

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Mes réservations</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : bookings.length === 0 ? (
        <View style={s.center} testID="empty-bookings">
          <Ionicons name="calendar-outline" size={56} color={Colors.muted} />
          <Text style={s.emptyTitle}>Aucune réservation</Text>
          <Text style={s.emptySub}>Réservez une séance auprès d'un coach pour commencer.</Text>
          <TouchableOpacity style={s.exploreBtn} onPress={() => router.push('/(tabs)/search' as any)}>
            <Text style={s.exploreBtnTxt}>Trouver un coach</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={bookings}
          keyExtractor={item => item.booking_id}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          renderItem={({ item }) => <BookingRow item={item} />}
          ListHeaderComponent={
            <Text style={s.count}>{bookings.length} réservation{bookings.length > 1 ? 's' : ''}</Text>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptySub: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  exploreBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 28, paddingVertical: 12 },
  exploreBtnTxt: { fontSize: 15, fontWeight: '700', color: Colors.background },
  count: { fontSize: 13, color: Colors.muted, paddingVertical: 14 },
});
