import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// ── Domain → color ──────────────────────────────────────────────────────────
const DOMAIN_COLORS: Record<string, string> = {
  dom_sport:    '#1DBF73',
  dom_coaching: '#007AFF',
  dom_service:  '#FF9500',
  dom_social:   '#FF3B30',
};

// ── Category → Ionicon name ─────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  cat_running:       'footsteps-outline',
  cat_basketball:    'basketball-outline',
  cat_football:      'football-outline',
  cat_cycling:       'bicycle-outline',
  cat_fitness:       'barbell-outline',
  cat_hiking:        'trail-sign-outline',
  cat_martial:       'shield-outline',
  cat_swimming:      'water-outline',
  cat_tennis:        'tennisball-outline',
  cat_yoga:          'body-outline',
  cat_sport_coach:   'person-outline',
  cat_fitness_coach: 'barbell-outline',
  cat_mental_coach:  'bulb-outline',
};

// ── Fallback domain → icon ──────────────────────────────────────────────────
const DOMAIN_ICONS: Record<string, string> = {
  dom_sport:    'barbell-outline',
  dom_coaching: 'person-outline',
  dom_service:  'briefcase-outline',
  dom_social:   'people-outline',
};

interface Props {
  domainId?: string | null;
  categoryId?: string | null;
  tags?: Array<{ category_id?: string }>;
  size?: 'sm' | 'md' | 'lg';
  style?: any;
  showHint?: boolean;
}

export function ServicePlaceholder({ domainId, categoryId, tags, size = 'lg', style, showHint = false }: Props) {
  const cat = categoryId || tags?.[0]?.category_id || null;
  const iconName = (cat && CATEGORY_ICONS[cat]) || (domainId && DOMAIN_ICONS[domainId]) || 'image-outline';
  const bgColor = (domainId && DOMAIN_COLORS[domainId]) || '#1DBF73';

  const iconSize = size === 'sm' ? 28 : size === 'md' ? 42 : 56;
  const containerHeight = size === 'sm' ? 80 : size === 'md' ? 140 : 220;

  return (
    <View
      style={[
        s.container,
        { backgroundColor: bgColor + '18', height: containerHeight },
        style,
      ]}
      testID="service-placeholder-image"
    >
      <View style={[s.iconCircle, { backgroundColor: bgColor + '30' }]}>
        <Ionicons name={iconName as any} size={iconSize} color={bgColor} />
      </View>
      {showHint && (
        <Text style={[s.hint, { color: bgColor }]}>Ajoutez vos photos</Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  iconCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
});
