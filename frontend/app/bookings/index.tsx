/**
 * app/bookings/index.tsx — Mes réservations (vue payer)
 *
 * Règles financières :
 *  - Montants TOUJOURS depuis pricing_snapshot.payer_total_amount (jamais recalculés)
 *  - Statuts paiement TOUJOURS depuis backend (booking.payment_status)
 *  - Aucun statut simulé
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { ScreenLoader } from '../../components/ScreenLoader';
import { EmptyState } from '../../components/EmptyState';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

// ── Statuts booking ────────────────────────────────────────────────────────────

const BOOKING_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  requested:        { label: 'En attente',          color: '#FF9500', icon: 'time-outline' },
  pending:          { label: 'En attente',          color: '#FF9500', icon: 'time-outline' },
  awaiting_payment: { label: 'Paiement en attente', color: '#0A84FF', icon: 'card-outline' },
  accepted:         { label: 'Acceptée',             color: '#34C759', icon: 'checkmark-circle-outline' },
  confirmed:        { label: 'Confirmée',            color: '#1DBF73', icon: 'checkmark-circle' },
  refused:          { label: 'Refusée',              color: '#FF3B30', icon: 'close-circle-outline' },
  expired:          { label: 'Expirée',              color: '#636366', icon: 'timer-outline' },
  cancelled:        { label: 'Annulée',              color: '#636366', icon: 'ban-outline' },
  completed:        { label: 'Terminée',             color: '#00BFA5', icon: 'ribbon-outline' },
};

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  pending:              { label: 'Paiement en attente', color: '#FF9500' },
  unpaid:               { label: 'Non payé',            color: '#FF9500' },
  requires_authorization: { label: 'Autorisé',         color: '#007AFF' },
  authorized:           { label: 'Autorisé',           color: '#007AFF' },
  captured:             { label: 'Payé',                color: '#34C759' },
  paid:                 { label: 'Payé',                color: '#34C759' },
  failed:               { label: 'Paiement échoué',     color: '#FF3B30' },
  cancelled:            { label: 'Annulé',              color: '#636366' },
  refunded:             { label: 'Remboursé',           color: '#BF5AF2' },
  partially_refunded:   { label: 'Remboursé partiellement', color: '#BF5AF2' },
};

type FilterTab = 'all' | 'active' | 'done' | 'cancelled';

const FILTERS: { key: FilterTab; label: string }[] = [
  { key: 'all',       label: 'Toutes' },
  { key: 'active',    label: 'En cours' },
  { key: 'done',      label: 'Terminées' },
  { key: 'cancelled', label: 'Annulées' },
];

function filterBookings(bookings: any[], tab: FilterTab): any[] {
  if (tab === 'all') return bookings;
  if (tab === 'active')    return bookings.filter(b => ['requested', 'pending', 'accepted', 'awaiting_payment', 'confirmed'].includes(b.status));
  if (tab === 'done')      return bookings.filter(b => ['completed'].includes(b.status));
  if (tab === 'cancelled') return bookings.filter(b => ['refused', 'expired', 'cancelled'].includes(b.status));
  return bookings;
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return '';
  return timeStr.slice(0, 5); // "09:00:00" → "09:00"
}

function formatSlotTime(booking: any): string {
  const start = formatTime(booking.slot_start_time);
  const end   = formatTime(booking.slot_end_time);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (booking.scheduled_at) {
    const d = new Date(booking.scheduled_at);
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  return '';
}

function getAmount(booking: any): number | null {
  const snap = booking.pricing_snapshot;
  if (snap?.payer_total_amount != null) return snap.payer_total_amount;
  if (booking.amount != null) return booking.amount;
  return null;
}

// ── Countdown hook ─────────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | null | undefined): string | null {
  const [label, setLabel] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!expiresAt) return;
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setLabel('Expiré'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      if (h > 0) setLabel(`${h}h ${m}m`);
      else if (m > 0) setLabel(`${m}m ${sec}s`);
      else setLabel(`${sec}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return label;
}

// ── Carte de réservation ───────────────────────────────────────────────────────

function BookingCard({ booking, onPress }: { booking: any; onPress: () => void }) {
  const bStatus = BOOKING_STATUS[booking.status] ?? { label: booking.status, color: Colors.muted, icon: 'help-circle-outline' };
  const amount  = getAmount(booking);
  const date    = formatDate(booking.slot_date || booking.scheduled_at || booking.created_at);
  const time    = formatSlotTime(booking);

  return (
    <TouchableOpacity
      style={c.card}
      onPress={onPress}
      activeOpacity={0.78}
      testID={`booking-card-${booking.booking_id}`}
    >
      {/* Statut bar gauche */}
      <View style={[c.statusBar, { backgroundColor: bStatus.color }]} />

      <View style={c.cardBody}>
        <View style={c.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={c.serviceTitle} numberOfLines={1}>
              {booking.service_title || 'Prestation'}
            </Text>
            <Text style={c.coachName} numberOfLines={1}>
              avec {booking.receiver_name || '—'}
            </Text>
          </View>
          {amount != null && (
            <Text style={c.amount}>{amount.toFixed(2)} €</Text>
          )}
        </View>

        {/* Date + Heure */}
        <View style={c.infoRow}>
          <Ionicons name="calendar-outline" size={13} color={Colors.muted} />
          <Text style={c.infoText}>
            {(booking.slot_date || booking.scheduled_at) ? formatDate(booking.slot_date || booking.scheduled_at) : `Demandé le ${date}`}
          </Text>
          {time ? (
            <>
              <Text style={c.infoDot}>·</Text>
              <Ionicons name="time-outline" size={13} color={Colors.muted} />
              <Text style={c.infoText}>{time}</Text>
            </>
          ) : null}
        </View>

        {/* Badge statut */}
        <View style={c.badgesRow}>
          <View style={[c.badge, { backgroundColor: bStatus.color + '22' }]}>
            <Ionicons name={bStatus.icon as any} size={11} color={bStatus.color} />
            <Text style={[c.badgeText, { color: bStatus.color }]}>{bStatus.label}</Text>
          </View>
          {['requested', 'accepted', 'awaiting_payment'].includes(booking.status) && (
            <View style={c.tapHint}>
              <Text style={c.tapHintText}>Voir le détail</Text>
              <Ionicons name="chevron-forward" size={12} color={Colors.muted} />
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Écran principal ────────────────────────────────────────────────────────────

export default function MyBookingsScreen() {
  const router = useGuardedRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]     = useState<FilterTab>('all');
  const [paying, setPaying]     = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any[]>('/bookings/me');
      setBookings(Array.isArray(data) ? data : []);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const handlePay = async (booking: any) => {
    setPaying(booking.booking_id);
    try {
      const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.post<{ url: string; session_id: string }>(
        `/bookings/${booking.booking_id}/pay`,
        { origin_url: originUrl },
      );
      await Linking.openURL(res.url);
    } catch (err: any) {
      alert(err.message || 'Impossible de lancer le paiement');
    } finally {
      setPaying(null);
    }
  };

  const handleCancel = (booking: any) => {
    Alert.alert(
      'Annuler la réservation',
      `Confirmer l'annulation de "${booking.service_title || 'cette réservation'}" avec ${booking.receiver_name || 'le coach'} ?`,
      [
        { text: 'Non, garder', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            setCancelling(booking.booking_id);
            try {
              await api.post(`/bookings/${booking.booking_id}/cancel`, {});
              // Retirer localement pour feedback immédiat, puis recharger
              setBookings(prev =>
                prev.map(b =>
                  b.booking_id === booking.booking_id
                    ? { ...b, status: 'cancelled', payment_status: 'not_required' }
                    : b
                )
              );
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible d\'annuler la réservation.');
            } finally {
              setCancelling(null);
            }
          },
        },
      ]
    );
  };

  const filtered = filterBookings(bookings, filter);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Mes réservations</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Filtres */}
        <View style={s.filterBar}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[s.filterBtn, filter === f.key && s.filterBtnActive]}
              onPress={() => setFilter(f.key)}
              testID={`filter-${f.key}`}
            >
              <Text style={[s.filterTxt, filter === f.key && s.filterTxtActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>

      {loading ? (
        <ScreenLoader />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="calendar-outline"
          title="Aucune réservation"
          subtitle={filter === 'all' ? 'Vos réservations apparaîtront ici.' : 'Aucune réservation dans cette catégorie.'}
          testID="empty-bookings"
        />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={b => b.booking_id}
          renderItem={({ item }) => (
            <BookingCard
              booking={item}
              onPress={() => router.push(`/bookings/${item.booking_id}` as any)}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />
          }
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {paying && (
        <View style={s.payingOverlay}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={s.payingText}>Redirection vers le paiement…</Text>
        </View>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  filterBar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  filterBtn: { flex: 1, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTxt: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  filterTxtActive: { color: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  payingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  payingText: { fontSize: 15, color: Colors.foreground, fontWeight: '600' },
});

const c = StyleSheet.create({
  card: {
    flexDirection: 'row', backgroundColor: Colors.card,
    borderRadius: Radius.lg, overflow: 'hidden',
    borderWidth: 1, borderColor: Colors.border,
  },
  statusBar: { width: 4 },
  cardBody: { flex: 1, padding: 14, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  serviceTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  coachName: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  amount: { fontSize: 18, fontWeight: '800', color: Colors.primary, marginLeft: 8 },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  infoText: { fontSize: 12, color: Colors.muted },
  infoDot: { fontSize: 12, color: Colors.muted, marginHorizontal: 1 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'space-between' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  badgeText: { fontSize: 11, fontWeight: '600' },
  tapHint: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tapHintText: { fontSize: 11, color: Colors.muted },
});
