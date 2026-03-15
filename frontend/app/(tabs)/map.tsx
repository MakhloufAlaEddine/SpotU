import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Dimensions, FlatList,
  Image, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useLocation } from '../../context/LocationContext';
import { useAuth } from '../../context/AuthContext';
import { haversineDistance, formatDistance } from '../../utils/distance';
import { buildCacheKey, cacheGet, cacheSet, isFresh, cacheAgeMinutes, SCHEMA_VERSION } from '../../lib/cache';
import { StaleBanner, ErrorNoData } from '../../components/OfflineBanner';
import { registerScreenRefresh } from '../../hooks/useNetwork';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';
import { useSpotYouListLive } from '../../hooks/useSpotYouListLive';
import { reverseGeocodeGoogle, getCityFromCoords } from '../../services/googlePlacesService';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

const { width: SW } = Dimensions.get('window');
const HERO_H = 280;
const SVC_CARD_W = SW * 0.65;
const SVC_CARD_H = 160;

const ORANGE = '#FF9500';
const ORANGE_DIM = 'rgba(255,149,0,0.15)';

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

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return 'Bonne nuit';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function distPipe(userLat: number, userLng: number, point: any): string {
  const lat = point.latitude ?? point.location?.coordinates?.[1];
  const lng = point.longitude ?? point.location?.coordinates?.[0];
  if (lat == null || lng == null) return '';
  return formatDistance(haversineDistance(userLat, userLng, lat, lng));
}

// ── PulseDot — point animé temps réel ──────────────────────
function PulseDot({ color = '#00E676' }: { color?: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.8, duration: 900, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.4, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{
      width: 6, height: 6, borderRadius: 3,
      backgroundColor: color,
      transform: [{ scale }],
      opacity,
    }} />
  );
}

// ── LiveBadge — badge membres en direct ────────────────────
function LiveBadge({ count, variant = 'default' }: { count: number; variant?: 'default' | 'compact' }) {
  if (!count || count <= 0) return null;
  if (variant === 'compact') {
    return (
      <View style={liveSt.compact}>
        <PulseDot />
        <Text style={liveSt.compactTxt}>{count}</Text>
      </View>
    );
  }
  return (
    <View style={liveSt.badge}>
      <PulseDot />
      <Text style={liveSt.badgeTxt}>{count} membre{count > 1 ? 's' : ''}</Text>
    </View>
  );
}
const liveSt = StyleSheet.create({
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(0,230,118,0.12)',
    borderRadius: 12, paddingHorizontal: 9, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.28)',
  },
  badgeTxt: { fontSize: 11, fontWeight: '700', color: '#00E676' },
  compact: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(0,230,118,0.35)',
  },
  compactTxt: { fontSize: 11, fontWeight: '800', color: '#00E676' },
});

// ── Skeleton (minimal) ──────────────────────────────────────
function Skeleton({ w, h, radius = 10 }: { w: number | string; h: number; radius?: number }) {
  return <View style={{ width: w as any, height: h, borderRadius: radius, backgroundColor: Colors.card }} />;
}
function SkeletonScreen() {
  return (
    <ScrollView style={{ flex: 1 }} scrollEnabled={false} contentContainerStyle={{ paddingTop: 16, gap: 24 }}>
      <Skeleton w={SW - 32} h={HERO_H} radius={20} />
      <View style={{ paddingHorizontal: 16, gap: 12 }}>
        <Skeleton w={160} h={18} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
          {[1, 2, 3].map(i => <Skeleton key={i} w={SVC_CARD_W} h={SVC_CARD_H} radius={16} />)}
        </ScrollView>
      </View>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <Skeleton w={160} h={18} />
        {[1, 2, 3, 4].map(i => (
          <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
            <Skeleton w={72} h={64} radius={12} />
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton w="75%" h={14} />
              <Skeleton w="50%" h={11} />
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Hero Card (pleine largeur) ──────────────────────────────
function HeroCard({ point, onPress, liveCount }: { point: any; onPress: () => void; liveCount?: number }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  const tag = point.tags?.[0];
  const votes = (point.upvotes ?? 0) - (point.downvotes ?? 0);
  const count = liveCount ?? point.participants_count ?? 0;
  return (
    <TouchableOpacity style={[heroSt.card, { width: SW - 32 }]} onPress={onPress} activeOpacity={0.94} testID={`hero-card-${point.point_id}`}>
      {point.images?.[0]
        ? <Image source={{ uri: point.images[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name={icon} size={80} color="rgba(255,255,255,0.1)" />
          </View>
      }
      {/* Gradient bottom */}
      <View style={heroSt.gradient} />
      {/* Tag chip top-left */}
      {tag && (
        <View style={heroSt.tagChip}>
          <Text style={heroSt.tagText}>{tag.label_fr || tag.label_en || ''}</Text>
        </View>
      )}
      {/* Votes top-right — seulement si > 0 */}
      {(votes !== 0) && (
        <View style={heroSt.voteBadge}>
          <Ionicons name={votes > 0 ? 'arrow-up' : 'arrow-down'} size={10} color={votes > 0 ? Colors.primary : '#ff4444'} />
          <Text style={[heroSt.voteText, { color: votes > 0 ? Colors.primary : '#ff4444' }]}>{votes > 0 ? '+' : ''}{votes}</Text>
        </View>
      )}
      {/* Live membres badge — coin inférieur droit */}
      {count > 0 && (
        <View style={heroSt.liveBadgeWrap}>
          <LiveBadge count={count} variant="compact" />
        </View>
      )}
      {/* Bottom info */}
      <View style={heroSt.bottom}>
        <Text style={heroSt.title} numberOfLines={2}>{point.title}</Text>
        <View style={heroSt.meta}>
          {point.owner && (
            <View style={heroSt.ownerRow}>
              <View style={heroSt.avatar}>
                {point.owner.picture
                  ? <Image source={{ uri: point.owner.picture }} style={{ width: '100%', height: '100%' }} />
                  : <Text style={heroSt.avatarTxt}>{point.owner.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                }
              </View>
              <Text style={heroSt.ownerName}>{point.owner.name}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}
const heroSt = StyleSheet.create({
  card: { height: HERO_H, borderRadius: 20, overflow: 'hidden', backgroundColor: Colors.card },
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '30%', backgroundColor: 'rgba(13,17,23,0.88)' },
  tagChip: { position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(29,191,115,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(29,191,115,0.4)' },
  tagText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  voteBadge: { position: 'absolute', top: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(13,17,23,0.7)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  voteText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  liveBadgeWrap: { position: 'absolute', bottom: 72, right: 14 },
  bottom: { position: 'absolute', bottom: 16, left: 16, right: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: -0.5, marginBottom: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  avatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 11, fontWeight: '800', color: '#0D1117' },
  ownerName: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.85)' },
});

// ── Service Card (landscape compact) ───────────────────────
function ServiceCard({ svc, userLat, userLng, onPress }: { svc: any; userLat: number; userLng: number; onPress: () => void }) {
  const loc = svc.locations?.[0];
  const dist = loc ? formatDistance(haversineDistance(userLat, userLng, loc.latitude, loc.longitude)) : '';
  const image = svc.images?.[0];
  const slotCount = svc.slots?.length ?? 0;
  return (
    <TouchableOpacity style={svcSt.card} onPress={onPress} activeOpacity={0.9}>
      {/* Image left */}
      <View style={svcSt.imgWrap}>
        {image
          ? <Image source={{ uri: image }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#2A1500', alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name="calendar-outline" size={32} color="rgba(255,149,0,0.25)" />
            </View>
        }
        <View style={svcSt.imgOverlay} />
        <View style={svcSt.badge}><Text style={svcSt.badgeTxt}>SERVICE</Text></View>
      </View>
      {/* Info right */}
      <View style={svcSt.info}>
        <Text style={svcSt.title} numberOfLines={2}>{svc.title}</Text>
        <View style={svcSt.coachRow}>
          <View style={svcSt.coachAvatar}>
            {svc.coach?.picture
              ? <Image source={{ uri: svc.coach.picture }} style={{ width: '100%', height: '100%' }} />
              : <Text style={svcSt.coachAvatarTxt}>{svc.coach?.name?.charAt(0)?.toUpperCase() || 'C'}</Text>
            }
          </View>
          <Text style={svcSt.coachName} numberOfLines={1}>{svc.coach?.name || 'Coach'}</Text>
        </View>
        <View style={svcSt.bottom}>
          <Text style={svcSt.price}>À partir de {svc.price}€</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            {dist ? (
              <View style={svcSt.distChip}>
                <Ionicons name="navigate-outline" size={10} color={Colors.muted} />
                <Text style={svcSt.distTxt}>{dist}</Text>
              </View>
            ) : null}
            {slotCount > 0 && (
              <View style={svcSt.slotChip}>
                <Ionicons name="time-outline" size={10} color={ORANGE} />
                <Text style={svcSt.slotTxt}>{slotCount} créneaux</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}
const svcSt = StyleSheet.create({
  card: { width: SVC_CARD_W, height: SVC_CARD_H, flexDirection: 'row', borderRadius: 16, overflow: 'hidden', backgroundColor: Colors.card, borderWidth: 1.5, borderColor: 'rgba(255,149,0,0.3)' },
  imgWrap: { width: 100, position: 'relative' },
  imgOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  badge: { position: 'absolute', top: 8, left: 8, backgroundColor: ORANGE, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  badgeTxt: { fontSize: 8, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  info: { flex: 1, padding: 12, justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: '700', color: Colors.foreground, lineHeight: 18 },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coachAvatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: ORANGE, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  coachAvatarTxt: { fontSize: 9, fontWeight: '800', color: '#fff' },
  coachName: { fontSize: 11, color: Colors.muted, flex: 1 },
  bottom: {},
  price: { fontSize: 14, fontWeight: '800', color: ORANGE },
  distChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.backgroundSecondary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  distTxt: { fontSize: 10, color: Colors.muted },
  slotChip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: ORANGE_DIM, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  slotTxt: { fontSize: 10, color: ORANGE, fontWeight: '600' },
});

// ── Recent Row (vertical feed) ──────────────────────────────
function RecentRow({ point, userLat, userLng, onPress, liveCount }: { point: any; userLat: number; userLng: number; onPress: () => void; liveCount?: number }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  const dist = distPipe(userLat, userLng, point);
  const votes = (point.upvotes ?? 0) - (point.downvotes ?? 0);
  const tag = point.tags?.[0];
  const count = liveCount ?? point.participants_count ?? 0;
  return (
    <TouchableOpacity style={recSt.row} onPress={onPress} activeOpacity={0.82} testID={`recent-row-${point.point_id}`}>
      {/* Thumb */}
      <View style={recSt.thumb}>
        {point.images?.[0]
          ? <Image source={{ uri: point.images[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name={icon} size={22} color="rgba(255,255,255,0.4)" />
            </View>
        }
        {/* Badge membres en direct sur la miniature */}
        {count > 0 && (
          <View style={recSt.livePill}>
            <PulseDot />
            <Text style={recSt.livePillTxt}>{count}</Text>
          </View>
        )}
      </View>
      {/* Info */}
      <View style={recSt.info}>
        <Text style={recSt.title} numberOfLines={1}>{point.title}</Text>
        <View style={recSt.sub}>
          {tag && <Text style={recSt.tag}>{tag.label_fr || ''}</Text>}
          {tag && point.owner && <View style={recSt.sep} />}
          {point.owner && <Text style={recSt.owner} numberOfLines={1}>{point.owner.name}</Text>}
        </View>
      </View>
      {/* Right: dist + votes */}
      <View style={recSt.right}>
        {dist ? <Text style={recSt.dist}>{dist}</Text> : null}
        {votes !== 0 && (
          <View style={recSt.voteRow}>
            <Ionicons name={votes > 0 ? 'arrow-up' : 'arrow-down'} size={10} color={votes > 0 ? Colors.primary : '#ff4444'} />
            <Text style={[recSt.votes, { color: votes > 0 ? Colors.primary : '#ff4444' }]}>{votes > 0 ? '+' : ''}{votes}</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
const recSt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  thumb: { width: 72, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.card },
  livePill: { position: 'absolute', bottom: 4, left: 4, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2 },
  livePillTxt: { fontSize: 10, fontWeight: '800', color: '#00E676' },
  info: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  sub: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 },
  tag: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  sep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.border },
  owner: { fontSize: 11, color: Colors.muted, flex: 1 },
  right: { alignItems: 'flex-end', gap: 4, minWidth: 46 },
  dist: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  voteRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  votes: { fontSize: 11, fontWeight: '700' },
});

// ── Main Screen ──────────────────────────────────────────────
export default function HomeScreen() {
  const router = useGuardedRouter();
  const { t } = useLang();
  const { user } = useAuth();
  const { location, loading: locLoading, setLocation } = useLocation();
  const [screenState, setScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [SpotYou, setSpotYou] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [activityFeed, setActivityFeed] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  // Métadonnées fil personnalisé
  const [isExpanded, setIsExpanded] = useState(false);
  const [actualRadiusKm, setActualRadiusKm] = useState(50);
  const [hasPersonalization, setHasPersonalization] = useState(false);

  // Secteur le plus proche (affiché quand écran vide)
  const [nearestSector, setNearestSector] = useState<{
    lat: number; lng: number; distance_km: number; spot_count: number; city_name: string;
  } | null>(null);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [teleporting, setTeleporting] = useState(false);

  const [heroIndex, setHeroIndex] = useState(0);
  const carouselRef = useRef<FlatList>(null);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Indicateur membres temps réel (via hook centralisé, cap à 10 pour la map) ──
  const [liveCountsMap, setLiveCountsMap] = useState<Record<string, number>>({});

  useSpotYouListLive(SpotYou, (pid, update) => {
    if (update.participants_count !== undefined) {
      setLiveCountsMap(prev => ({ ...prev, [pid]: update.participants_count! }));
    }
  }, 10);

  useEffect(() => {
    if (!locLoading) loadData();
  }, [location.lat, location.lng, locLoading]);

  useEffect(() => {
    if (user) loadActivity();
  }, [user]);

  // Enregistrement pour le refresh progressif au retour réseau (priorité max = écran actif)
  useEffect(() => {
    return registerScreenRefresh('home', () => loadData(true), 10);
  }, [location.lat, location.lng]);

  // Auto-scroll
  useEffect(() => {
    const heroes = SpotYou.slice(0, 5);
    if (heroes.length < 2) return;
    autoTimer.current = setInterval(() => {
      setHeroIndex(prev => {
        const next = (prev + 1) % heroes.length;
        carouselRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 4000);
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [SpotYou]);

  const loadData = async (isRefresh = false) => {
    const latStr = String(location.lat);
    const lngStr = String(location.lng);
    const userId = user?.user_id;

    const feedKey = buildCacheKey({ path: '/home/feed', params: { lat: latStr, lng: lngStr }, userId, schemaVersion: SCHEMA_VERSION });
    const feedTtl = 5; // minutes

    // ── 1. Cache immédiat sur premier chargement ──────────────────────────────
    if (!isRefresh) {
      const cached = await cacheGet(feedKey);
      if (cached) {
        const feed = cached.data as any;
        setSpotYou(feed.spotyou || []);
        setServices(feed.services || []);
        setIsExpanded(feed.is_expanded || false);
        setActualRadiusKm(feed.actual_radius_km || 50);
        setHasPersonalization(feed.has_personalization || false);
        if (isFresh(cached)) {
          setScreenState('ready_fresh');
          setStaleMinutes(null);
          return;
        }
        setScreenState('ready_cached');
        setStaleMinutes(cacheAgeMinutes(cached));
        // Continuer pour rafraîchir en arrière-plan
      }
    }

    if (isRefresh) setRefreshing(true);

    // ── 2. Fetch réseau ───────────────────────────────────────────────────────
    try {
      const feed = await api.get(`/home/feed?lat=${location.lat}&lng=${location.lng}`);
      setSpotYou(Array.isArray(feed.spotyou) ? feed.spotyou : []);
      setServices(Array.isArray(feed.services) ? feed.services : []);
      setIsExpanded(feed.is_expanded || false);
      setActualRadiusKm(feed.actual_radius_km || 50);
      setHasPersonalization(feed.has_personalization || false);
      await cacheSet(feedKey, feed, feedTtl);
      setScreenState('ready_fresh');
      setStaleMinutes(null);
    } catch {
      if (SpotYou.length === 0 && services.length === 0) {
        setScreenState('error_no_data');
      }
    } finally {
      setRefreshing(false);
    }
  };

  const loadActivity = async () => {
    setActivityLoading(true);
    try {
      const data = await api.get('/users/me/activity-feed');
      setActivityFeed(data.activities || []);
    } catch {
      // Silencieux
    } finally {
      setActivityLoading(false);
    }
  };

  const onRefresh = useCallback(() => {
    loadData(true);
    if (user) loadActivity();
  }, [location.lat, location.lng, user]);

  // Fetcher le secteur le plus proche quand l'écran est vide
  useEffect(() => {
    const isEmpty = SpotYou.length === 0 && services.length === 0;
    const isReady = screenState === 'ready_fresh' || screenState === 'ready_cached' || screenState === 'error_no_data';
    if (isEmpty && isReady && !nearestLoading && !nearestSector) {
      fetchNearestSector();
    }
    // Si on a trouvé du contenu, réinitialiser le secteur proche
    if (!isEmpty) {
      setNearestSector(null);
    }
  }, [SpotYou.length, services.length, screenState]);

  const fetchNearestSector = async () => {
    setNearestLoading(true);
    try {
      const data = await api.get(
        `/home/nearest-sector?lat=${location.lat}&lng=${location.lng}`
      );
      if (data && data.lat !== undefined) {
        // Utiliser getCityFromCoords pour avoir le vrai nom de ville (pas de code Plus)
        const city_name = await getCityFromCoords(data.lat, data.lng);
        setNearestSector({ ...data, city_name });
      }
    } catch {}
    setNearestLoading(false);
  };

  const handleTeleport = async () => {
    if (!nearestSector || teleporting) return;
    setTeleporting(true);
    await setLocation({
      lat: nearestSector.lat,
      lng: nearestSector.lng,
      address: nearestSector.city_name,
      isGPS: false,
    });
    setNearestSector(null);
    setTeleporting(false);
    // loadData sera déclenché par le useEffect([location.lat, location.lng])
  };

  const isLoading = screenState === 'loading_initial';
  const isStale = screenState === 'ready_cached';

  const relativeTime = (iso: string): string => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)     return 'à l\'instant';
    if (diff < 3600)   return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400)  return `il y a ${Math.floor(diff / 3600)}h`;
    if (diff < 172800) return 'hier';
    if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  const heroPoints = SpotYou.slice(0, 5);
  const recentPoints = [...SpotYou]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* ── Header ── */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.background }}>
        <View style={hdrSt.wrap}>
          {/* Left: greeting */}
          <View style={{ flex: 1 }}>
            <Text style={hdrSt.greet}>{greeting()}{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋</Text>
            <TouchableOpacity style={hdrSt.locRow} onPress={() => router.push('/set-location' as any)}>
              <Ionicons name="location" size={13} color={Colors.primary} />
              <Text style={hdrSt.locTxt} numberOfLines={1}>{location.address || 'Paris, France'}</Text>
              <Ionicons name="chevron-down" size={12} color={Colors.muted} />
            </TouchableOpacity>
          </View>
          {/* Right: search */}
          <TouchableOpacity style={hdrSt.searchBtn} onPress={() => router.push('/(tabs)/search' as any)} testID="header-search-btn">
            <Ionicons name="search" size={20} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* ── Bannière stale ── */}
      {isStale && <StaleBanner staleMinutes={staleMinutes} />}

      {isLoading ? <SkeletonScreen /> : screenState === 'error_no_data' ? (
        // ── Aucun SpotYou nulle part → inviter à créer ───────────────────────
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          <View style={ctaSt.wrap}>
            <Ionicons name="map-outline" size={52} color={Colors.primary} style={{ marginBottom: 16 }} />
            <Text style={ctaSt.headline}>Intégrez votre secteur{'\n'}dans l'univers SpotU</Text>
            <Text style={ctaSt.sub}>Aucun SpotYou n'existe encore près de chez vous.{'\n'}Soyez le premier à en créer un !</Text>
            <TouchableOpacity style={ctaSt.btn} onPress={() => router.push('/(tabs)/map' as any)} testID="create-spotyou-cta">
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={ctaSt.btnTxt}>Créer un SpotYou</Text>
            </TouchableOpacity>

            {/* Secteur le plus proche */}
            {nearestLoading && (
              <View style={nearSt.loadingWrap}>
                <ActivityIndicator size="small" color={Colors.muted} />
                <Text style={nearSt.loadingTxt}>Recherche du secteur le plus proche…</Text>
              </View>
            )}
            {nearestSector && !nearestLoading && (
              <View style={nearSt.card}>
                <View style={nearSt.header}>
                  <Ionicons name="compass-outline" size={16} color={Colors.primary} />
                  <Text style={nearSt.headerTxt}>Secteur le plus proche</Text>
                </View>
                <Text style={nearSt.city}>{nearestSector.city_name}</Text>
                <View style={nearSt.meta}>
                  <View style={nearSt.metaChip}>
                    <Ionicons name="location-outline" size={12} color={Colors.muted} />
                    <Text style={nearSt.metaTxt}>
                      {nearestSector.distance_km < 1 ? `< 1 km` : `~${Math.round(nearestSector.distance_km)} km`}
                    </Text>
                  </View>
                  <View style={nearSt.metaChip}>
                    <Ionicons name="people-outline" size={12} color={Colors.muted} />
                    <Text style={nearSt.metaTxt}>{nearestSector.spot_count} SpotYou</Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={nearSt.btn}
                  onPress={handleTeleport}
                  disabled={teleporting}
                  testID="explore-nearest-sector-cta-btn"
                >
                  {teleporting
                    ? <ActivityIndicator size="small" color={Colors.background} />
                    : <Ionicons name="navigate" size={16} color={Colors.background} />
                  }
                  <Text style={nearSt.btnTxt}>
                    {teleporting ? 'Chargement…' : `Explorer ${nearestSector.city_name}`}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={ctaSt.hint}>Un SpotYou, c'est votre espace de rencontre sportif : running club, yoga en plein air, séance crossfit…</Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >

          {/* ── Bannière : contenu étendu au-delà du secteur ────────────── */}
          {isExpanded && (
            <View style={expandSt.banner}>
              <Ionicons name="compass-outline" size={15} color={Colors.primary} />
              <Text style={expandSt.txt}>
                Rien dans votre secteur — suggestions à {actualRadiusKm < 1000 ? `${actualRadiusKm} km` : 'plus de 200 km'}
              </Text>
            </View>
          )}

          {/* ── Section 1 : Hero Carousel ── */}
          {heroPoints.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <View style={[secSt.header, { paddingHorizontal: 16, marginBottom: 8 }]}>
                <View>
                  <Text style={secSt.title}>{hasPersonalization ? 'Pour vous' : 'Près de vous'}</Text>
                  <Text style={secSt.sub}>{heroPoints.length} SpotYou {isExpanded ? `à ~${actualRadiusKm}km` : 'dans votre secteur'}</Text>
                </View>
              </View>
              <FlatList
                ref={carouselRef}
                data={heroPoints}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={i => i.point_id}
                renderItem={({ item }) => (
                  <HeroCard point={item} onPress={() => router.push(`/spot-you/${item.point_id}` as any)} liveCount={liveCountsMap[item.point_id]} />
                )}
                onMomentumScrollEnd={e => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / (SW - 32 + 12));
                  setHeroIndex(idx);
                  if (autoTimer.current) clearInterval(autoTimer.current);
                }}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
                snapToInterval={SW - 32 + 12}
                decelerationRate="fast"
                getItemLayout={(_, i) => ({ length: SW - 32 + 12, offset: (SW - 32 + 12) * i, index: i })}
              />
              {heroPoints.length > 1 && (
                <View style={dotSt.wrap}>
                  {heroPoints.map((_, i) => (
                    <View key={i} style={[dotSt.dot, i === heroIndex && dotSt.active]} />
                  ))}
                </View>
              )}
            </View>
          )}

          {/* ── Section 2 : Coachs & Services ── */}
          {services.length > 0 && (
            <View style={{ marginTop: 28 }}>
              <View style={secSt.header}>
                <View>
                  <Text style={secSt.title}>Coachs & Services</Text>
                  <Text style={secSt.sub}>{services.length} disponible{services.length > 1 ? 's' : ''} près de vous</Text>
                </View>
                <TouchableOpacity onPress={() => router.push('/(tabs)/search' as any)}>
                  <Text style={secSt.seeAll}>Voir tout</Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={services}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyExtractor={i => i.service_id}
                renderItem={({ item }) => (
                  <ServiceCard
                    svc={item}
                    userLat={location.lat}
                    userLng={location.lng}
                    onPress={() => router.push(`/service/${item.service_id}` as any)}
                  />
                )}
                contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
              />
            </View>
          )}

          {/* ── Section 3 : Activité récente (membres uniquement) ── */}
          {user && activityFeed.length > 0 && (
            <View style={{ marginTop: 28 }}>
              <View style={[secSt.header]}>
                <View>
                  <Text style={secSt.title}>Activité récente</Text>
                  <Text style={secSt.sub}>Vos communautés SpotYou</Text>
                </View>
                {activityLoading && <ActivityIndicator size="small" color={Colors.primary} />}
              </View>
              <View style={actSt.card}>
                <ScrollView
                  scrollEnabled={activityFeed.length > 4}
                  style={{ maxHeight: activityFeed.length > 4 ? 240 : undefined }}
                  showsVerticalScrollIndicator={activityFeed.length > 4}
                  nestedScrollEnabled
                >
                {activityFeed.map((item, idx) => (
                  <TouchableOpacity
                    key={`${item.user_id}-${item.type}-${item.spot_you_id}-${item.session_date || idx}`}
                    style={[actSt.row, idx < activityFeed.length - 1 && actSt.rowBorder]}
                    onPress={() => router.push(`/spot-you/${item.spot_you_id}` as any)}
                    activeOpacity={0.75}
                    testID={`activity-item-${idx}`}
                  >
                    {/* Avatar */}
                    <View style={actSt.avatarWrap}>
                      {item.picture
                        ? <Image source={{ uri: item.picture }} style={actSt.avatar} />
                        : <View style={[actSt.avatar, actSt.avatarFallback]}>
                            <Text style={actSt.avatarInitial}>{(item.name || '?')[0].toUpperCase()}</Text>
                          </View>
                      }
                      <View style={[actSt.typeIcon, item.type === 'going' ? actSt.typeIconGoing : actSt.typeIconJoined]}>
                        <Ionicons
                          name={item.type === 'going' ? 'calendar-outline' : 'person-add-outline'}
                          size={8}
                          color="#fff"
                        />
                      </View>
                    </View>

                    {/* Texte */}
                    <View style={actSt.content}>
                      <Text style={actSt.text} numberOfLines={1}>
                        <Text style={actSt.name}>{item.name?.split(' ')[0] ?? 'Quelqu\'un'}</Text>
                        {'  '}{item.action_text}
                      </Text>
                      {/* SpotYou name badge */}
                      <View style={actSt.spotRow}>
                        <View style={actSt.spotBadge}>
                          <Ionicons name="location-outline" size={9} color={Colors.primary} />
                          <Text style={actSt.spotName} numberOfLines={1}>{item.spot_you_title}</Text>
                        </View>
                      </View>
                    </View>

                    {/* Timestamp */}
                    <Text style={actSt.time}>{relativeTime(item.timestamp)}</Text>
                  </TouchableOpacity>
                ))}
                </ScrollView>
              </View>
            </View>
          )}

          {/* ── Section 4 : Feed récents ── */}
          {recentPoints.length > 0 && (
            <View style={{ marginTop: 28, paddingHorizontal: 16, marginBottom: 24 }}>
              <View style={[secSt.header, { paddingHorizontal: 0 }]}>
                <View>
                  <Text style={secSt.title}>Derniers ajouts</Text>
                  <Text style={secSt.sub}>{SpotYou.length} SpotYou{SpotYou.length > 1 ? 's' : ''} près de vous</Text>
                </View>
                <TouchableOpacity onPress={() => router.push('/(tabs)/search' as any)}>
                  <Text style={secSt.seeAll}>Voir tout</Text>
                </TouchableOpacity>
              </View>
              {recentPoints.map(pt => (
                <RecentRow
                  key={pt.point_id}
                  point={pt}
                  userLat={location.lat}
                  userLng={location.lng}
                  onPress={() => router.push(`/spot-you/${pt.point_id}` as any)}
                  liveCount={liveCountsMap[pt.point_id]}
                />
              ))}
            </View>
          )}

          {/* Empty state */}
          {SpotYou.length === 0 && services.length === 0 && (
            <View style={emptySt.wrap}>
              <Ionicons name="location-outline" size={56} color={Colors.muted} />
              <Text style={emptySt.title}>Aucun contenu trouvé</Text>
              <Text style={emptySt.desc}>Sois le premier à créer un SpotYou près de toi !</Text>
              <TouchableOpacity style={emptySt.btn} onPress={() => router.push('/(tabs)/create' as any)} testID="create-spotyou-empty-btn">
                <Ionicons name="add" size={18} color={Colors.background} />
                <Text style={emptySt.btnTxt}>Créer un SpotYou</Text>
              </TouchableOpacity>

              {/* Secteur le plus proche */}
              {nearestLoading && (
                <View style={nearSt.loadingWrap}>
                  <ActivityIndicator size="small" color={Colors.muted} />
                  <Text style={nearSt.loadingTxt}>Recherche du secteur le plus proche…</Text>
                </View>
              )}
              {nearestSector && !nearestLoading && (
                <View style={nearSt.card}>
                  <View style={nearSt.header}>
                    <Ionicons name="compass-outline" size={16} color={Colors.primary} />
                    <Text style={nearSt.headerTxt}>Secteur le plus proche</Text>
                  </View>
                  <Text style={nearSt.city}>{nearestSector.city_name}</Text>
                  <View style={nearSt.meta}>
                    <View style={nearSt.metaChip}>
                      <Ionicons name="location-outline" size={12} color={Colors.muted} />
                      <Text style={nearSt.metaTxt}>
                        {nearestSector.distance_km < 1
                          ? `< 1 km`
                          : `~${Math.round(nearestSector.distance_km)} km`}
                      </Text>
                    </View>
                    <View style={nearSt.metaChip}>
                      <Ionicons name="people-outline" size={12} color={Colors.muted} />
                      <Text style={nearSt.metaTxt}>
                        {nearestSector.spot_count} SpotYou
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={nearSt.btn}
                    onPress={handleTeleport}
                    disabled={teleporting}
                    testID="explore-nearest-sector-btn"
                  >
                    {teleporting
                      ? <ActivityIndicator size="small" color={Colors.background} />
                      : <Ionicons name="navigate" size={16} color={Colors.background} />
                    }
                    <Text style={nearSt.btnTxt}>
                      {teleporting ? 'Chargement…' : `Explorer ${nearestSector.city_name}`}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          <View style={{ height: 16 }} />
        </ScrollView>
      )}
    </View>
  );
}

// ── StyleSheets ──────────────────────────────────────────────
const hdrSt = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  greet: { fontSize: 16, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  locTxt: { fontSize: 12, color: Colors.muted, fontWeight: '500' },
  searchBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
});

const dotSt = StyleSheet.create({
  wrap: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  active: { backgroundColor: Colors.primary, width: 20, borderRadius: 3 },
});

const secSt = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 16, marginBottom: 14 },
  title: { fontSize: 18, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  sub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  seeAll: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
});

const emptySt = StyleSheet.create({
  wrap: { alignItems: 'center', padding: 48, gap: 16 },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  desc: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 100, marginTop: 8 },
  btnTxt: { fontSize: 15, fontWeight: '700', color: Colors.background },
});

// Legacy styles stub (pour éviter les erreurs si d'autres imports existent)
const styles = StyleSheet.create({
  safeHeader: {}, header: {}, headerLeft: {}, headerTitle: {}, headerRight: {}, headerBtn: {},
  carouselWrap: {}, heroCard: {}, heroImage: {}, heroOverlay: {}, heroText: {}, heroTitle: {}, heroSub: {},
  dots: {}, dot: {}, dotActive: {}, section: {}, sectionHeader: {}, sectionTitle: {}, seeAll: {},
  nearbyCard: {}, nearbyImage: {}, nearbyOverlay: {}, nearbyTop: {}, nearbyTitle: {}, nearbySub: {},
  nearbyBottom: {}, ownerRow: {}, ownerAvatar: {}, ownerName: {}, nearbyDist: {},
  listCard: {}, listThumb: {}, listInfo: {}, listTitle: {}, listDesc: {}, listOwner: {}, listDist: {},
  empty: {}, emptyTitle: {}, emptyDesc: {}, createBtn: {}, createBtnText: {},
});

const actSt = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 12,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border + '50' },
  avatarWrap: { position: 'relative', width: 38, height: 38, flexShrink: 0 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.border },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '20' },
  avatarInitial: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  typeIcon: {
    position: 'absolute', bottom: -2, right: -2,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: Colors.card,
  },
  typeIconGoing: { backgroundColor: Colors.primary },
  typeIconJoined: { backgroundColor: '#10B981' },
  content: { flex: 1, minWidth: 0 },
  text: { fontSize: 13, color: Colors.foreground, lineHeight: 17 },
  name: { fontWeight: '700' },
  spotRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  spotBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 20,
  },
  spotName: { fontSize: 11, color: Colors.primary, fontWeight: '600', flexShrink: 1 },
  time: { fontSize: 11, color: Colors.muted, flexShrink: 0 },
});

const expandSt = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    backgroundColor: Colors.primary + '12',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: Colors.primary + '25',
  },
  txt: { fontSize: 13, color: Colors.primary, fontWeight: '600', flex: 1 },
});

const ctaSt = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 14 },
  headline: {
    fontSize: 22, fontWeight: '800', color: Colors.foreground,
    textAlign: 'center', letterSpacing: -0.5, lineHeight: 30,
  },
  sub: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 21 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 100, marginTop: 4,
  },
  btnTxt: { fontSize: 15, fontWeight: '700', color: '#fff' },
  hint: {
    fontSize: 12, color: Colors.muted, textAlign: 'center',
    lineHeight: 18, fontStyle: 'italic', maxWidth: 280,
  },
});

const nearSt = StyleSheet.create({
  loadingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8,
  },
  loadingTxt: { fontSize: 12, color: Colors.muted },
  card: {
    width: '100%', marginTop: 12,
    backgroundColor: Colors.card,
    borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: Colors.primary + '30',
    alignItems: 'center', gap: 8,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  headerTxt: { fontSize: 12, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  city: {
    fontSize: 22, fontWeight: '800', color: Colors.foreground,
    letterSpacing: -0.5, textAlign: 'center',
  },
  meta: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4,
  },
  metaTxt: { fontSize: 12, color: Colors.muted, fontWeight: '600' },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary,
    paddingHorizontal: 22, paddingVertical: 12,
    borderRadius: 100, marginTop: 4,
  },
  btnTxt: { fontSize: 14, fontWeight: '700', color: Colors.background },
});

