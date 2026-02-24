import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

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
  image_url?: string;
  distance?: number;
  rating?: number;
}

interface Props {
  point: TagPoint;
  lang?: 'fr' | 'en';
}

const DOMAIN_COLORS: Record<string, string> = {
  dom_sport: Colors.sport,
  dom_coaching: Colors.coaching,
  dom_service: Colors.service,
  dom_social: Colors.socialDomain,
};

// Star Rating Component
function StarRating({ rating = 0, maxStars = 5 }: { rating?: number; maxStars?: number }) {
  return (
    <View style={starStyles.container}>
      {[...Array(maxStars)].map((_, index) => (
        <Ionicons
          key={index}
          name={index < rating ? 'star' : 'star-outline'}
          size={12}
          color={index < rating ? Colors.star : Colors.starEmpty}
        />
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 2 },
});

export function TagPointCard({ point, lang = 'fr' }: Props) {
  const router = useRouter();
  const color = DOMAIN_COLORS[point.domain_id] || Colors.primary;

  const formatDistance = (distanceMeters?: number) => {
    if (!distanceMeters) return '';
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)}M`;
    }
    return `${(distanceMeters / 1000).toFixed(1)}KM`;
  };

  return (
    <TouchableOpacity
      testID={`tagpoint-card-${point.point_id}`}
      style={styles.card}
      onPress={() => router.push(`/tag-point/${point.point_id}`)}
      activeOpacity={0.7}
    >
      {/* Image */}
      <View style={styles.imageContainer}>
        {point.image_url ? (
          <Image source={{ uri: point.image_url }} style={styles.image} />
        ) : (
          <View style={[styles.imagePlaceholder, { backgroundColor: color + '30' }]}>
            <Ionicons name="location" size={24} color={color} />
          </View>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={1}>{point.title}</Text>
        {point.owner && (
          <Text style={styles.author}>{point.owner.name}</Text>
        )}
        {point.distance && (
          <Text style={styles.distance}>{formatDistance(point.distance)}</Text>
        )}
      </View>

      {/* Right side */}
      <View style={styles.right}>
        <StarRating rating={point.rating || 0} />
        <View style={styles.viewBtn}>
          <Text style={styles.viewText}>Voir</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: Colors.background,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  imageContainer: {
    width: 80,
    height: 60,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { 
    flex: 1, 
    justifyContent: 'center' 
  },
  title: { 
    fontSize: 15, 
    fontWeight: '600', 
    color: Colors.foreground 
  },
  author: { 
    fontSize: 13, 
    color: Colors.muted, 
    marginTop: 2 
  },
  distance: { 
    fontSize: 13, 
    fontWeight: '600', 
    color: Colors.foreground, 
    marginTop: 4 
  },
  right: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
  },
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  viewText: {
    fontSize: 13,
    color: Colors.muted,
  },
});
