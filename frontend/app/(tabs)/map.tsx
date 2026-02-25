import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions, FlatList,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useLocation } from '../../context/LocationContext';
import { haversineDistance, formatDistance } from '../../utils/distance';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_W = SCREEN_WIDTH - Spacing.md * 2;
const HERO_H = 220;
const NEARBY_CARD_W = SCREEN_WIDTH * 0.7;
const NEARBY_CARD_H = 200;

const DOMAIN_COLORS: Record<string, string> = {
  dom_sport: '#1A5C4A',
  dom_coaching: '#1A3A5C',
  dom_service: '#5C3A1A',
  dom_social: '#5C1A1A',
};

const DOMAIN_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  dom_sport: 'football-outline',
  dom_coaching: 'school-outline',
  dom_service: 'construct-outline',
  dom_social: 'people-outline',
};

/** Calcule et formate la distance entre l'utilisateur et un tagpoint (pipe client) */
function distPipe(userLat: number, userLng: number, point: any): string {
  const lat = point.latitude ?? point.location?.coordinates?.[1];
  const lng = point.longitude ?? point.location?.coordinates?.[0];
  if (lat == null || lng == null) return '';
  return formatDistance(haversineDistance(userLat, userLng, lat, lng));
}

// ── Skeleton ────────────────────────────────────────────────
function Skeleton({ w, h, radius = 8 }: { w: number | string; h: number; radius?: number }) {
  return <View style={{ width: w as any, height: h, borderRadius: radius, backgroundColor: Colors.card, marginBottom: 6 }} />;
}

function SkeletonScreen() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} scrollEnabled={false}>
      <Skeleton w={CARD_W} h={HERO_H} radius={16} />
      <View style={{ paddingHorizontal: Spacing.md, marginTop: Spacing.md }}>
        <Skeleton w={140} h={18} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {[1, 2, 3].map(i => (
            <View key={i} style={{ marginRight: Spacing.sm }}>
              <Skeleton w={NEARBY_CARD_W} h={NEARBY_CARD_H} radius={16} />
            </View>
          ))}
        </ScrollView>
        <View style={{ height: Spacing.md }} />
        <Skeleton w={140} h={18} />
        {[1, 2, 3, 4, 5].map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm }}>
            <Skeleton w={70} h={55} radius={10} />
            <View style={{ flex: 1 }}>
              <Skeleton w="80%" h={14} />
              <Skeleton w="50%" h={12} />
              <Skeleton w="30%" h={12} />
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Hero Carousel Card ───────────────────────────────────────
function HeroCard({ point, onPress }: { point: any; onPress: () => void }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  const tag = point.tags?.[0];
  return (
    <TouchableOpacity style={[styles.heroCard, { width: CARD_W }]} onPress={onPress} activeOpacity={0.92}>
      {point.image_url ? (
        <Image source={{ uri: point.image_url }} style={styles.heroImage} />
      ) : (
        <View style={[styles.heroImage, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={icon} size={72} color="rgba(255,255,255,0.15)" />
        </View>
      )}
      {/* Gradient overlay */}
      <View style={styles.heroOverlay} />
      {/* Text */}
      <View style={styles.heroText}>
        <Text style={styles.heroTitle} numberOfLines={2}>{point.title}</Text>
        {tag && (
          <Text style={styles.heroSub}>
            {point.tags?.[0]?.label_fr || point.tags?.[0]?.label_en || ''}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Nearby Big Card ──────────────────────────────────────────
function NearbyCard({ point, userLat, userLng, onPress }: { point: any; userLat: number; userLng: number; onPress: () => void }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  const dist = distPipe(userLat, userLng, point);
  return (
    <TouchableOpacity
      style={[styles.nearbyCard, { width: NEARBY_CARD_W }]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      {point.image_url ? (
        <Image source={{ uri: point.image_url }} style={styles.nearbyImage} />
      ) : (
        <View style={[styles.nearbyImage, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={icon} size={56} color="rgba(255,255,255,0.12)" />
        </View>
      )}
      <View style={styles.nearbyOverlay} />
      {/* Top: title */}
      <View style={styles.nearbyTop}>
        <Text style={styles.nearbyTitle} numberOfLines={2}>{point.title}</Text>
        {point.description && (
          <Text style={styles.nearbySub} numberOfLines={1}>{point.description}</Text>
        )}
      </View>
      {/* Bottom: owner + distance */}
      <View style={styles.nearbyBottom}>
        <View style={styles.ownerRow}>
          {point.owner?.picture ? (
            <Image source={{ uri: point.owner.picture }} style={styles.ownerAvatar} />
          ) : (
            <View style={[styles.ownerAvatar, { backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' }]}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
                {point.owner?.name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <Text style={styles.ownerName} numberOfLines={1}>{point.owner?.name || '—'}</Text>
        </View>
        {dist ? <Text style={styles.nearbyDist}>{dist}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

// ── List Row Card ────────────────────────────────────────────
function ListCard({ point, onPress }: { point: any; onPress: () => void }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  return (
    <TouchableOpacity style={styles.listCard} onPress={onPress} activeOpacity={0.8}>
      {point.image_url ? (
        <Image source={{ uri: point.image_url }} style={styles.listThumb} />
      ) : (
        <View style={[styles.listThumb, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={icon} size={24} color="rgba(255,255,255,0.4)" />
        </View>
      )}
      <View style={styles.listInfo}>
        <Text style={styles.listTitle} numberOfLines={1}>{point.title}</Text>
        {point.description && (
          <Text style={styles.listDesc} numberOfLines={1}>{point.description}</Text>
        )}
        {point.owner && (
          <Text style={styles.listOwner}>{point.owner.name}</Text>
        )}
      </View>
      {point.distance != null && (
        <Text style={styles.listDist}>{formatDist(point.distance)}</Text>
      )}
    </TouchableOpacity>
  );
}

// ── Main Screen ──────────────────────────────────────────────
export default function HomeScreen() {
  const router = useRouter();
  const { t, lang } = useLang();
  const { location, loading: locLoading } = useGlobalLocation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tagPoints, setTagPoints] = useState<any[]>([]);

  // Carousel state
  const [heroIndex, setHeroIndex] = useState(0);
  const carouselRef = useRef<FlatList>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recharger quand la localisation change (retour de set-location)
  useEffect(() => {
    if (!locLoading) loadData();
  }, [location.lat, location.lng, locLoading]);

  // Auto-scroll hero
  useEffect(() => {
    const heroes = tagPoints.slice(0, 5);
    if (heroes.length < 2) return;
    autoScrollTimer.current = setInterval(() => {
      setHeroIndex(prev => {
        const next = (prev + 1) % heroes.length;
        carouselRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 3500);
    return () => { if (autoScrollTimer.current) clearInterval(autoScrollTimer.current); };
  }, [tagPoints]);

  const loadData = async () => {
    try {
      const nearby = await api.get(
        `/tag-points?lat=${location.lat}&lng=${location.lng}&radius=50000`
      );
      setTagPoints(Array.isArray(nearby) ? nearby : []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [location.lat, location.lng]);

  const heroPoints = tagPoints.slice(0, 5);
  const nearbyPoints = tagPoints.slice(0, 8);
  const recentPoints = [...tagPoints].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  ).slice(0, 10);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <View style={styles.headerLeft} />
          <Text style={styles.headerTitle}>Accueil</Text>
          <View style={styles.headerRight}>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/set-location' as any)}>
              <Ionicons name="location" size={22} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/(tabs)/search' as any)}>
              <Ionicons name="search" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {loading ? (
        <SkeletonScreen />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {/* ── Hero Carousel ── */}
          {heroPoints.length > 0 && (
            <View style={styles.carouselWrap}>
              <FlatList
                ref={carouselRef}
                data={heroPoints}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={i => i.point_id}
                renderItem={({ item }) => (
                  <HeroCard
                    point={item}
                    onPress={() => router.push(`/tag-point/${item.point_id}` as any)}
                  />
                )}
                onMomentumScrollEnd={e => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / CARD_W);
                  setHeroIndex(idx);
                  if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
                }}
                contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.md }}
                snapToInterval={CARD_W + Spacing.md}
                decelerationRate="fast"
                getItemLayout={(_, index) => ({ length: CARD_W + Spacing.md, offset: (CARD_W + Spacing.md) * index, index })}
              />
              {/* Dot pagination */}
              {heroPoints.length > 1 && (
                <View style={styles.dots}>
                  {heroPoints.map((_, i) => (
                    <View key={i} style={[styles.dot, i === heroIndex && styles.dotActive]} />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ── Section Près de vous ── */}
          {nearbyPoints.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Près de vous</Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/search' as any)}>
                  <Text style={styles.seeAll}>Voir tout</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={nearbyPoints}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={i => i.point_id + '_n'}
                renderItem={({ item }) => (
                  <NearbyCard
                    point={item}
                    onPress={() => router.push(`/tag-point/${item.point_id}` as any)}
                  />
                )}
                contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.sm }}
              />
            </View>
          )}

          {/* ── Section Récents ── */}
          {recentPoints.length > 0 && (
            <View style={[styles.section, { paddingHorizontal: Spacing.md }]}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Les plus récents</Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/search' as any)}>
                  <Text style={styles.seeAll}>Voir tout</Text>
                </TouchableOpacity>
              </View>
              {recentPoints.map(pt => (
                <ListCard
                  key={pt.point_id + '_r'}
                  point={pt}
                  onPress={() => router.push(`/tag-point/${pt.point_id}` as any)}
                />
              ))}
            </View>
          )}

          {/* Empty state */}
          {tagPoints.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="location-outline" size={56} color={Colors.muted} />
              <Text style={styles.emptyTitle}>Aucun TagPoint trouvé</Text>
              <Text style={styles.emptyDesc}>Sois le premier à créer un TagPoint près de toi !</Text>
              <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/(tabs)/create' as any)}>
                <Ionicons name="add" size={18} color={Colors.background} />
                <Text style={styles.createBtnText}>Créer un TagPoint</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Header
  safeHeader: { backgroundColor: Colors.header },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  headerLeft: { width: 60 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: Colors.primary },
  headerRight: { width: 60, flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
  headerBtn: { padding: 4 },

  // Carousel
  carouselWrap: { marginTop: Spacing.md },
  heroCard: {
    height: HERO_H,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.card,
  },
  heroImage: { position: 'absolute', width: '100%', height: '100%' },
  heroOverlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    height: '60%',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  heroText: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.md,
    right: Spacing.md,
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: '#fff', lineHeight: 28 },
  heroSub: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginTop: 2 },

  // Dots
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: Spacing.sm },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary, width: 18 },

  // Sections
  section: { marginTop: Spacing.lg },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  seeAll: { fontSize: 14, color: Colors.primary, fontWeight: '600', textDecorationLine: 'underline' },

  // Nearby Cards
  nearbyCard: {
    height: NEARBY_CARD_H,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.card,
  },
  nearbyImage: { position: 'absolute', width: '100%', height: '100%' },
  nearbyOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  nearbyTop: {
    position: 'absolute',
    top: Spacing.md,
    left: Spacing.md,
    right: Spacing.md,
  },
  nearbyTitle: { fontSize: 18, fontWeight: '800', color: '#fff', lineHeight: 24 },
  nearbySub: { fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  nearbyBottom: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  ownerAvatar: { width: 28, height: 28, borderRadius: 14, overflow: 'hidden' },
  ownerName: { fontSize: 13, color: '#fff', fontWeight: '600', flex: 1 },
  nearbyDist: { fontSize: 13, fontWeight: '700', color: Colors.primary },

  // List Cards
  listCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  listThumb: {
    width: 70,
    height: 55,
    borderRadius: Radius.sm,
    overflow: 'hidden',
  },
  listInfo: { flex: 1 },
  listTitle: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  listDesc: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  listOwner: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  listDist: { fontSize: 13, fontWeight: '700', color: Colors.primary, minWidth: 50, textAlign: 'right' },

  // Empty
  empty: { alignItems: 'center', padding: Spacing.xxl, gap: Spacing.md },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptyDesc: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    marginTop: Spacing.sm,
  },
  createBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
