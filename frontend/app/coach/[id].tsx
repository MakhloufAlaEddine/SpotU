import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MapViewComponent } from '../../components/MapViewComponent';
import { WButton } from '../../components/WButton';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

export default function CoachProfileScreen() {
  const { id, service_id } = useLocalSearchParams<{ id: string; service_id?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLang();
  const [coach, setCoach] = useState<any>(null);
  const [service, setService] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);

  useEffect(() => {
    if (id) loadCoach();
    if (service_id) loadService();
  }, [id, service_id]);

  const loadCoach = async () => {
    try {
      const data = await api.get(`/users/${id}/public`);
      setCoach(data);
    } catch {} finally {
      setLoading(false);
    }
  };

  const loadService = async () => {
    try {
      const data = await api.get(`/services/${service_id}`);
      setService(data);
    } catch {}
  };

  const handleBook = async () => {
    if (!user) {
      Alert.alert('', 'Connectez-vous pour réserver');
      router.push('/(auth)/login');
      return;
    }
    if (!service) return;
    setBooking(true);
    try {
      const bkg = await api.post('/bookings', { service_id: service.service_id });
      Alert.alert('✅ Réservation créée !', `Réservation #${bkg.booking_id}\nProcédez au paiement pour confirmer.`, [
        { text: 'Voir mes réservations', onPress: () => router.push('/(tabs)/bookings') }
      ]);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setBooking(false);
    }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  if (!coach) return <View style={styles.center}><Text style={styles.notFound}>Coach introuvable</Text></View>;

  const services: any[] = coach.services || (service ? [service] : []);
  const displayService = service || services[0];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Hero */}
        <View style={styles.hero} testID="coach-profile-hero">
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{coach.name?.[0]?.toUpperCase()}</Text>
          </View>
          <Text style={styles.name}>{coach.name}</Text>
          {coach.is_coach_verified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓ {t('verifiedBadge')}</Text>
            </View>
          )}
          {coach.avg_rating && (
            <Text style={styles.rating}>⭐ {coach.avg_rating} ({coach.review_count} {t('reviews')})</Text>
          )}
          {coach.bio && <Text style={styles.bio}>{coach.bio}</Text>}
        </View>

        {/* Service details */}
        {displayService && (
          <View style={styles.serviceCard} testID="service-card">
            <Text style={styles.serviceTitle}>{displayService.title}</Text>
            {displayService.description && <Text style={styles.serviceDesc}>{displayService.description}</Text>}
            <View style={styles.serviceStats}>
              <View style={styles.stat}><Text style={styles.statValue}>{displayService.price}€</Text><Text style={styles.statLabel}>{t('price')}</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.stat}><Text style={styles.statValue}>{displayService.duration_min}min</Text><Text style={styles.statLabel}>{t('duration')}</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.stat}><Text style={styles.statValue}>{displayService.max_participants}</Text><Text style={styles.statLabel}>{t('maxParticipants')}</Text></View>
            </View>
            {displayService.location_description && (
              <Text style={styles.location}>📍 {displayService.location_description}</Text>
            )}
          </View>
        )}

        {/* Commission info */}
        {displayService && (
          <View style={styles.commissionNote}>
            <Text style={styles.commissionText}>
              💡 Commission plateforme: {(displayService.price * 0.15).toFixed(2)}€ (15%) · Net coach: {(displayService.price * 0.85).toFixed(2)}€
            </Text>
          </View>
        )}

        {/* Book button */}
        {displayService && user?.user_id !== coach.user_id && (
          <WButton
            label={`📅 ${t('bookSession')} — ${displayService.price}€`}
            onPress={handleBook}
            loading={booking}
            style={styles.bookBtn}
            testID="book-session-btn"
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFound: { fontSize: 16, color: Colors.muted },
  scroll: { paddingBottom: 40 },
  hero: { alignItems: 'center', padding: Spacing.lg, paddingTop: Spacing.xl },
  avatar: { width: 90, height: 90, borderRadius: 45, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
  avatarText: { fontSize: 40, fontWeight: '800', color: Colors.primary },
  name: { fontSize: 24, fontWeight: '900', color: Colors.foreground, marginBottom: 6 },
  verifiedBadge: { backgroundColor: Colors.primaryLight, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 6 },
  verifiedText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  rating: { fontSize: 14, color: Colors.muted, marginBottom: 8 },
  bio: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 300 },
  serviceCard: { margin: Spacing.md, backgroundColor: Colors.secondary, borderRadius: Radius.xl, padding: Spacing.lg, ...Shadow.soft },
  serviceTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground, marginBottom: 6 },
  serviceDesc: { fontSize: 14, color: Colors.muted, lineHeight: 20, marginBottom: Spacing.md },
  serviceStats: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '900', color: Colors.primary },
  statLabel: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  statDivider: { width: 1, height: 40, backgroundColor: Colors.border },
  location: { fontSize: 13, color: Colors.muted, marginTop: 6 },
  commissionNote: { marginHorizontal: Spacing.md, backgroundColor: '#FFF5E0', borderRadius: Radius.md, padding: Spacing.sm },
  commissionText: { fontSize: 12, color: Colors.warning },
  bookBtn: { margin: Spacing.md, marginTop: Spacing.sm },
});
