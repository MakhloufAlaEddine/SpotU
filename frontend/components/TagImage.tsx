/**
 * TagImage — Image with colored placeholder showing domain icon while loading.
 * Used in: SpotYouCard, HeroCard, RecentRow, ServiceCard, detail pages.
 */
import React, { useState, useRef, useEffect } from 'react';
import { View, Image, Animated, StyleSheet, ImageStyle, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Domain color & icon maps (shared source of truth)
export const DOMAIN_COLORS: Record<string, string> = {
  domain_fitness: '#1A5C4A',
  domain_outdoor: '#1A3A5C',
  domain_wellness: '#5C3A1A',
  domain_social: '#5C1A1A',
  dom_sport: '#1A5C4A',
  dom_coaching: '#1A3A5C',
  dom_service: '#5C3A1A',
  dom_social: '#5C1A1A',
};

export const DOMAIN_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  domain_fitness: 'fitness-outline',
  domain_outdoor: 'leaf-outline',
  domain_wellness: 'heart-outline',
  domain_social: 'people-outline',
  dom_sport: 'football-outline',
  dom_coaching: 'school-outline',
  dom_service: 'construct-outline',
  dom_social: 'people-outline',
};

interface TagImageProps {
  uri: string;
  domainId?: string;
  /** Override placeholder bg color */
  placeholderColor?: string;
  /** Override placeholder icon */
  placeholderIcon?: keyof typeof Ionicons.glyphMap;
  /** Icon size (default: 30) */
  iconSize?: number;
  /** Style applied to both image and placeholder */
  style?: ImageStyle | ViewStyle;
  /** Fill the parent absolutely (default: false) */
  fill?: boolean;
}

export function TagImage({
  uri,
  domainId,
  placeholderColor,
  placeholderIcon,
  iconSize = 30,
  style,
  fill = false,
}: TagImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setLoaded(false);
    setLoadFailed(false);
    opacity.setValue(0);
  }, [uri, opacity]);

  const bg = placeholderColor || DOMAIN_COLORS[domainId || ''] || '#1A3A3A';
  const icon = placeholderIcon || DOMAIN_ICONS[domainId || ''] || 'location-outline';

  const onLoad = () => {
    setLoaded(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  };

  const containerStyle = fill ? StyleSheet.absoluteFillObject : style;

  return (
    <View style={[containerStyle, { overflow: 'hidden' }]}>
      {/* Colored placeholder — always rendered, hidden behind image once loaded */}
      {(!loaded || loadFailed) && (
        <View style={[StyleSheet.absoluteFillObject, st.placeholder, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={iconSize} color="rgba(255,255,255,0.25)" />
        </View>
      )}
      {/* Actual image — fades in on load */}
      <Animated.Image
        source={{ uri }}
        style={[StyleSheet.absoluteFillObject, { opacity: loadFailed ? 0 : opacity }]}
        resizeMode="cover"
        onLoad={onLoad}
        onError={() => setLoadFailed(true)}
      />
    </View>
  );
}

const st = StyleSheet.create({
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
