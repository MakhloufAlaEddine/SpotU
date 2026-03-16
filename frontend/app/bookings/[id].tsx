import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Linking, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { ScreenLoader } from '../../components/ScreenLoader';
import { UserAvatar } from '../../components/UserAvatar';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';
import { classifyFetchError, isOfflineOrTimeout } from '../../lib/network-error';
import { ErrorNoData } from '../../components/OfflineBanner';

// ── Countdown hook ──
function useExpired(expiresAt: string | null | undefined): { expired: boolean; countdown: string | null } {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return { expired: false, countdown: null };
  const diff = new Date(expiresAt).getTime() - now;
  if (diff <= 0) return { expired: true, countdown: 'Expiré' };
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { expired: false, countdown: `${m}:${s.toString().padStart(2, '0')}` };
}

// ── Status maps ────────────────────────────────────────────────────────────────
const BOOKING_STATUS: Record<string, { label: string; color: string; icon: string; desc: string }> = {
  requested:        { label: 'En attente',       color: '#FF9500', icon: 'time-outline',           desc: 'Votre demande est en attente de confirmation du coach.' },
  pending:          { label: 'En attente',       color: '#FF9500', icon: 'time-outline',           desc: 'Votre demande est en attente de confirmation du coach.' },
  accepted:         { label: 'Acceptée',          color: '#34C759', icon: 'checkmark-circle-outline', desc: 'Votre réservation est confirmée.' },
  awaiting_payment: { label: 'Paiement requis',   color: '#0A84FF', icon: 'card-outline',            desc: 'Le créneau est réservé, finalisez le paiement.' },
  completed:        { label: 'Terminée',           color: Colors.primary, icon: 'trophy-outline',   desc: 'La séance est terminée.' },
  refused:          { label: 'Refusée',            color: '#FF3B30', icon: 'close-circle-outline',   desc: 'Le coach n\'a pas accepté cette demande.' },
  cancelled:        { label: 'Annulée',            color: '#636366', icon: 'ban-outline',            desc: 'Cette réservation a été annulée.' },
  expired:          { label: 'Expirée',            color: '#636366', icon: 'alert-circle-outline',   desc: 'Le délai de paiement est dépassé.' },
};

const PAYMENT_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'En attente', color: '#FF9500' },
  paid:      { label: 'Payé',       color: '#34C759' },
  unpaid:    { label: 'Impayé',     color: '#FF3B30' },
  refunded:  { label: 'Remboursé',  color: '#0A84FF' },
  not_required: { label: 'Non requis', color: '#636366' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatFullDate(isoStr: string | null): string {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(t: string | null | undefined): string {
  if (!t) return '';
  return t.slice(0, 5);
}

function getAmount(b: any): number | null {
  const snap = b.pricing_snapshot;
  if (snap?.payer_total_amount != null) return snap.payer_total_amount;
  if (b.amount != null) return b.amount;
  return null;
}

// ── Screen ─────────────────────────────────────────────────────────────────────
export default function BookingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useGuardedRouter();
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isNetworkError, setIsNetworkError] = useState(false);
  const [paying, setPaying]   = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Hook countdown — DOIT être appelé avant tout return conditionnel
  const { expired: isExpired, countdown } = useExpired(booking?.expires_at);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadBooking();
    setTimeout(() => setRefreshing(false), 800);
  }, [loadBooking]);

  const loadBooking = useCallback(() => {
    setLoading(true);
    setIsNetworkError(false);
    api.get(`/bookings/${id}`)
      .then((data: any) => setBooking(data))
      .catch((e: any) => {
        const classified = classifyFetchError(e);
        if (isOfflineOrTimeout(classified)) setIsNetworkError(true);
      })
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(loadBooking);

  if (loading) return <ScreenLoader />;
  if (!booking) {
    const goBack = () => router.canGoBack() ? router.back() : router.replace('/bookings' as any);
    if (isNetworkError) {
      return (
        <SafeAreaView style={s.safe}>
          <ErrorNoData
            onRetry={loadBooking}
            onBack={goBack}
            message="Impossible de charger la réservation. Vérifiez votre connexion."
            testID="booking-offline-error"
          />
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={s.safe}>
        <TouchableOpacity style={s.backBtn} onPress={goBack}>
          <Ionicons name="arrow-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: Colors.muted }}>Réservation introuvable.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const bStatus = BOOKING_STATUS[booking.status] ?? { label: booking.status, color: Colors.muted, icon: 'help-circle-outline', desc: '' };
  const pStatus = PAYMENT_STATUS[booking.payment_status ?? ''];
  const amount  = getAmount(booking);
  const startT  = formatTime(booking.slot_start_time);
  const endT    = formatTime(booking.slot_end_time);
  const timeStr = startT && endT ? `${startT} – ${endT}` : startT || '';

  const needsAuthorization = booking.status === 'requested' && booking.payment_mode === 'pay_now';
  const canPay = !isExpired && (
    booking.status === 'awaiting_payment' ||
    (booking.status === 'accepted' && ['pending', 'unpaid'].includes(booking.payment_status ?? '')) ||
    needsAuthorization
  );
  const canCancel = ['requested', 'pending', 'accepted', 'awaiting_payment'].includes(booking.status);

  const handlePay = async () => {
    setPaying(true);
    try {
      const originUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await api.post<{ url: string }>(`/bookings/${id}/pay`, { origin_url: originUrl });
      await Linking.openURL(res.url);
    } catch (err: any) {
      Alert.alert('Paiement impossible', err.message || 'Une erreur est survenue.');
    } finally {
      setPaying(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Annuler la réservation',
      `Confirmer l'annulation de "${booking.service_title || 'cette réservation'}" ?`,
      [
        { text: 'Non, garder', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            setCancelling(true);
            try {
              await api.post(`/bookings/${id}/cancel`, {});
              setBooking((prev: any) => ({ ...prev, status: 'cancelled', payment_status: 'not_required' }));
            } catch (err: any) {
              Alert.alert('Erreur', err.message || 'Impossible d\'annuler.');
            } finally {
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="booking-detail-back">
          <Ionicons name="arrow-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Réservation</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {/* ── Statut hero ─────────────────────────────────────────────── */}
        <View style={[s.statusHero, { borderColor: bStatus.color + '44' }]}>
          <View style={[s.statusIconWrap, { backgroundColor: bStatus.color + '22' }]}>
            <Ionicons name={bStatus.icon as any} size={28} color={bStatus.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.statusLabel, { color: bStatus.color }]}>{bStatus.label}</Text>
            <Text style={s.statusDesc}>{bStatus.desc}</Text>
          </View>
          {amount != null && (
            <Text style={s.heroAmount}>{amount.toFixed(2)} €</Text>
          )}
        </View>

        {/* ── Prestation ──────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Prestation</Text>
          <Text style={s.sectionValue}>{booking.service_title || '—'}</Text>
        </View>

        {/* ── Coach ───────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Coach</Text>
          <View style={s.coachRow}>
            <UserAvatar uri={booking.receiver_picture} name={booking.receiver_name} size={40} />
            <Text style={s.sectionValue}>{booking.receiver_name || '—'}</Text>
          </View>
        </View>

        {/* ── Date & Heure ────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Date & Heure</Text>
          <View style={s.infoRow}>
            <Ionicons name="calendar-outline" size={16} color={Colors.primary} />
            <Text style={s.sectionValue}>
              {booking.slot_date
                ? formatFullDate(booking.slot_date)
                : booking.scheduled_at
                  ? formatFullDate(booking.scheduled_at)
                  : 'Non défini'}
            </Text>
          </View>
          {timeStr ? (
            <View style={s.infoRow}>
              <Ionicons name="time-outline" size={16} color={Colors.primary} />
              <Text style={s.sectionValue}>{timeStr}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Lieu ────────────────────────────────────────────────────── */}
        {booking.address ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Lieu</Text>
            <View style={s.infoRow}>
              <Ionicons name="location-outline" size={16} color={Colors.primary} />
              <Text style={s.sectionValue}>{booking.address}</Text>
            </View>
          </View>
        ) : null}

        {/* ── Notes ───────────────────────────────────────────────────── */}
        {booking.notes ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Notes</Text>
            <Text style={s.noteText}>{booking.notes}</Text>
          </View>
        ) : null}

        {/* ── Paiement ────────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Paiement</Text>
          <View style={s.payRow}>
            <Text style={s.sectionValue}>
              {amount != null ? `${amount.toFixed(2)} €` : '—'}
            </Text>
            {pStatus && (
              <View style={[s.payBadge, { backgroundColor: pStatus.color + '22' }]}>
                <Text style={[s.payBadgeText, { color: pStatus.color }]}>{pStatus.label}</Text>
              </View>
            )}
          </View>
          <Text style={s.mutedText}>
            Mode : {booking.payment_mode === 'pay_now' ? 'Paiement immédiat' : 'Paiement différé'}
          </Text>
        </View>

        {/* ── Référence ───────────────────────────────────────────────── */}
        <View style={s.section}>
          <Text style={s.sectionLabel}>Référence</Text>
          <Text style={[s.sectionValue, { fontFamily: 'monospace', fontSize: 12, color: Colors.muted }]}>
            {booking.booking_id}
          </Text>
          <Text style={s.mutedText}>
            Créée le {formatFullDate(booking.created_at)}
          </Text>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Actions fixes en bas ─────────────────────────────────────── */}
      {(canPay || canCancel) && (
        <View style={s.actionsBar}>
          {canPay && (
            <TouchableOpacity
              style={[s.payBtn, paying && s.btnLoading]}
              onPress={handlePay}
              disabled={paying || cancelling}
              testID="booking-pay-btn"
            >
              {paying
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="card" size={18} color="#fff" />
              }
              <Text style={s.payBtnText}>
                {paying ? 'Ouverture...' : needsAuthorization ? 'Confirmer le paiement' : 'Payer maintenant'}
              </Text>
            </TouchableOpacity>
          )}
          {canCancel && (
            <TouchableOpacity
              style={[s.cancelBtn, cancelling && s.btnLoading, canPay && { flex: 0.6 }]}
              onPress={handleCancel}
              disabled={paying || cancelling}
              testID="booking-cancel-btn"
            >
              {cancelling
                ? <ActivityIndicator size="small" color="#FF3B30" />
                : <Ionicons name="close-circle-outline" size={18} color="#FF3B30" />
              }
              <Text style={s.cancelBtnText}>{cancelling ? 'Annulation...' : 'Annuler'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },

  // Status hero
  statusHero: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderRadius: 16,
    borderWidth: 1,
    backgroundColor: Colors.card,
    marginBottom: 16,
  },
  statusIconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { fontSize: 16, fontWeight: '700' },
  statusDesc: { fontSize: 12, color: Colors.muted, marginTop: 2, lineHeight: 16 },
  heroAmount: { fontSize: 22, fontWeight: '800', color: Colors.primary },

  // Sections
  section: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 6,
  },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionValue: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  noteText: { fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  mutedText: { fontSize: 12, color: Colors.muted },

  // Paiement
  payRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  payBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: Radius.full },
  payBadgeText: { fontSize: 12, fontWeight: '600' },

  // Actions bar
  actionsBar: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingVertical: 16,
    paddingBottom: 28,
    backgroundColor: Colors.background,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  payBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#635BFF', borderRadius: Radius.full, paddingVertical: 14,
  },
  payBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cancelBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: 'rgba(255,59,48,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,59,48,0.3)',
    borderRadius: Radius.full, paddingVertical: 14,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#FF3B30' },
  btnLoading: { opacity: 0.65 },
});
