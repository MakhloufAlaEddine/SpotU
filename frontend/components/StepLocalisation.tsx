/**
 * StepLocalisation — Composant partagé pour la sélection d'adresse, précision & carte
 * Utilisé dans SpotYou create/update et Service create/update
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { MapPreview } from './MapPreview';

const PRECISION_OPTIONS = [
  { value: 'exact', label: 'Lieu exact', desc: 'Adresse précise visible', icon: 'locate' as const },
  { value: '100m', label: '~100m', desc: 'Zone approximative', icon: 'radio-button-on' as const },
  { value: '1000m', label: '~1km', desc: 'Quartier seulement', icon: 'radio-button-off' as const },
];

interface StepLocalisationProps {
  selectedLat: number;
  selectedLng: number;
  locationAddress: string;
  precision: string;
  setPrecision: (v: string) => void;
  precisionRadius: number;
  onOpenLocation: () => void;
  accentColor?: string;
  showPrecision?: boolean;
}

export function StepLocalisation({
  selectedLat, selectedLng, locationAddress,
  precision, setPrecision, precisionRadius,
  onOpenLocation,
  accentColor = Colors.primary,
  showPrecision = true,
}: StepLocalisationProps) {
  return (
    <View style={{ gap: Spacing.lg }}>
      {/* Adresse */}
      <View>
        <Text style={s.label}>Adresse</Text>
        <TouchableOpacity style={s.locationRow} onPress={onOpenLocation} testID="open-location-btn">
          <Ionicons name="location" size={20} color={accentColor} />
          <Text style={s.locationText} numberOfLines={2}>{locationAddress}</Text>
          <View style={[s.editBadge, { backgroundColor: accentColor + '15' }]}>
            <Ionicons name="pencil" size={12} color={accentColor} />
            <Text style={[s.editBadgeText, { color: accentColor }]}>Modifier</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Précision */}
      {showPrecision && (
        <View>
          <Text style={s.label}>Niveau de confidentialité</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {PRECISION_OPTIONS.map(p => {
              const active = precision === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  style={[s.precisionCompact, active && { borderColor: accentColor, backgroundColor: accentColor + '08' }]}
                  onPress={() => setPrecision(p.value)}
                  testID={`precision-${p.value}`}
                >
                  <View style={[s.precisionCompactIcon, active && { backgroundColor: accentColor + '22' }]}>
                    <Ionicons name={p.icon} size={22} color={active ? accentColor : Colors.muted} />
                  </View>
                  <Text style={[s.precisionCompactLabel, active && { color: accentColor }]}>{p.label}</Text>
                  <Text style={s.precisionCompactDesc} numberOfLines={2}>{p.desc}</Text>
                  {active && (
                    <View style={[s.precisionCheck, { backgroundColor: accentColor }]}>
                      <Ionicons name="checkmark" size={10} color={Colors.background} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Carte */}
      <View>
        <Text style={s.label}>Aperçu sur la carte</Text>
        <MapPreview
          lat={selectedLat}
          lng={selectedLng}
          precision={precision}
          title={locationAddress}
          accentColor={accentColor}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  locationText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  editBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  editBadgeText: { fontSize: 12, fontWeight: '600' },
  precisionCompact: { flex: 1, alignItems: 'center', gap: 5, padding: 10, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, position: 'relative' as const, minHeight: 90 },
  precisionCompactIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  precisionCompactLabel: { fontSize: 12, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  precisionCompactDesc: { fontSize: 10, color: Colors.muted, textAlign: 'center', lineHeight: 13 },
  precisionCheck: { position: 'absolute' as const, top: 6, right: 6, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
