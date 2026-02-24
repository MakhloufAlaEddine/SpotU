import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WButton } from '../../components/WButton';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

const STATUS_CONFIG: Record<string, { color: string; bg: string; label_fr: string; label_en: string }> = {
  pending: { color: Colors.warning, bg: '#FFF5E0', label_fr: 'En attente', label_en: 'Pending' },
  confirmed: { color: Colors.accent, bg: '#E5F0FF', label_fr: 'Confirmée', label_en: 'Confirmed' },
  completed: { color: Colors.success, bg: '#E8F9F1', label_fr: 'Terminée', label_en: 'Completed' },
  cancelled: { color: Colors.destructive, bg: '#FFEDED', label_fr: 'Annulée', label_en: 'Cancelled' },
};

export default function BookingsScreen() {
  const { user } = useAuth();
  const { t, lang } = useLang();
  const router = useRouter();
  const [myBookings, setMyBookings] = useState<any[]>([]);
  const [coachBookings, setCoachBookings] = useState<any[]>([]);
  const [tab, setTab] = useState<'mine' | 'coach'>('mine');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user) loadBookings();
  }, [user]);

  const loadBookings = async () => {
    setLoading(true);
    try {
      const mine = await api.get('/bookings/mine');
      setMyBookings(mine);
      if (user?.role === 'coach' || user?.role === 'admin') {
        const coach = await api.get('/bookings/coach');
        setCoachBookings(coach);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handlePay = async (booking: any) => {
    try {
      const originUrl = typeof window !== 'undefined' ? window.location.origin : process.env.EXPO_PUBLIC_BACKEND_URL;
      const res = await api.post('/payments/checkout', { booking_id: booking.booking_id, origin_url: originUrl });
      if (typeof window !== 'undefined') {
        window.open(res.url, '_blank');
      }
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>Connectez-vous pour voir vos réservations</Text>
          <WButton label={t('login')} onPress={() => router.replace('/(auth)/login')} />
        </View>
      </SafeAreaView>
    );
  }

  const displayBookings = tab === 'mine' ? myBookings : coachBookings;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('bookings')}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity testID="tab-my-bookings" style={[styles.tab, tab === 'mine' && styles.tabActive]} onPress={() => setTab('mine')}>
          <Text style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>📅 {t('myBookings')}</Text>
        </TouchableOpacity>
        {(user.role === 'coach' || user.role === 'admin') && (
          <TouchableOpacity testID="tab-coach-bookings" style={[styles.tab, tab === 'coach' && styles.tabActive]} onPress={() => setTab('coach')}>
            <Text style={[styles.tabText, tab === 'coach' && styles.tabTextActive]}>🎯 {t('coachBookings')}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadBookings(); }} tintColor={Colors.primary} />}
      >
        {loading ? <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} /> :
          displayBookings.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyText}>{t('noBookings')}</Text>
            </View>
          ) : (
            displayBookings.map((booking) => {
              const sc = STATUS_CONFIG[booking.status] || STATUS_CONFIG.pending;
              return (
                <TouchableOpacity
                  key={booking.booking_id}
                  testID={`booking-card-${booking.booking_id}`}
                  style={styles.card}
                  onPress={() => router.push(`/booking/${booking.booking_id}`)}
                  activeOpacity={0.85}
                >
                  <View style={styles.cardHeader}>
                    <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
                      <Text style={[styles.statusText, { color: sc.color }]}>
                        {lang === 'fr' ? sc.label_fr : sc.label_en}
                      </Text>
                    </View>
                    <Text style={styles.amount}>{booking.amount}€</Text>
                  </View>
                  <Text style={styles.serviceTitle} numberOfLines={1}>
                    {booking.service?.title ?? '—'}
                  </Text>
                  {booking.coach && (
                    <Text style={styles.coachName}>🎯 {booking.coach.name}</Text>
                  )}
                  {booking.scheduled_at && (
                    <Text style={styles.scheduledAt}>
                      📅 {new Date(booking.scheduled_at).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US')}
                    </Text>
                  )}
                  {tab === 'mine' && booking.payment_status !== 'paid' && booking.status !== 'cancelled' && (
                    <WButton
                      label={`💳 ${t('payNow')} - ${booking.amount}€`}
                      onPress={() => handlePay(booking)}
                      style={styles.payBtn}
                      size="sm"
                      testID={`pay-btn-${booking.booking_id}`}
                    />
                  )}
                  {booking.payment_status === 'paid' && (
                    <View style={styles.paidBadge}>
                      <Text style={styles.paidText}>✅ {t('paid')}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: Spacing.lg },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  title: { fontSize: 22, fontWeight: '900', color: Colors.foreground },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: Spacing.sm + 2, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md },
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm, ...Shadow.soft },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 12, fontWeight: '700' },
  amount: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  serviceTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  coachName: { fontSize: 13, color: Colors.muted, marginBottom: 2 },
  scheduledAt: { fontSize: 13, color: Colors.muted, marginBottom: 8 },
  payBtn: { alignSelf: 'flex-start', marginTop: 6 },
  paidBadge: { alignSelf: 'flex-start', backgroundColor: Colors.primaryLight, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3, marginTop: 4 },
  paidText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  empty: { alignItems: 'center', paddingTop: Spacing.xxl },
  emptyIcon: { fontSize: 48, marginBottom: Spacing.md },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
});
