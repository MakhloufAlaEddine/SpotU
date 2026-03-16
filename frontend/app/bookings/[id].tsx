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

        {/* ── Status Hero ─────────────────────────────────────────────── */}
        <View style={[s.statusHero, { backgroundColor: bStatus.color + '12' }]} testID="booking-status-hero">
          <View style={[s.statusIconCircle, { backgroundColor: bStatus.color + '22', borderColor: bStatus.color + '33' }]}>
            <Ionicons name={bStatus.icon as any} size={26} color={bStatus.color} />
          </View>
          <View style={s.statusContent}>
            <Text style={[s.statusLabel, { color: bStatus.color }]}>{bStatus.label}</Text>
            {bStatus.desc ? <Text style={s.statusDesc}>{bStatus.desc}</Text> : null}
            {countdown && !isExpired && (
              <View style={s.countdownRow}>
                <Ionicons name="timer-outline" size={13} color="#FF9500" />
                <Text style={s.countdownText}>Expire dans {countdown}</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Montant principal ────────────────────────────────────────── */}
        {amount != null && (
          <View style={s.amountCard} testID="booking-amount">
            <Text style={s.amountLabel}>Montant total</Text>
            <Text style={s.amountValue}>{amount.toFixed(2)} €</Text>
            {pStatus && (
              <View style={[s.badge, { backgroundColor: pStatus.color + '18' }]}>
                <View style={[s.badgeDot, { backgroundColor: pStatus.color }]} />
                <Text style={[s.badgeText, { color: pStatus.color }]}>{pStatus.label}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Détails ─────────────────────────────────────────────────── */}
        <View style={s.card} testID="booking-details-card">

          {/* Prestation */}
          <View style={s.detailRow}>
            <View style={s.detailIcon}>
              <Ionicons name="briefcase-outline" size={18} color={Colors.primary} />
            </View>
            <View style={s.detailContent}>
              <Text style={s.detailLabel}>Prestation</Text>
              <Text style={s.detailValue}>{booking.service_title || '—'}</Text>
            </View>
          </View>

          <View style={s.divider} />

          {/* Coach */}
          <TouchableOpacity
            style={s.detailRow}
            onPress={() => booking.receiver_id && router.push(`/user/${booking.receiver_id}` as any)}
            activeOpacity={0.7}
          >
            <View style={s.detailIcon}>
              <UserAvatar uri={booking.receiver_picture} name={booking.receiver_name} size={36} />
            </View>
            <View style={s.detailContent}>
              <Text style={s.detailLabel}>Coach</Text>
              <Text style={s.detailValue}>{booking.receiver_name || '—'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Date & Heure */}
          <View style={s.detailRow}>
            <View style={s.detailIcon}>
              <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
            </View>
            <View style={s.detailContent}>
              <Text style={s.detailLabel}>Date & Heure</Text>
              <Text style={s.detailValue}>
                {booking.slot_date
                  ? formatFullDate(booking.slot_date)
                  : booking.scheduled_at
                    ? formatFullDate(booking.scheduled_at)
                    : 'Non défini'}
              </Text>
              {timeStr ? <Text style={s.detailSub}>{timeStr}</Text> : null}
            </View>
          </View>

          {/* Lieu */}
          {booking.address ? (
            <>
              <View style={s.divider} />
              <View style={s.detailRow}>
                <View style={s.detailIcon}>
                  <Ionicons name="location-outline" size={18} color={Colors.primary} />
                </View>
                <View style={s.detailContent}>
                  <Text style={s.detailLabel}>Lieu</Text>
                  <Text style={s.detailValue}>{booking.address}</Text>
                </View>
              </View>
            </>
          ) : null}

          {/* Notes */}
          {booking.notes ? (
            <>
              <View style={s.divider} />
              <View style={s.detailRow}>
                <View style={s.detailIcon}>
                  <Ionicons name="document-text-outline" size={18} color={Colors.primary} />
                </View>
                <View style={s.detailContent}>
                  <Text style={s.detailLabel}>Notes</Text>
                  <Text style={s.detailSub}>{booking.notes}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* ── Paiement ────────────────────────────────────────────────── */}
        <View style={s.card} testID="booking-payment-card">
          <View style={s.cardHeader}>
            <Ionicons name="card-outline" size={16} color={Colors.muted} />
            <Text style={s.cardHeaderText}>Paiement</Text>
          </View>
          <View style={s.paymentRow}>
            <Text style={s.paymentLabel}>Mode</Text>
            <Text style={s.paymentValue}>
              {booking.payment_mode === 'pay_now' ? 'Paiement immédiat' : 'Paiement différé'}
            </Text>
          </View>
          {booking.pricing_snapshot?.base_amount != null && (
            <>
              <View style={s.paymentRow}>
                <Text style={s.paymentLabel}>Prix de base</Text>
                <Text style={s.paymentValue}>{booking.pricing_snapshot.base_amount.toFixed(2)} €</Text>
              </View>
              {booking.pricing_snapshot.payer_percent_fee_amount > 0 && (
                <View style={s.paymentRow}>
                  <Text style={s.paymentLabel}>Frais de service</Text>
                  <Text style={[s.paymentValue, { color: '#FF9500' }]}>+{booking.pricing_snapshot.payer_percent_fee_amount.toFixed(2)} €</Text>
                </View>
              )}
              <View style={s.paymentDivider} />
              <View style={s.paymentRow}>
                <Text style={s.paymentTotalLabel}>Total</Text>
                <Text style={s.paymentTotalValue}>{booking.pricing_snapshot.payer_total_amount.toFixed(2)} €</Text>
              </View>
            </>
          )}
        </View>

        {/* ── Référence ───────────────────────────────────────────────── */}
        <View style={s.refCard} testID="booking-reference">
          <Ionicons name="receipt-outline" size={14} color={Colors.muted} />
          <View style={{ flex: 1 }}>
            <Text style={s.refId}>{booking.booking_id}</Text>
            <Text style={s.refDate}>Créée le {formatFullDate(booking.created_at)}</Text>
          </View>
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* ── Actions fixes en bas ─────────────────────────────────────── */}
      {(canPay || canCancel) && (
        <View style={s.actionsBar}>
          {canPay && (
            <TouchableOpacity
              style={[s.payBtn, paying && s.btnDisabled]}
              onPress={handlePay}
              disabled={paying || cancelling}
              testID="booking-pay-btn"
            >
              {paying
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="card" size={18} color="#fff" />
              }
              <Text style={s.payBtnText}>
                {paying ? 'Ouverture...' : needsAuthorization ? 'Confirmer le paiement' : `Payer${amount ? ` ${amount.toFixed(2)} €` : ''}`}
              </Text>
            </TouchableOpacity>
          )}
          {canCancel && (
            <TouchableOpacity
              style={[s.cancelBtn, cancelling && s.btnDisabled, canPay && { flex: 0.55 }]}
              onPress={handleCancel}
              disabled={paying || cancelling}
              testID="booking-cancel-btn"
            >
              {cancelling
                ? <ActivityIndicator size="small" color="#FF3B30" />
                : <Ionicons name="close-circle-outline" size={18} color="#FF3B30" />
              }
              <Text style={s.cancelBtnText}>{cancelling ? '...' : 'Annuler'}</Text>
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
  scroll: { paddingHorizontal: 16, paddingTop: 20 },

  // ── Status hero
  statusHero: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    padding: 16, borderRadius: 16,
    marginBottom: 12,
  },
  statusIconCircle: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  statusContent: { flex: 1, gap: 3 },
  statusLabel: { fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
  statusDesc: { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  countdownRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  countdownText: { fontSize: 13, fontWeight: '700', color: '#FF9500' },

  // ── Amount card
  amountCard: {
    backgroundColor: Colors.card, borderRadius: 16,
    padding: 18, marginBottom: 12,
    alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  amountLabel: { fontSize: 12, fontWeight: '600', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  amountValue: { fontSize: 32, fontWeight: '900', color: Colors.primary, letterSpacing: -0.5 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, marginTop: 4 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },

  // ── Card
  card: {
    backgroundColor: Colors.card, borderRadius: 16,
    paddingVertical: 4, marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10,
  },
  cardHeaderText: { fontSize: 13, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16 },

  // ── Detail rows
  detailRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  detailIcon: { width: 36, alignItems: 'center' },
  detailContent: { flex: 1, gap: 2 },
  detailLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 15, fontWeight: '600', color: Colors.foreground, lineHeight: 21 },
  detailSub: { fontSize: 13, color: Colors.muted, lineHeight: 19, marginTop: 1 },

  // ── Payment section
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  paymentLabel: { fontSize: 14, color: Colors.muted, fontWeight: '500' },
  paymentValue: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  paymentDivider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 16, marginVertical: 4 },
  paymentTotalLabel: { fontSize: 15, fontWeight: '800', color: Colors.foreground },
  paymentTotalValue: { fontSize: 17, fontWeight: '800', color: Colors.primary },

  // ── Reference
  refCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1, borderColor: Colors.border,
    opacity: 0.75,
  },
  refId: { fontSize: 12, fontWeight: '600', color: Colors.muted, fontFamily: 'monospace' },
  refDate: { fontSize: 11, color: Colors.muted, marginTop: 2 },

  // ── Actions bar
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
    backgroundColor: '#635BFF', borderRadius: 14, paddingVertical: 15,
  },
  payBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  cancelBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: 'rgba(255,59,48,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,59,48,0.25)',
    borderRadius: 14, paddingVertical: 15,
  },
  cancelBtnText: { fontSize: 15, fontWeight: '600', color: '#FF3B30' },
  btnDisabled: { opacity: 0.55 },
});
