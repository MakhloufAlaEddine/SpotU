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
import { useAuth } from '../../context/AuthContext';
import { haversineDistance, formatDistance } from '../../utils/distance';

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
function HeroCard({ point, onPress }: { point: any; onPress: () => void }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  const tag = point.tags?.[0];
  const votes = (point.upvotes ?? 0) - (point.downvotes ?? 0);
  return (
    <TouchableOpacity style={[heroSt.card, { width: SW - 32 }]} onPress={onPress} activeOpacity={0.94}>
      {point.image_url
        ? <Image source={{ uri: point.image_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
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
  gradient: { position: 'absolute', bottom: 0, left: 0, right: 0, height: '65%', backgroundColor: 'rgba(13,17,23,0.82)' },
  tagChip: { position: 'absolute', top: 14, left: 14, backgroundColor: 'rgba(29,191,115,0.18)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(29,191,115,0.4)' },
  tagText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
  voteBadge: { position: 'absolute', top: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(13,17,23,0.7)', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4 },
  voteText: { fontSize: 11, fontWeight: '700', color: Colors.primary },
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
function RecentRow({ point, userLat, userLng, onPress }: { point: any; userLat: number; userLng: number; onPress: () => void }) {
  const bg = DOMAIN_COLORS[point.domain_id] || '#1A3A3A';
  const icon = DOMAIN_ICONS[point.domain_id] || 'location-outline';
  const dist = distPipe(userLat, userLng, point);
  const votes = (point.upvotes ?? 0) - (point.downvotes ?? 0);
  const tag = point.tags?.[0];
  return (
    <TouchableOpacity style={recSt.row} onPress={onPress} activeOpacity={0.82}>
      {/* Thumb */}
      <View style={recSt.thumb}>
        {point.image_url
          ? <Image source={{ uri: point.image_url }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          : <View style={[StyleSheet.absoluteFillObject, { backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }]}>
              <Ionicons name={icon} size={22} color="rgba(255,255,255,0.4)" />
            </View>
        }
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
        <View style={recSt.voteRow}>
          <Ionicons name="arrow-up" size={10} color={votes >= 0 ? Colors.primary : Colors.muted} />
          <Text style={[recSt.votes, { color: votes >= 0 ? Colors.primary : Colors.muted }]}>{votes}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
const recSt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  thumb: { width: 72, height: 64, borderRadius: 12, overflow: 'hidden', backgroundColor: Colors.card },
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
  const router = useRouter();
  const { t } = useLang();
  const { user } = useAuth();
  const { location, loading: locLoading } = useLocation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tagPoints, setTagPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  const [heroIndex, setHeroIndex] = useState(0);
  const carouselRef = useRef<FlatList>(null);
  const autoTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!locLoading) loadData();
  }, [location.lat, location.lng, locLoading]);

  // Auto-scroll
  useEffect(() => {
    const heroes = tagPoints.slice(0, 5);
    if (heroes.length < 2) return;
    autoTimer.current = setInterval(() => {
      setHeroIndex(prev => {
        const next = (prev + 1) % heroes.length;
        carouselRef.current?.scrollToIndex({ index: next, animated: true });
        return next;
      });
    }, 4000);
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [tagPoints]);

  const loadData = async () => {
    try {
      const [nearby, svcs] = await Promise.all([
        api.get(`/tag-points?lat=${location.lat}&lng=${location.lng}&radius=50000`).catch(() => []),
        api.get(`/services?lat=${location.lat}&lng=${location.lng}&radius=50000`).catch(() => []),
      ]);
      setTagPoints(Array.isArray(nearby) ? nearby : []);
      setServices(Array.isArray(svcs) ? svcs : []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [location.lat, location.lng]);

  const heroPoints = tagPoints.slice(0, 5);
  const recentPoints = [...tagPoints]
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
          <TouchableOpacity style={hdrSt.searchBtn} onPress={() => router.push('/(tabs)/search' as any)}>
            <Ionicons name="search" size={20} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {loading ? <SkeletonScreen /> : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >

          {/* ── Section 1 : Hero Carousel ── */}
          {heroPoints.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <FlatList
                ref={carouselRef}
                data={heroPoints}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={i => i.point_id}
                renderItem={({ item }) => (
                  <HeroCard point={item} onPress={() => router.push(`/tag-point/${item.point_id}` as any)} />
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

          {/* ── Section 3 : Feed récents ── */}
          {recentPoints.length > 0 && (
            <View style={{ marginTop: 28, paddingHorizontal: 16, marginBottom: 24 }}>
              <View style={[secSt.header, { paddingHorizontal: 0 }]}>
                <View>
                  <Text style={secSt.title}>Derniers ajouts</Text>
                  <Text style={secSt.sub}>{tagPoints.length} TagPoint{tagPoints.length > 1 ? 's' : ''} près de vous</Text>
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
                  onPress={() => router.push(`/tag-point/${pt.point_id}` as any)}
                />
              ))}
            </View>
          )}

          {/* Empty state */}
          {tagPoints.length === 0 && services.length === 0 && (
            <View style={emptySt.wrap}>
              <Ionicons name="location-outline" size={56} color={Colors.muted} />
              <Text style={emptySt.title}>Aucun contenu trouvé</Text>
              <Text style={emptySt.desc}>Sois le premier à créer un TagPoint près de toi !</Text>
              <TouchableOpacity style={emptySt.btn} onPress={() => router.push('/(tabs)/create' as any)}>
                <Ionicons name="add" size={18} color={Colors.background} />
                <Text style={emptySt.btnTxt}>Créer un TagPoint</Text>
              </TouchableOpacity>
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

