import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  TouchableOpacity, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useGlobalLocation } from '../../hooks/useGlobalLocation';

// Star Rating Component
function StarRating({ rating = 0, maxStars = 5 }: { rating?: number; maxStars?: number }) {
  return (
    <View style={starStyles.container}>
      {[...Array(maxStars)].map((_, index) => (
        <Ionicons
          key={index}
          name={index < rating ? 'star' : 'star-outline'}
          size={14}
          color={index < rating ? Colors.star : Colors.starEmpty}
        />
      ))}
    </View>
  );
}

const starStyles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 2 },
});

// Result Item Component
interface ResultItemProps {
  image?: string;
  title: string;
  author: string;
  distance: string;
  rating?: number;
  onPress: () => void;
}

function ResultItem({ image, title, author, distance, rating = 0, onPress }: ResultItemProps) {
  return (
    <TouchableOpacity style={itemStyles.container} onPress={onPress} activeOpacity={0.7}>
      <View style={itemStyles.imageContainer}>
        {image ? (
          <Image source={{ uri: image }} style={itemStyles.image} />
        ) : (
          <View style={itemStyles.imagePlaceholder}>
            <Ionicons name="image-outline" size={24} color={Colors.muted} />
          </View>
        )}
      </View>
      <View style={itemStyles.content}>
        <Text style={itemStyles.title} numberOfLines={1}>{title}</Text>
        <Text style={itemStyles.author} numberOfLines={1}>{author}</Text>
        <Text style={itemStyles.distance}>{distance}</Text>
      </View>
      <View style={itemStyles.right}>
        <StarRating rating={rating} />
        <View style={itemStyles.viewBtn}>
          <Text style={itemStyles.viewText}>Voir</Text>
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const itemStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
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
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  author: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 2,
  },
  distance: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
    marginTop: 4,
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

export default function SearchScreen() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [query, setQuery] = useState('');
  const [radiusKm, setRadiusKm] = useState(40);
  const [combineMode, setCombineMode] = useState(false);
  const [tagPoints, setTagPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { location } = useGlobalLocation();
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    if (location) doSearch();
  }, [location.lat, location.lng, radiusKm]);

  const doSearch = useCallback(async () => {
    setLoading(true);
    try {
      const radius = radiusKm * 1000;
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        radius: radius.toString(),
      });
      const pts = await api.get(`/tag-points?${params.toString()}`);
      setTagPoints(pts);
    } catch {}
    finally { setLoading(false); }
  }, [location.lat, location.lng, radiusKm]);

  // Format distance
  const formatDistance = (distanceMeters?: number) => {
    if (!distanceMeters) return '---';
    if (distanceMeters < 1000) {
      return `${Math.round(distanceMeters)}M`;
    }
    return `${(distanceMeters / 1000).toFixed(1)}KM`;
  };

  const filteredPoints = query
    ? tagPoints.filter((p) => p.title?.toLowerCase().includes(query.toLowerCase()))
    : tagPoints;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Résultats</Text>
        <TouchableOpacity style={styles.headerAction} onPress={() => router.push('/set-location' as any)}>
          <Ionicons name="location" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Tag Search Input */}
        <View style={styles.tagInputRow}>
          <View style={styles.tagInput}>
            {selectedTag ? (
              <TouchableOpacity 
                style={styles.selectedTagPill}
                onPress={() => setSelectedTag(null)}
              >
                <Text style={styles.selectedTagText}>{selectedTag}</Text>
                <Ionicons name="close" size={14} color={Colors.foreground} />
              </TouchableOpacity>
            ) : (
              <TextInput
                style={styles.tagInputText}
                placeholder="Chercher des tags"
                placeholderTextColor={Colors.muted}
                value={query}
                onChangeText={setQuery}
              />
            )}
          </View>
          <View style={styles.combineRow}>
            <Text style={styles.combineLabel}>Combiner</Text>
            <TouchableOpacity 
              style={[styles.combineToggle, combineMode && styles.combineToggleActive]}
              onPress={() => setCombineMode(!combineMode)}
            >
              {combineMode && <View style={styles.combineToggleDot} />}
            </TouchableOpacity>
          </View>
        </View>

        {/* Location Row */}
        <TouchableOpacity style={styles.locationRow}>
          <Ionicons name="location" size={20} color={Colors.primary} />
          <Text style={styles.locationText} numberOfLines={1}>
            Gare Montparnas......75014 Pa...
          </Text>
        </TouchableOpacity>

        {/* Distance Slider */}
        <View style={styles.sliderSection}>
          <Text style={styles.sliderValue}>{radiusKm}Km</Text>
          <View style={styles.sliderRow}>
            <TouchableOpacity 
              style={styles.sliderEndBtn}
              onPress={() => setRadiusKm(Math.max(1, radiusKm - 5))}
            >
              <View style={styles.sliderEndCircle} />
            </TouchableOpacity>
            <Slider
              style={styles.slider}
              minimumValue={1}
              maximumValue={100}
              value={radiusKm}
              onValueChange={(val) => setRadiusKm(Math.round(val))}
              minimumTrackTintColor={Colors.primary}
              maximumTrackTintColor={Colors.border}
              thumbTintColor={Colors.foreground}
            />
            <TouchableOpacity 
              style={styles.sliderEndBtnRight}
              onPress={() => setRadiusKm(Math.min(100, radiusKm + 5))}
            >
              <Ionicons name="radio-button-on" size={24} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Results */}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} size="large" />
          </View>
        ) : (
          <View style={styles.results}>
            {filteredPoints.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color={Colors.muted} />
                <Text style={styles.emptyText}>Aucun résultat trouvé</Text>
              </View>
            ) : (
              filteredPoints.map((pt) => (
                <ResultItem
                  key={pt.point_id}
                  image={pt.image_url}
                  title={pt.title || 'Sans titre'}
                  author={pt.owner?.name || 'Anonyme'}
                  distance={formatDistance(pt.distance)}
                  rating={pt.rating || 0}
                  onPress={() => router.push(`/tag-point/${pt.point_id}`)}
                />
              ))
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { 
    flex: 1, 
    backgroundColor: Colors.header 
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.primary,
  },
  headerAction: { padding: 4 },
  content: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  tagInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  tagInput: {
    flex: 1,
    backgroundColor: Colors.header,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  tagInputText: {
    fontSize: 14,
    color: Colors.foreground,
  },
  selectedTagPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    gap: 6,
    alignSelf: 'flex-start',
  },
  selectedTagText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.foreground,
  },
  combineRow: {
    alignItems: 'center',
    gap: 4,
  },
  combineLabel: {
    fontSize: 12,
    color: Colors.muted,
  },
  combineToggle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  combineToggleActive: {
    borderColor: Colors.primary,
  },
  combineToggleDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    gap: 8,
    marginBottom: Spacing.sm,
  },
  locationText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
  },
  sliderSection: {
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  sliderValue: {
    fontSize: 13,
    color: Colors.muted,
    textAlign: 'center',
    marginBottom: 4,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sliderEndBtn: {
    padding: 4,
  },
  sliderEndBtnRight: {
    padding: 4,
  },
  sliderEndCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.muted,
  },
  slider: {
    flex: 1,
    height: 40,
  },
  results: {
    paddingHorizontal: Spacing.md,
    paddingBottom: 40,
  },
  center: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center', 
    padding: Spacing.xxl 
  },
  empty: { 
    alignItems: 'center', 
    padding: Spacing.xl, 
    gap: 12 
  },
  emptyText: { 
    fontSize: 15, 
    color: Colors.muted, 
    textAlign: 'center' 
  },
});
