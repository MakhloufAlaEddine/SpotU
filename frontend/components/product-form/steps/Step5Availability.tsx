/**
 * Step 5 — Disponibilité + localisation
 * La ville est extraite automatiquement depuis l'adresse sélectionnée.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, LocationPrivacy } from '../ProductFormContext';
import { StepLocalisation } from '../../StepLocalisation';
import { LocationPicker }   from '../../LocationPicker';
import { useLocation }      from '../../../context/LocationContext';

const BLUE = '#3B82F6';

const PRECISION_RADIUS: Record<LocationPrivacy, number> = {
  exact: 0,
  '100m': 0.1,
  '1000m': 1.0,
};

/** Extrait la ville depuis une adresse Google Places formatée.
 *  Ex: "15 Rue de la Paix, 75001 Paris, France" → "Paris"
 *  Ex: "Stade de France, Saint-Denis, France" → "Saint-Denis"
 */
function extractCity(address: string): string {
  const parts = address.split(',').map(p => p.trim()).filter(p => p && p !== 'France');
  const last  = parts[parts.length - 1] ?? '';
  // Retire le code postal si présent (5 chiffres en début)
  return last.replace(/^\d{5}\s*/, '').trim();
}

export function Step5Availability() {
  const { form, set } = useProductForm();
  const { location }  = useLocation();
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Auto-fill si localisation vide au premier rendu
  React.useEffect(() => {
    if (!form.selectedLat && location?.lat) {
      const city = location.address ? extractCity(location.address) : '';
      set({
        selectedLat:     location.lat,
        selectedLng:     location.lng,
        locationAddress: location.address || 'Votre position actuelle',
        city,
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
        accentColor={BLUE}
        showPrecision={true}
      />

      {/* Note de disponibilité */}
      <View style={{ gap: 6 }}>
        <Text style={v.label}>Note de disponibilité <Text style={v.optional}>(optionnel)</Text></Text>
        <TextInput
          style={[v.input, v.textarea]}
          value={form.availability_note}
          onChangeText={val => set({ availability_note: val })}
          placeholder="ex: Disponible les weekends et mercredis après-midi…"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="availability-note-input"
        />
      </View>

      {/* Sélecteur de localisation */}
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

const v = StyleSheet.create({
  wrap:     { gap: 14 },
  infoCard: { backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '30' },
  infoText: { fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  label:    { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  optional: { color: Colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  hint:     { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  input:    { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 11 },
  textarea: { minHeight: 72, paddingTop: 11 },
});
