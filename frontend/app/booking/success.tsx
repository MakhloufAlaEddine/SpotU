import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { WButton } from '../../components/WButton';
import { Colors, Spacing, Radius } from '../../constants/Colors';

export default function BookingSuccess() {
  const { session_id, booking_id } = useLocalSearchParams<{ session_id?: string; booking_id?: string }>();
  const router = useRouter();
  const { t } = useLang();
  const [status, setStatus] = useState<'loading' | 'paid' | 'pending' | 'failed'>('loading');

  useEffect(() => {
    if (session_id) checkPayment();
    else setStatus('pending');
  }, [session_id]);

  const checkPayment = async () => {
    try {
      const txn = await api.get(`/payments/status/${session_id}`);
      setStatus(txn.payment_status === 'paid' ? 'paid' : 'pending');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container} testID="payment-success-screen">
        {status === 'loading' && (
          <>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>{t('paymentPending')}</Text>
          </>
        )}
        {status === 'paid' && (
          <>
            <Text style={styles.icon}>✅</Text>
            <Text style={styles.title}>{t('paymentSuccess')}</Text>
            <Text style={styles.desc}>{t('paymentSuccessDesc')}</Text>
          </>
        )}
        {status === 'pending' && (
          <>
            <Text style={styles.icon}>⏳</Text>
            <Text style={styles.title}>{t('paymentPending')}</Text>
            <Text style={styles.desc}>Votre paiement est en cours de traitement.</Text>
          </>
        )}
        {status === 'failed' && (
          <>
            <Text style={styles.icon}>❌</Text>
            <Text style={styles.title}>{t('paymentFailed')}</Text>
            <Text style={styles.desc}>Une erreur est survenue. Réessayez.</Text>
          </>
        )}
        {status !== 'loading' && (
          <WButton
            label={t('viewBooking')}
            onPress={() => booking_id ? router.push(`/booking/${booking_id}`) : router.push('/(tabs)/bookings')}
            style={styles.btn}
            testID="view-booking-btn"
          />
        )}
        <WButton
          label="🏠 Accueil"
          onPress={() => router.replace('/(tabs)/map')}
          variant="secondary"
          style={styles.homeBtn}
          testID="go-home-btn"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  icon: { fontSize: 64, marginBottom: Spacing.lg },
  title: { fontSize: 26, fontWeight: '900', color: Colors.foreground, textAlign: 'center', marginBottom: Spacing.sm },
  desc: { fontSize: 15, color: Colors.muted, textAlign: 'center', marginBottom: Spacing.xl },
  loadingText: { marginTop: Spacing.md, fontSize: 15, color: Colors.muted },
  btn: { width: '100%', marginBottom: Spacing.sm },
  homeBtn: { width: '100%' },
});
