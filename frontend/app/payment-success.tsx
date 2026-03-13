/**
 * payment-success.tsx
 * Écran de retour depuis Stripe Checkout.
 * URL attendue : /payment-success?session_id=xxx&booking_id=xxx
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { Colors } from '../constants/Colors';
import { useGuardedRouter } from '../hooks/useGuardedRouter';

type Status = 'loading' | 'success' | 'authorized' | 'pending' | 'failed' | 'cancelled';

export default function PaymentSuccessScreen() {
  const router = useGuardedRouter();
  const { session_id, booking_id } = useLocalSearchParams<{
    session_id: string; booking_id: string;
  }>();

  const [status, setStatus] = useState<Status>('loading');
  const [amount, setAmount] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    if (!session_id) { setStatus('failed'); return; }
    pollStatus(0);
  }, [session_id]);

  const pollStatus = async (attempt: number) => {
    try {
      const res = await api.get<any>(`/payments/checkout/status/${session_id}`);
      setAmount(res.amount);

      if (res.payment_status === 'paid' || res.payment_status === 'captured') {
        setStatus('success');
      } else if (res.payment_status === 'authorized') {
        // capture_method=manual : paiement autorisé, en attente d'acceptation du coach
        setStatus('authorized');
      } else if (res.status === 'expired' || res.status === 'cancelled') {
        setStatus('cancelled');
      } else if (attempt < 5) {
        // Réessayer après 2s
        setTimeout(() => {
          setAttempts(attempt + 1);
          pollStatus(attempt + 1);
        }, 2000);
      } else {
        setStatus('pending');
      }
    } catch {
      if (attempt < 3) {
        setTimeout(() => pollStatus(attempt + 1), 2000);
      } else {
        setStatus('failed');
      }
    }
  };

  const goHome = () => router.replace('/(tabs)/map' as any);
  const goBookings = () => router.replace('/bookings' as any);

  return (
    <View style={s.container}>
      <SafeAreaView edges={['top', 'bottom']} style={s.safe}>
        <View style={s.content}>
          {status === 'loading' && (
            <>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={s.title}>Vérification du paiement…</Text>
              <Text style={s.sub}>Cela peut prendre quelques secondes.</Text>
            </>
          )}

          {status === 'success' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: Colors.success + '22' }]}>
                <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
              </View>
              <Text style={[s.title, { color: Colors.success }]}>Paiement réussi !</Text>
              {amount != null && (
                <Text style={s.amount}>{amount.toFixed(2)} €</Text>
              )}
              <Text style={s.sub}>Votre réservation est confirmée. Le coach a été notifié.</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: Colors.success }]} onPress={goHome} testID="payment-home-btn">
                <Ionicons name="home-outline" size={18} color="#fff" />
                <Text style={s.btnText}>Retour à l'accueil</Text>
              </TouchableOpacity>
            </>
          )}

          {status === 'authorized' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: '#FF9500' + '22' }]}>
                <Ionicons name="shield-checkmark" size={64} color="#FF9500" />
              </View>
              <Text style={[s.title, { color: '#FF9500' }]}>Paiement confirmé !</Text>
              {amount != null && (
                <Text style={s.amount}>{amount.toFixed(2)} €</Text>
              )}
              <Text style={s.sub}>
                Votre moyen de paiement a été confirmé. Vous ne serez débité qu'après acceptation du coach.
              </Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: '#FF9500' }]} onPress={goBookings} testID="payment-authorized-bookings-btn">
                <Ionicons name="list-outline" size={18} color="#fff" />
                <Text style={s.btnText}>Suivre ma réservation</Text>
              </TouchableOpacity>
            </>
          )}

          {status === 'pending' && (
            <>
              <View style={[s.iconWrap, { backgroundColor: Colors.warning + '22' }]}>
                <Ionicons name="time-outline" size={64} color={Colors.warning} />
              </View>
              <Text style={[s.title, { color: Colors.warning }]}>Paiement en cours…</Text>
              <Text style={s.sub}>Le paiement est en cours de traitement. Votre réservation sera confirmée automatiquement.</Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: Colors.warning }]} onPress={goHome} testID="payment-pending-home-btn">
                <Text style={s.btnText}>Retour à l'accueil</Text>
              </TouchableOpacity>
            </>
          )}

          {(status === 'cancelled' || status === 'failed') && (
            <>
              <View style={[s.iconWrap, { backgroundColor: Colors.destructive + '22' }]}>
                <Ionicons name="close-circle" size={64} color={Colors.destructive} />
              </View>
              <Text style={[s.title, { color: Colors.destructive }]}>
                {status === 'cancelled' ? 'Paiement annulé' : 'Paiement échoué'}
              </Text>
              <Text style={s.sub}>
                {status === 'cancelled'
                  ? 'Vous avez annulé le paiement. Votre réservation est en attente.'
                  : 'Une erreur est survenue. Veuillez réessayer.'}
              </Text>
              <TouchableOpacity style={[s.btn, { backgroundColor: Colors.primary }]} onPress={goHome} testID="payment-retry-btn">
                <Text style={s.btnText}>Retour à l'accueil</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  safe:      { flex: 1 },
  content:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  iconWrap:  { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center' },
  title:     { fontSize: 24, fontWeight: '800', color: Colors.foreground, textAlign: 'center' },
  amount:    { fontSize: 32, fontWeight: '900', color: Colors.primary },
  sub:       { fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  btn:       { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 32, borderRadius: 30, marginTop: 8 },
  btnText:   { fontSize: 16, fontWeight: '700', color: '#fff' },
});
