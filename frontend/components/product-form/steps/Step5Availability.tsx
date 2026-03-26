/**
 * Step 5 — Disponibilité + localisation
 * Réutilise StepLocalisation (même composant que SpotYou + Services)
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, LocationPrivacy } from '../ProductFormContext';
import { StepLocalisation } from '../../StepLocalisation';
import { LocationPicker }   from '../../LocationPicker';
import { useLocation }      from '../../../context/LocationContext';

const VIOLET = '#8B5CF6';

const PRECISION_RADIUS: Record<LocationPrivacy, number> = {
  exact: 0,
  '100m': 0.1,
  '1000m': 1.0,
};

export function Step5Availability() {
  const { form, set } = useProductForm();
  const { location }  = useLocation();
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Auto-fill si localisation vide au premier rendu
  React.useEffect(() => {
    if (!form.selectedLat && location?.lat) {
      set({
        selectedLat:     location.lat,
        selectedLng:     location.lng,
        locationAddress: location.address || 'Votre position actuelle',
      });
    }
  }, [location?.lat]);

  return (
    <View style={v.wrap}>
      {/* Info box */}
      <View style={v.infoCard}>
        <Text style={v.infoText}>
          Indique où ton matériel est disponible. Le niveau de confidentialité te permet de masquer ton adresse exacte aux locataires.
        </Text>
      </View>

      {/* Localisation (composant partagé) */}
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
        accentColor={VIOLET}
        showPrecision={true}
      />

      {/* Ville */}
      <View style={{ gap: 6 }}>
        <Text style={v.label}>Ville</Text>
        <TextInput
          style={v.input}
          value={form.city}
          onChangeText={val => set({ city: val })}
          placeholder="ex: Paris 11e, Lyon, Bordeaux…"
          placeholderTextColor={Colors.muted}
          testID="city-input"
        />
      </View>

      {/* Note de disponibilité */}
      <View style={{ gap: 6 }}>
        <Text style={v.label}>Note de disponibilité</Text>
        <TextInput
          style={[v.input, v.textarea]}
          value={form.availability_note}
          onChangeText={val => set({ availability_note: val })}
          placeholder="ex: Disponible les weekends et mercredis après-midi. Contacter avant réservation."
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="availability-note-input"
        />
        <Text style={v.hint}>Décris quand et comment ton matériel est disponible</Text>
      </View>

      {/* Sélecteur de localisation */}
      <LocationPicker
        visible={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelect={(lat, lng, address) => {
          set({ selectedLat: lat, selectedLng: lng, locationAddress: address });
          setShowLocationModal(false);
        }}
        initialLat={form.selectedLat || undefined}
        initialLng={form.selectedLng || undefined}
        initialAddress={form.locationAddress}
      />
    </View>
  );
}

const v = StyleSheet.create({
  wrap:     { gap: Spacing.lg },
  infoCard: { backgroundColor: VIOLET + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: VIOLET + '30' },
  infoText: { fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  label:    { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint:     { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  input:    { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 12 },
  textarea: { minHeight: 80 },
});
