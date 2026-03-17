/**
 * MapPreview — Composant partagé pour afficher un aperçu carte avec cercle de précision
 * Utilisé dans: service/[id].tsx, spot-you/[id].tsx, StepLocalisation.tsx
 */
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { MapViewComponent } from './MapViewComponent';
import type { MapPin } from './MapViewComponent';
import { Colors, Radius } from '../constants/Colors';

interface MapPreviewProps {
  lat: number;
  lng: number;
  precision?: string; // 'exact' | '100m' | '1000m'
  title?: string;
  accentColor?: string;
  height?: number;
  style?: ViewStyle;
  /** Additional pins (e.g. other locations for a service) */
  extraPins?: MapPin[];
  onPinPress?: (id: string) => void;
}

/** Convert precision string to radius in meters */
function precisionToRadius(precision: string): number {
  if (precision === '1000m') return 1000;
  if (precision === '100m') return 100;
  return 0;
}

export function MapPreview({
  lat,
  lng,
  precision = 'exact',
  title = '',
  accentColor = Colors.primary,
  height = 200,
  style,
  extraPins,
  onPinPress,
}: MapPreviewProps) {
  const radius = precisionToRadius(precision);
  const zoom = radius >= 1000 ? 13 : radius >= 100 ? 15 : 16;

  // Exact: show a pin marker at center + any extraPins
  // Non-exact: show circle via precisionRadius, no center pin
  const pins: MapPin[] = radius === 0
    ? [{ id: '_center', lat, lng, title, color: accentColor }, ...(extraPins || [])]
    : (extraPins || []);

  return (
    <View style={[styles.wrap, { height }, style]} testID="map-preview">
      <MapViewComponent
        key={`${lat}-${lng}-${precision}`}
        centerLat={lat}
        centerLng={lng}
        zoom={zoom}
        selectable={false}
        showUserMarker={false}
        selectedLat={lat}
        selectedLng={lng}
        pins={pins}
        precisionRadius={radius}
        onPinPress={onPinPress}
        style={{ flex: 1 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
});
