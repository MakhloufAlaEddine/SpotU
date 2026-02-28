import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '../../constants/Colors';

export default function BookingSuccessScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>
        <View style={s.iconCircle}>
          <Ionicons name="checkmark" size={48} color={Colors.primary} />
        </View>

        <Text style={s.title}>Demande envoyée !</Text>
        <Text style={s.subtitle}>
          Le coach a reçu votre demande de réservation.{'\n'}
          Vous serez notifié dès qu'il aura répondu.
        </Text>

        <View style={s.payNote}>
          <Ionicons name="card-outline" size={18} color={Colors.muted} />
          <Text style={s.payNoteText}>
            Aucun paiement prélevé. Le règlement se fera après confirmation du coach.
          </Text>
        </View>

        <View style={s.actions}>
          <TouchableOpacity
            style={s.primaryBtn}
            onPress={() => router.replace('/(tabs)/bookings' as any)}
            testID="view-bookings-btn"
          >
            <Ionicons name="list-outline" size={18} color={Colors.background} />
            <Text style={s.primaryBtnText}>Voir mes réservations</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.secondaryBtn}
            onPress={() => router.replace('/(tabs)/map' as any)}
            testID="back-home-btn"
          >
            <Text style={s.secondaryBtnText}>Retour à l'accueil</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 },
  iconCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(29,191,115,0.12)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(29,191,115,0.3)', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '800', color: Colors.foreground, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: Colors.muted, textAlign: 'center', lineHeight: 22 },
  payNote: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: Colors.border, width: '100%' },
  payNoteText: { flex: 1, fontSize: 13, color: Colors.muted, lineHeight: 18 },
  actions: { width: '100%', gap: 12, marginTop: 8 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16 },
  primaryBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
  secondaryBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  secondaryBtnText: { fontSize: 15, fontWeight: '600', color: Colors.muted },
});
