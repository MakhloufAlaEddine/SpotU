/**
 * app/bookings/received.tsx — Demandes reçues (vue receiver/coach)
 *
 * Règles financières :
 *  - Montants depuis pricing_snapshot.payer_total_amount uniquement
 *  - Statuts paiement inchangés depuis backend
 *  - Accept/Refuse calls → /bookings/{id}/accept | /refuse
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ── Statuts ────────────────────────────────────────────────────────────────────

const BOOKING_STATUS: Record<string, { label: string; color: string; icon: string }> = {
  requested:        { label: 'En attente',          color: '#FF9500', icon: 'time-outline' },
  awaiting_payment: { label: 'Paiement en attente', color: '#0A84FF', icon: 'card-outline' },
  accepted:         { label: 'Acceptée',             color: '#34C759', icon: 'checkmark-circle-outline' },
  confirmed:        { label: 'Confirmée',            color: '#1DBF73', icon: 'checkmark-circle' },
  refused:          { label: 'Refusée',              color: '#FF3B30', icon: 'close-circle-outline' },
  expired:          { label: 'Expirée',              color: '#636366', icon: 'timer-outline' },
  cancelled:        { label: 'Annulée',              color: '#636366', icon: 'ban-outline' },
  completed:        { label: 'Terminée',             color: '#00BFA5', icon: 'ribbon-outline' },
};

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  pending:              { label: 'En attente', color: '#FF9500' },
  unpaid:               { label: 'Non payé',   color: '#FF9500' },
  authorized:           { label: 'Autorisé',   color: '#007AFF' },
  captured:             { label: 'Payé',        color: '#34C759' },
  paid:                 { label: 'Payé',        color: '#34C759' },
  failed:               { label: 'Échoué',      color: '#FF3B30' },
  cancelled:            { label: 'Annulé',      color: '#636366' },
  refunded:             { label: 'Remboursé',   color: '#BF5AF2' },
};

type FilterTab = 'pending' | 'awaiting_payment' | 'accepted' | 'refused' | 'all';

const FILTERS: { key: FilterTab; label: string }[] = [
  { key: 'pending',          label: 'À traiter' },
  { key: 'awaiting_payment', label: 'Paiement' },
  { key: 'accepted',         label: 'Acceptées' },
  { key: 'refused',          label: 'Refusées' },
  { key: 'all',              label: 'Toutes' },
];

function filterBookings(bookings: any[], tab: FilterTab): any[] {
  if (tab === 'all')              return bookings;
  if (tab === 'pending')          return bookings.filter(b => b.status === 'requested');
  if (tab === 'awaiting_payment') return bookings.filter(b => b.status === 'awaiting_payment');
  if (tab === 'accepted')         return bookings.filter(b => ['accepted', 'confirmed', 'completed'].includes(b.status));
  if (tab === 'refused')          return bookings.filter(b => ['refused', 'expired', 'cancelled'].includes(b.status));
  return bookings;
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

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getAmount(booking: any): number | null {
  const snap = booking.pricing_snapshot;
  if (snap?.payer_total_amount != null) return snap.payer_total_amount;
  if (booking.amount != null) return booking.amount;
  return null;
}

// ── Carte de demande ───────────────────────────────────────────────────────────

function ReceivedCard({
  booking, onAccept, onRefuse, accepting, refusing,
}: {
  booking: any;
  onAccept: () => void;
  onRefuse: () => void;
  accepting: boolean;
  refusing: boolean;
}) {
  const bStatus = BOOKING_STATUS[booking.status] ?? { label: booking.status, color: Colors.muted, icon: 'help-circle-outline' };
  const pStatus = PAYMENT_STATUS[booking.payment_status ?? 'pending'];
  const amount  = getAmount(booking);
  const isPending = booking.status === 'requested';
  const isAwaitingPayment = booking.status === 'awaiting_payment';
  const countdown = useCountdown(isAwaitingPayment ? booking.expires_at : null);
  const isExpired = countdown === 'Expiré';

  return (
    <View style={c.card} testID={`received-card-${booking.booking_id}`}>
      <View style={[c.statusBar, { backgroundColor: bStatus.color }]} />
      <View style={c.cardBody}>

        {/* Demandeur */}
        <View style={c.topRow}>
          <View style={c.avatarCircle}>
            <Text style={c.avatarInitial}>
              {(booking.payer_name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={c.payerName}>{booking.payer_name || 'Utilisateur'}</Text>
            <Text style={c.serviceTitle} numberOfLines={1}>
              {booking.service_title || 'Prestation'}
            </Text>
          </View>
          {amount != null && (
            <Text style={c.amount}>{amount.toFixed(2)} €</Text>
          )}
        </View>

        {/* Date */}
        <View style={c.infoRow}>
          <Ionicons name="calendar-outline" size={13} color={Colors.muted} />
          <Text style={c.infoText}>
            Reçue le {formatDate(booking.created_at)}
          </Text>
        </View>

        {/* Expiration — requested */}
        {isPending && booking.expires_at && (
          <View style={c.infoRow}>
            <Ionicons name="timer-outline" size={13} color="#FF9500" />
            <Text style={[c.infoText, { color: '#FF9500' }]}>
              Expire le {formatDate(booking.expires_at)}
            </Text>
          </View>
        )}

        {/* Countdown paiement — awaiting_payment */}
        {isAwaitingPayment && countdown && (
          <View style={[c.countdownRow, isExpired && c.countdownRowExpired]}>
            <Ionicons name="timer-outline" size={14} color={isExpired ? '#FF3B30' : '#0A84FF'} />
            <Text style={[c.countdownText, isExpired && c.countdownTextExpired]}>
              {isExpired
                ? 'Délai expiré — créneau libéré automatiquement'
                : `⏱ Paiement attendu dans : ${countdown}`}
            </Text>
          </View>
        )}

        {/* Message payer */}
        {booking.notes ? (
          <View style={c.noteBox}>
            <Ionicons name="chatbubble-outline" size={13} color={Colors.muted} />
            <Text style={c.noteText} numberOfLines={2}>{booking.notes}</Text>
          </View>
        ) : null}

        {/* Statuts */}
        <View style={c.badgesRow}>
          <View style={[c.badge, { backgroundColor: bStatus.color + '22' }]}>
            <Ionicons name={bStatus.icon as any} size={11} color={bStatus.color} />
            <Text style={[c.badgeText, { color: bStatus.color }]}>{bStatus.label}</Text>
          </View>
          {booking.payment_status && (
            <View style={[c.badge, { backgroundColor: (pStatus?.color ?? Colors.muted) + '22' }]}>
              <Ionicons name="card-outline" size={11} color={pStatus?.color ?? Colors.muted} />
              <Text style={[c.badgeText, { color: pStatus?.color ?? Colors.muted }]}>
                {pStatus?.label ?? booking.payment_status}
              </Text>
            </View>
          )}
        </View>

        {/* Boutons Accept/Refuse — uniquement pour les demandes en attente */}
        {isPending && (
          <View style={c.actionRow}>
            <TouchableOpacity
              style={[c.refuseBtn, refusing && { opacity: 0.5 }]}
              onPress={onRefuse}
              disabled={accepting || refusing}
              testID={`refuse-btn-${booking.booking_id}`}
            >
              {refusing
                ? <ActivityIndicator size="small" color="#FF3B30" />
                : <>
                    <Ionicons name="close" size={16} color="#FF3B30" />
                    <Text style={c.refuseTxt}>Refuser</Text>
                  </>
              }
            </TouchableOpacity>
            <TouchableOpacity
              style={[c.acceptBtn, accepting && { opacity: 0.5 }]}
              onPress={onAccept}
              disabled={accepting || refusing}
              testID={`accept-btn-${booking.booking_id}`}
            >
              {accepting
                ? <ActivityIndicator size="small" color="#fff" />
                : <>
                    <Ionicons name="checkmark" size={16} color="#fff" />
                    <Text style={c.acceptTxt}>Accepter</Text>
                  </>
              }
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

// ── Écran principal ────────────────────────────────────────────────────────────

export default function ReceivedBookingsScreen() {
  const router = useRouter();
  const [bookings, setBookings]   = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]       = useState<FilterTab>('pending');
  const [actioning, setActioning] = useState<{ id: string; type: 'accept' | 'refuse' } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<any[]>('/bookings/received');
      setBookings(Array.isArray(data) ? data : []);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const handleAccept = async (booking: any) => {
    setActioning({ id: booking.booking_id, type: 'accept' });
    try {
      const result = await api.post<any>(`/bookings/${booking.booking_id}/accept`);
      const newStatus = result.status || 'awaiting_payment';
      setBookings(prev => prev.map(b =>
        b.booking_id === booking.booking_id
          ? { ...b, status: newStatus, expires_at: result.expires_at ?? b.expires_at }
          : b
      ));
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible d\'accepter la demande');
    } finally {
      setActioning(null);
    }
  };

  const handleRefuse = async (booking: any) => {
    Alert.alert(
      'Refuser la demande',
      `Confirmer le refus de la demande de ${booking.payer_name || 'cet utilisateur'} ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Refuser', style: 'destructive',
          onPress: async () => {
            setActioning({ id: booking.booking_id, type: 'refuse' });
            try {
              await api.post(`/bookings/${booking.booking_id}/refuse`);
              setBookings(prev => prev.map(b =>
                b.booking_id === booking.booking_id ? { ...b, status: 'refused' } : b
              ));
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible de refuser la demande');
            } finally {
              setActioning(null);
            }
          },
        },
      ]
    );
  };

  const pendingCount    = bookings.filter(b => b.status === 'requested').length;
  const awaitingPayCount = bookings.filter(b => b.status === 'awaiting_payment').length;
  const filtered = filterBookings(bookings, filter);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Text style={s.headerTitle}>Demandes reçues</Text>
            {pendingCount > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{pendingCount}</Text>
              </View>
            )}
          </View>
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
              {f.key === 'pending' && pendingCount > 0 && (
                <View style={s.filterDot} />
              )}
              {f.key === 'awaiting_payment' && awaitingPayCount > 0 && (
                <View style={[s.filterDot, { backgroundColor: '#0A84FF' }]} />
              )}
            </TouchableOpacity>
          ))}
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : filtered.length === 0 ? (
        <View style={s.center}>
          <Ionicons name="mail-open-outline" size={52} color={Colors.muted} />
          <Text style={s.emptyTitle}>
            {filter === 'pending' ? 'Aucune demande en attente' : 'Aucune demande'}
          </Text>
          <Text style={s.emptyText}>
            Les demandes de réservation apparaîtront ici.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={b => b.booking_id}
          renderItem={({ item }) => (
            <ReceivedCard
              booking={item}
              onAccept={() => handleAccept(item)}
              onRefuse={() => handleRefuse(item)}
              accepting={actioning?.id === item.booking_id && actioning.type === 'accept'}
              refusing={actioning?.id === item.booking_id && actioning.type === 'refuse'}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={Colors.primary}
            />
          }
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12 },
  backBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  badge: { backgroundColor: '#FF3B30', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  filterBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  filterBtn: { flex: 1, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.card, alignItems: 'center', borderWidth: 1, borderColor: Colors.border, flexDirection: 'row', justifyContent: 'center', gap: 4 },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTxt: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  filterTxtActive: { color: Colors.background },
  filterDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#FF3B30' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  emptyText: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
});

const c = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  statusBar: { width: 4 },
  cardBody: { flex: 1, padding: 14, gap: 8 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 17, fontWeight: '800', color: Colors.primary },
  payerName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  serviceTitle: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  amount: { fontSize: 17, fontWeight: '800', color: Colors.primary },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { fontSize: 12, color: Colors.muted },
  noteBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: Colors.cardElevated, borderRadius: 10, padding: 10 },
  noteText: { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 17 },
  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  refuseBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 30,
    borderWidth: 1.5, borderColor: '#FF3B3060',
  },
  refuseTxt: { fontSize: 14, fontWeight: '700', color: '#FF3B30' },
  acceptBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 30, backgroundColor: Colors.primary,
  },
  acceptTxt: { fontSize: 14, fontWeight: '700', color: Colors.background },
  // Countdown
  countdownRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: 'rgba(10,132,255,0.10)', borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: 'rgba(10,132,255,0.25)',
  },
  countdownRowExpired: {
    backgroundColor: 'rgba(255,59,48,0.10)', borderColor: 'rgba(255,59,48,0.25)',
  },
  countdownText: { fontSize: 12, fontWeight: '700', color: '#0A84FF', flex: 1 },
  countdownTextExpired: { color: '#FF3B30' },
});
