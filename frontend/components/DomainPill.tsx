import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Colors, Radius, Spacing } from '../constants/Colors';
import { Ionicons } from '@expo/vector-icons';

interface Domain {
  domain_id: string;
  name: string;
  label_fr: string;
  label_en: string;
  color: string;
  icon: string;
}

interface Props {
  domain: Domain;
  selected: boolean;
  onPress: () => void;
  lang?: 'fr' | 'en';
}

const ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  sport: 'fitness-outline',
  coaching: 'school-outline',
  service: 'construct-outline',
  social: 'people-outline',
};

export function DomainPill({ domain, selected, onPress, lang = 'fr' }: Props) {
  const label = lang === 'fr' ? domain.label_fr : domain.label_en;
  const icon = ICONS[domain.name] ?? 'flash-outline';
  const color = domain.color || Colors.primary;

  return (
    <TouchableOpacity
      testID={`domain-pill-${domain.domain_id}`}
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.pill,
        selected ? { backgroundColor: color, borderColor: color } : styles.inactive,
      ]}
    >
      <Ionicons 
        name={icon} 
        size={14} 
        color={selected ? '#fff' : Colors.muted} 
      />
      <Text style={[styles.label, selected ? styles.labelActive : styles.labelInactive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs + 4,
    borderRadius: Radius.full,
    borderWidth: 0,
    marginRight: Spacing.sm,
    backgroundColor: Colors.card,
  },
  inactive: { backgroundColor: Colors.card },
  label: { fontSize: 13, fontWeight: '600' },
  labelActive: { color: '#fff' },
  labelInactive: { color: Colors.foreground },
});
