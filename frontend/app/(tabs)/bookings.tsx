import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

type BookingTab = 'mine' | 'coach';

const STATUS_COLORS: Record<string, string> = {
  pending: Colors.warning,
  confirmed: Colors.accent,
  completed: Colors.success,
  cancelled: Colors.destructive,
};

export default function BookingsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLang();
  const [tab, setTab] = useState<BookingTab>('mine');
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadBookings();
  }, [tab, user]);

  const loadBookings = async () => {
    if (!user) { setLoading(false); return; }
    try {
      const endpoint = tab === 'mine' ? '/bookings/mine' : '/bookings/coach';
      const data = await api.get(endpoint);
      setBookings(data);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadBookings();
  }, [tab, user]);

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🔒</Text>
          <Text style={styles.emptyText}>Connectez-vous pour voir vos réservations</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'mine' && styles.tabBtnActive]}
          onPress={() => setTab('mine')}
          testID="tab-my-bookings"
        >
          <Text style={[styles.tabText, tab === 'mine' && styles.tabTextActive]}>
            📅 {t('myBookings')}
          </Text>
        </TouchableOpacity>
        {user.role === 'coach' || user.role === 'admin' ? (
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'coach' && styles.tabBtnActive]}
            onPress={() => setTab('coach')}
            testID="tab-coach-bookings"
          >
            <Text style={[styles.tabText, tab === 'coach' && styles.tabTextActive]}>
              🎯 {t('coachBookings')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {bookings.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>📅</Text>
              <Text style={styles.emptyText}>{t('noBookings')}</Text>
            </View>
          ) : (
            bookings.map((b) => (
              <TouchableOpacity
                key={b.booking_id}
                style={styles.card}
                onPress={() => router.push(`/booking/${b.booking_id}`)}
                activeOpacity={0.85}
                testID={`booking-card-${b.booking_id}`}
              >
                <View style={[styles.statusStrip, { backgroundColor: STATUS_COLORS[b.status] || Colors.muted }]} />
                <View style={styles.cardContent}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.serviceTitle} numberOfLines={1}>
                      {b.service?.title ?? 'Service'}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[b.status] + '20' }]}>
                      <Text style={[styles.statusText, { color: STATUS_COLORS[b.status] }]}>
                        {t(b.status) || b.status}
                      </Text>
                    </View>
                  </View>
                  {b.coach && (
                    <Text style={styles.coachName}>👤 {b.coach.name}</Text>
                  )}
                  <View style={styles.cardFooter}>
                    <Text style={styles.amount}>{b.amount}€</Text>
                    {b.payment_status === 'paid' ? (
                      <Text style={styles.paidTag}>✅ {t('paid')}</Text>
                    ) : b.status !== 'cancelled' ? (
                      <Text style={styles.payHint}>💳 {t('payNow')}</Text>
                    ) : null}
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.secondary },
  tabs: { flexDirection: 'row', backgroundColor: Colors.background, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tabBtn: { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabBtnActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: 12 },
  empty: { alignItems: 'center', padding: Spacing.xxl, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
    ...Shadow.soft,
  },
  statusStrip: { width: 5 },
  cardContent: { flex: 1, padding: Spacing.md },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  serviceTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  coachName: { fontSize: 13, color: Colors.muted, marginBottom: 8 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { fontSize: 18, fontWeight: '900', color: Colors.primary },
  paidTag: { fontSize: 12, color: Colors.success, fontWeight: '700' },
  payHint: { fontSize: 13, color: Colors.accent, fontWeight: '700' },
});
