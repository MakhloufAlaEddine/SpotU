/**
 * StepSalePricingLocation — Étape 4 du flow VENTE
 * Prix de vente + mode de remise + localisation (composants partagés)
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, PickupType, LocationPrivacy } from '../ProductFormContext';
import { StepLocalisation } from '../../StepLocalisation';
import { LocationPicker }   from '../../LocationPicker';

const BLUE = '#3B82F6';

const PRECISION_RADIUS: Record<LocationPrivacy, number> = {
  exact: 0,
  '100m': 0.1,
  '1000m': 1.0,
};

const PICKUP_OPTS: { key: PickupType; label: string; desc: string; icon: string }[] = [
  { key: 'local_pickup',    label: 'Sur place',             desc: "L'acheteur vient chercher", icon: 'location-outline' },
  { key: 'creator_handoff', label: 'Remise en main propre', desc: 'Tu apportes le matériel',   icon: 'person-outline'   },
];

function extractCity(address: string): string {
  const parts = address.split(',').map(p => p.trim()).filter(p => p && p !== 'France');
  const last  = parts[parts.length - 1] ?? '';
  return last.replace(/^\d{5}\s*/, '').trim();
}

export function StepSalePricingLocation() {
  const { form, set } = useProductForm();
  const [showLocationModal, setShowLocationModal] = useState(false);

  const salePrice = form.sale_price || '';

  return (
    <View style={s.wrap}>

      {/* ── Prix de vente ──────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>PRIX DE VENTE <Text style={s.req}>*</Text></Text>
        <View style={s.priceBlock}>
          <View style={s.priceRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.priceLabel}>Prix unique</Text>
              <Text style={s.priceUnit}>Montant payé par l'acheteur</Text>
            </View>
            <View style={s.inputWrap}>
              <TextInput
                style={s.priceInput}
                value={salePrice}
                onChangeText={v => set({ sale_price: v.replace(/[^0-9.,]/g, '') })}
                placeholder="0"
                placeholderTextColor={Colors.muted}
                keyboardType="decimal-pad"
                testID="sale-price-input"
              />
              <Text style={s.euro}>€</Text>
            </View>
          </View>
        </View>
      </View>

      {/* ── Mode de remise ─────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>MODE DE REMISE <Text style={s.req}>*</Text></Text>
        <View style={s.pickupRow}>
          {PICKUP_OPTS.map(o => {
            const active = form.pickup_type === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                style={[s.pickupCard, active && s.pickupCardActive]}
                onPress={() => set({ pickup_type: o.key })}
                testID={`pickup-${o.key}`}
                activeOpacity={0.75}
              >
                <View style={[s.pickupIcon, active && { backgroundColor: BLUE + '22' }]}>
                  <Ionicons name={o.icon as any} size={22} color={active ? BLUE : Colors.muted} />
                </View>
                <Text style={[s.pickupLabel, active && { color: BLUE }]}>{o.label}</Text>
                <Text style={s.pickupDesc} numberOfLines={1}>{o.desc}</Text>
                {active && (
                  <View style={s.pickupCheck}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Localisation ───────────────────────────────────────────────── */}
      <View style={s.section}>
        <View style={s.infoCard}>
          <Ionicons name="information-circle-outline" size={14} color={BLUE} />
          <Text style={s.infoText}>
            Indique où se trouve le matériel pour que l'acheteur sache où venir le récupérer.
          </Text>
        </View>
        <StepLocalisation
          selectedLat={form.selectedLat}
          selectedLng={form.selectedLng}
          locationAddress={form.locationAddress}
          precision={form.location_privacy}
          setPrecision={(val) => set({
            location_privacy: val as LocationPrivacy,
            radius_km: PRECISION_RADIUS[val as LocationPrivacy] ?? 0.1,
          } as any)}
          precisionRadius={PRECISION_RADIUS[form.location_privacy]}
          onOpenLocation={() => setShowLocationModal(true)}
          accentColor={BLUE}
          showPrecision={true}
        />
      </View>

      <LocationPicker
        visible={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelect={(lat, lng, address) => {
          set({
            selectedLat:     lat,
            selectedLng:     lng,
            locationAddress: address,
            city:            extractCity(address),
          });
          setShowLocationModal(false);
        }}
        initialLat={form.selectedLat || undefined}
        initialLng={form.selectedLng || undefined}
        initialAddress={form.locationAddress}
      />
    </View>
  );
}

const s = StyleSheet.create({
  wrap:         { gap: 18 },
  section:      { gap: 10 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  req:          { color: '#EF4444' },

  // Prix
  priceBlock:   { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  priceRow:     { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  priceLabel:   { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  priceUnit:    { fontSize: 11, color: Colors.muted, marginTop: 2 },
  inputWrap:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceInput:   { minWidth: 80, textAlign: 'right', fontSize: 22, fontWeight: '800', color: Colors.foreground, paddingVertical: 4, paddingHorizontal: 6 },
  euro:         { fontSize: 18, fontWeight: '700', color: BLUE },

  // Pickup
  pickupRow:    { flexDirection: 'row', gap: 10 },
  pickupCard:   { flex: 1, alignItems: 'center', gap: 6, padding: 14, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, position: 'relative' },
  pickupCardActive: { borderColor: BLUE, backgroundColor: BLUE + '08' },
  pickupIcon:   { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  pickupLabel:  { fontSize: 13, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  pickupDesc:   { fontSize: 11, color: Colors.muted, textAlign: 'center' },
  pickupCheck:  { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },

  // Info card
  infoCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '30' },
  infoText:     { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
});
