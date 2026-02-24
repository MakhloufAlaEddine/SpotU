import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors, Spacing, Radius, Shadow } from '../constants/Colors';
import { useRouter } from 'expo-router';

interface TagPoint {
  point_id: string;
  title: string;
  description?: string;
  domain_id: string;
  tag_ids?: string[];
  tags?: Array<{ label_fr: string; label_en: string; name: string }>;
  owner?: { name: string; picture?: string };
  location?: { coordinates: number[] };
  created_at?: string;
}

interface Props {
  point: TagPoint;
  lang?: 'fr' | 'en';
}

const DOMAIN_COLORS: Record<string, string> = {
  dom_sport: Colors.sport,
  dom_coaching: Colors.coaching,
  dom_service: Colors.service,
  dom_social: Colors.social,
};

export function TagPointCard({ point, lang = 'fr' }: Props) {
  const router = useRouter();
  const color = DOMAIN_COLORS[point.domain_id] || Colors.primary;

  return (
    <TouchableOpacity
      testID={`tagpoint-card-${point.point_id}`}
      style={styles.card}
      onPress={() => router.push(`/tag-point/${point.point_id}`)}
      activeOpacity={0.85}
    >
      <View style={[styles.accent, { backgroundColor: color }]} />
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{point.title}</Text>
        {point.description && (
          <Text style={styles.desc} numberOfLines={2}>{point.description}</Text>
        )}
        <View style={styles.footer}>
          {point.owner && (
            <Text style={styles.owner}>👤 {point.owner.name}</Text>
          )}
          {point.tags && point.tags.length > 0 && (
            <View style={styles.tags}>
              {point.tags.slice(0, 3).map((tag) => (
                <View key={tag.name} style={[styles.tag, { borderColor: color }]}>
                  <Text style={[styles.tagText, { color }]}>
                    {lang === 'fr' ? tag.label_fr : tag.label_en}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
    ...Shadow.soft,
  },
  accent: { width: 4 },
  content: { flex: 1, padding: Spacing.md },
  title: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  desc: { fontSize: 13, color: Colors.muted, marginBottom: 8 },
  footer: { gap: 6 },
  owner: { fontSize: 12, color: Colors.muted },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, fontWeight: '600' },
});
