/**
 * Écran Panier — accessible depuis le menu
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CartContent } from '../components/CartContent';
import { useCart } from '../context/CartContext';
import { Colors, Spacing } from '../constants/Colors';

const COBALT = '#3B82F6';

export default function CartScreen() {
  const router = useRouter();
  const { totalItems } = useCart();

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="cart-back-btn">
          <Ionicons name="arrow-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <View style={s.headerIcon}>
            <Ionicons name="cart-outline" size={18} color={COBALT} />
          </View>
          <Text style={s.headerTitle}>Mon Panier</Text>
        </View>
        {totalItems > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeTxt}>{totalItems}</Text>
          </View>
        )}
      </View>

      {/* Contenu partagé */}
      <CartContent onCheckout={() => {
        /* TODO: intégration Stripe checkout */
      }} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 12 },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerCenter:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerIcon:    { width: 32, height: 32, borderRadius: 8, backgroundColor: 'rgba(59,130,246,0.12)', alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  badge:         { backgroundColor: COBALT, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt:      { fontSize: 12, fontWeight: '800', color: '#fff' },
});
