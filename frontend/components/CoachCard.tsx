import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Colors, Spacing, Radius, Shadow } from '../constants/Colors';
import { useGuardedRouter } from '../hooks/useGuardedRouter';
;

interface Service {
  service_id: string;
  title: string;
  description?: string;
  price: number;
  duration_min: number;
  coach?: { user_id: string; name: string; picture?: string; is_coach_verified?: boolean };
  avg_rating?: number;
  review_count?: number;
  location_description?: string;
}

interface Props {
  service: Service;
  lang?: 'fr' | 'en';
}

export function CoachCard({ service, lang = 'fr' }: Props) {
  const router = useGuardedRouter();

  return (
    <TouchableOpacity
      testID={`coach-card-${service.service_id}`}
      style={styles.card}
      onPress={() => router.push(`/coach/${service.coach?.user_id}?service_id=${service.service_id}`)}
      activeOpacity={0.85}
    >
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {service.coach?.name?.[0]?.toUpperCase() ?? '?'}
          </Text>
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{service.coach?.name ?? '—'}</Text>
            {service.coach?.is_coach_verified && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>✓ {lang === 'fr' ? 'Vérifié' : 'Verified'}</Text>
              </View>
            )}
          </View>
          <Text style={styles.serviceTitle} numberOfLines={1}>{service.title}</Text>
          {service.avg_rating && (
            <Text style={styles.rating}>⭐ {service.avg_rating} ({service.review_count})</Text>
          )}
        </View>
        <View style={styles.priceBox}>
          <Text style={styles.price}>{service.price}€</Text>
          <Text style={styles.duration}>{service.duration_min} min</Text>
        </View>
      </View>
      {service.description && (
        <Text style={styles.desc} numberOfLines={2}>{service.description}</Text>
      )}
      {service.location_description && (
        <Text style={styles.location}>📍 {service.location_description}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    ...Shadow.soft,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  avatar: {
    width: 48, height: 48, borderRadius: Radius.full,
    backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  badge: { backgroundColor: Colors.primaryLight, borderRadius: Radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 10, color: Colors.primary, fontWeight: '700' },
  serviceTitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  rating: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  priceBox: { alignItems: 'flex-end' },
  price: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  duration: { fontSize: 11, color: Colors.muted },
  desc: { fontSize: 13, color: Colors.muted, marginTop: 8 },
  location: { fontSize: 12, color: Colors.muted, marginTop: 4 },
});
