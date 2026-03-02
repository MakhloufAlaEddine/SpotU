import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WButton } from '../../components/WButton';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

export default function BookingDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [refusing, setRefusing] = useState(false);

  useEffect(() => {
    if (id) loadBooking();
  }, [id]);

  const loadBooking = async () => {
    try {
      const data = await api.get(`/bookings/${id}`);
      setBooking(data);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  const handlePay = async () => {
    if (!booking) return;
    setPaying(true);
    try {
      const originUrl = typeof window !== 'undefined' ? window.location.origin : process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await api.post('/payments/checkout', { booking_id: booking.booking_id, origin_url: originUrl });
      if (typeof window !== 'undefined') {
        window.open(res.url, '_blank');
      }
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setPaying(false);
    }
  };

  const handleAccept = async () => {
    setAccepting(true);
    try {
      await api.post(`/bookings/${id}/accept`, {});
      await loadBooking();
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible d\'accepter');
    } finally {
      setAccepting(false);
    }
  };

  const handleRefuse = async () => {
    setRefusing(true);
    try {
      await api.post(`/bookings/${id}/refuse`, {});
      await loadBooking();
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de refuser');
    } finally {
      setRefusing(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!booking) return <View style={styles.center}><Text>Réservation introuvable</Text></View>;

  const statusColors: Record<string, string> = {
    pending: Colors.warning, confirmed: Colors.accent, completed: Colors.success,
    accepted: Colors.primary, refused: Colors.destructive, cancelled: Colors.destructive
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card} testID="booking-detail-card">
          <View style={[styles.statusBar, { backgroundColor: statusColors[booking.status] || Colors.muted }]}>
            <Text style={styles.statusText}>{booking.status.toUpperCase()}</Text>
          </View>
          <View style={styles.content}>
            <Text style={styles.bookingId}>#{booking.booking_id}</Text>
            {booking.service && (
              <>
                <Text style={styles.serviceTitle}>{booking.service.title}</Text>
                <Text style={styles.duration}>{booking.service.duration_min} min</Text>
              </>
            )}
            {booking.coach && (
              <View style={styles.coachRow}>
                <View style={styles.coachAvatar}>
                  <Text style={styles.coachAvatarText}>{booking.coach.name?.[0]}</Text>
                </View>
                <Text style={styles.coachName}>{booking.coach.name}</Text>
              </View>
            )}
            {booking.scheduled_at && (
              <Text style={styles.date}>📅 {new Date(booking.scheduled_at).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US')}</Text>
            )}
            {booking.notes && <Text style={styles.notes}>📝 {booking.notes}</Text>}

            <View style={styles.priceSection}>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Séance</Text>
                <Text style={styles.priceValue}>{booking.amount}€</Text>
              </View>
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Commission (15%)</Text>
                <Text style={[styles.priceValue, { color: Colors.muted }]}>-{booking.commission}€</Text>
              </View>
              <View style={[styles.priceRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{booking.amount}€</Text>
              </View>
            </View>

            {booking.payment_status === 'paid' ? (
              <View style={styles.paidBadge}>
                <Text style={styles.paidText}>✅ Paiement effectué</Text>
              </View>
            ) : booking.status !== 'cancelled' && user?.user_id === booking.user_id ? (
              <WButton label={`💳 ${t('payNow')} — ${booking.amount}€`} onPress={handlePay} loading={paying} style={styles.payBtn} testID="pay-booking-btn" />
            ) : null}

            {user?.user_id === booking.coach_id && booking.status === 'pending' && (
              <View style={styles.coachActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.acceptBtn]}
                  onPress={handleAccept}
                  disabled={accepting}
                  testID="accept-booking-btn"
                  activeOpacity={0.8}
                >
                  {accepting
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="checkmark" size={18} color="#fff" />}
                  <Text style={styles.acceptBtnText}>Accepter la demande</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.refuseBtn]}
                  onPress={handleRefuse}
                  disabled={refusing}
                  testID="refuse-booking-btn"
                  activeOpacity={0.8}
                >
                  {refusing
                    ? <ActivityIndicator size="small" color="#EF4444" />
                    : <Ionicons name="close" size={18} color="#EF4444" />}
                  <Text style={styles.refuseBtnText}>Refuser</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.secondary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  card: { backgroundColor: Colors.background, borderRadius: Radius.xl, overflow: 'hidden', ...Shadow.floating },
  statusBar: { padding: Spacing.sm, alignItems: 'center' },
  statusText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  content: { padding: Spacing.lg },
  bookingId: { fontSize: 12, color: Colors.muted, marginBottom: 4 },
  serviceTitle: { fontSize: 22, fontWeight: '900', color: Colors.foreground, marginBottom: 4 },
  duration: { fontSize: 13, color: Colors.muted, marginBottom: Spacing.md },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Spacing.sm },
  coachAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  coachAvatarText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  coachName: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  date: { fontSize: 14, color: Colors.muted, marginBottom: Spacing.sm },
  notes: { fontSize: 14, color: Colors.muted, marginBottom: Spacing.md },
  priceSection: { backgroundColor: Colors.secondary, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  priceLabel: { fontSize: 14, color: Colors.muted },
  priceValue: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  totalRow: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, paddingTop: 8 },
  totalLabel: { fontSize: 16, fontWeight: '800', color: Colors.foreground },
  totalValue: { fontSize: 18, fontWeight: '900', color: Colors.primary },
  paidBadge: { backgroundColor: Colors.primaryLight, borderRadius: Radius.full, padding: Spacing.sm, alignItems: 'center' },
  paidText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  payBtn: { marginTop: Spacing.sm },
  coachActions: { flexDirection: 'row', gap: 10, marginTop: Spacing.md },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.full },
  acceptBtn: { backgroundColor: Colors.primary },
  acceptBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  refuseBtn: { backgroundColor: 'rgba(239,68,68,0.08)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)' },
  refuseBtnText: { fontSize: 14, fontWeight: '800', color: '#EF4444' },
});
