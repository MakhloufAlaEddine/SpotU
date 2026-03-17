import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '../lib/api';
import { useLocation } from '../context/LocationContext';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { TagImage } from '../components/TagImage';
import { SpotYouCard } from '../components/SpotYouCard';
import ConfirmActionModal, { ConfirmAction } from '../components/ConfirmActionModal';
import { useNetwork } from '../hooks/useNetwork';
import { useClickSound } from '../hooks/useClickSound';
import { cacheInvalidate } from '../lib/cache';
import { useGuardedRouter } from '../hooks/useGuardedRouter';
import { useSpotYouListLive } from '../hooks/useSpotYouListLive';

import { haversineDistance, formatDistance } from '../utils/distance';

const ORANGE = '#FF9500';
const ORANGE_DIM = ORANGE + '12';
const ORANGE_BORDER = ORANGE + '30';

interface SavedService {
  service_id: string;
  title: string;
  price?: number;
  images?: string[];
  address?: string;
  duration_min?: number;
  coach?: { user_id: string; name: string; picture?: string };
  saved_at?: string;
  latitude?: number;
  longitude?: number;
  available_slots?: number;
}

function timeAgo(d?: string) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (diff < 1) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return `Il y a ${diff}j`;
  if (diff < 30) return `Il y a ${Math.floor(diff / 7)} sem`;
  return `Il y a ${Math.floor(diff / 30)} mois`;
}

function SavedServiceCard({ item, onPress, onUnsave, userLat, userLng }: { item: SavedService; onPress: () => void; onUnsave: () => void; userLat?: number; userLng?: number }) {
  const img = item.images?.[0];
  const slots = item.available_slots || 0;

  const dist = (() => {
    if (userLat == null || userLng == null) return '';
    if (item.latitude == null || item.longitude == null) return '';
    return formatDistance(haversineDistance(userLat, userLng, item.latitude, item.longitude));
  })();

  return (
    <TouchableOpacity style={svc.card} onPress={onPress} activeOpacity={0.9} testID={`saved-svc-${item.service_id}`}>
      {/* Header: thumbnail + info */}
      <View style={svc.cardHeader}>
        <View style={svc.thumbWrap}>
          {img
            ? <TagImage uri={img} domainId="dom_service" style={svc.thumb} iconSize={24} />
            : <View style={[svc.thumb, svc.thumbPlaceholder]}>
                <Ionicons name="briefcase-outline" size={24} color={ORANGE + '40'} />
              </View>
          }
        </View>

        <View style={{ flex: 1 }}>
          {/* Titre + badge SERVICE */}
          <View style={svc.titleRow}>
            <Text style={svc.cardTitle} numberOfLines={2}>{item.title}</Text>
            <View style={svc.typeBadge}>
              <Ionicons name="briefcase-outline" size={10} color={ORANGE} />
              <Text style={svc.typeBadgeText}>Service</Text>
            </View>
          </View>

          {/* Prix + Coach */}
          <View style={svc.priceRow}>
            {item.price != null && (
              <Text style={svc.priceText}>À partir de {item.price}€</Text>
            )}
            {item.duration_min != null && item.duration_min > 0 && (
              <View style={svc.metaPill}>
                <Ionicons name="time-outline" size={10} color={Colors.muted} />
                <Text style={svc.metaPillText}>{item.duration_min} min</Text>
              </View>
            )}
          </View>

          {/* Badges : coach + distance + créneaux */}
          <View style={svc.metaBadgesRow}>
            {item.coach && (
              <View style={svc.coachChip}>
                <Ionicons name="person-outline" size={10} color={ORANGE} />
                <Text style={svc.coachChipText}>{item.coach.name}</Text>
              </View>
            )}
            {dist ? (
              <View style={svc.distChip}>
                <Ionicons name="navigate-outline" size={10} color={Colors.muted} />
                <Text style={svc.distChipText}>{dist}</Text>
              </View>
            ) : null}
            {slots > 0 && (
              <View style={svc.slotsChip}>
                <Ionicons name="calendar-outline" size={10} color={ORANGE} />
                <Text style={svc.slotsChipText}>{slots} créneaux</Text>
              </View>
            )}
          </View>
        </View>

        {/* Unsave */}
        <TouchableOpacity style={svc.unsaveBtn} onPress={onUnsave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`unsave-svc-btn-${item.service_id}`}>
          <Ionicons name="bookmark" size={20} color={ORANGE} />
        </TouchableOpacity>
      </View>

      {/* Footer : enregistré */}
      {item.saved_at && (
        <View style={svc.footer}>
          <View style={svc.savedChip}>
            <Ionicons name="bookmark-outline" size={11} color={Colors.muted} />
            <Text style={svc.savedText}>Enregistré {timeAgo(item.saved_at).toLowerCase()}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

const svc = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: ORANGE_BORDER,
    overflow: 'hidden',
    marginBottom: Spacing.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  thumbWrap: {},
  thumb: { width: 72, height: 72, borderRadius: Radius.md },
  thumbPlaceholder: { backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 4 },
  cardTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 19 },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderRadius: Radius.sm, paddingHorizontal: 6, paddingVertical: 3,
    borderWidth: 1, flexShrink: 0,
    backgroundColor: ORANGE_DIM, borderColor: ORANGE_BORDER,
  },
  typeBadgeText: { fontSize: 10, fontWeight: '600', color: ORANGE },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  priceText: { fontSize: 13, fontWeight: '700', color: ORANGE },
  metaPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metaPillText: { fontSize: 11, color: Colors.muted, fontWeight: '500' },
  metaBadgesRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  coachChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: ORANGE_DIM,
    borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  coachChipText: { fontSize: 11, fontWeight: '600', color: ORANGE },
  distChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.background,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  distChipText: { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  slotsChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: ORANGE_DIM,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  slotsChipText: { fontSize: 10, color: ORANGE, fontWeight: '600' },
  unsaveBtn: { alignSelf: 'flex-start', padding: 2 },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  savedChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  savedText: { fontSize: 11, color: Colors.muted, fontWeight: '500' },
});

// ── Onglets
type Tab = 'spotyou' | 'services';

export default function SavedScreen() {
  const router = useGuardedRouter();
  const { location } = useLocation();
  const { isOnline } = useNetwork();
  const { playClickSound } = useClickSound();

  const [activeTab, setActiveTab] = useState<Tab>('spotyou');
  const [SpotYou, setSpotYou] = useState<any[]>([]);
  const [services, setServices] = useState<SavedService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Modal de confirmation (Je participe)
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

  // ── Mises à jour temps réel via le hook centralisé ───────────────────────
  useSpotYouListLive(SpotYou, (pid, update) => {
    setSpotYou(prev => prev.map(p =>
      p.point_id === pid ? { ...p, ...update } : p
    ));
  });

  const load = async () => {
    try {
      const [pts, svcs] = await Promise.all([
        api.get('/tag-points/saved').catch(() => []),
        api.get('/services/saved').catch(() => []),
      ]);
      setSpotYou(Array.isArray(pts) ? pts : []);
      setServices(Array.isArray(svcs) ? svcs : []);
    } catch {
      setSpotYou([]);
      setServices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, []));

  const handleUnsavePoint = async (pointId: string) => {
    try {
      await api.delete(`/tag-points/${pointId}/unsave`);
      setSpotYou(prev => prev.filter(p => p.point_id !== pointId));
    } catch {}
  };

  const handleUnsaveService = async (serviceId: string) => {
    try {
      await api.delete(`/services/${serviceId}/unsave`);
      setServices(prev => prev.filter(s => s.service_id !== serviceId));
    } catch {}
  };

  const toggleGoing = (item: any) => {
    if (!isOnline) {
      Alert.alert(
        'Action impossible hors ligne',
        'Impossible de modifier votre participation sans connexion réseau.',
      );
      return;
    }
    playClickSound();
    if (item.is_going) {
      setConfirmAction({
        title: 'Annuler votre participation ?',
        description: 'Vous ne participerez plus à la prochaine séance.',
        icon: 'close-circle-outline',
        iconColor: Colors.muted,
        iconBg: Colors.card,
        confirmLabel: 'Annuler ma présence',
        confirmStyle: 'danger',
        cancelLabel: 'Garder ma place',
        bullets: [
          'Vous restez membre de la communauté',
          'Le coach sera informé de votre désistement',
        ],
      });
    } else {
      setConfirmAction({
        title: 'Confirmer votre présence ?',
        description: `Vous vous inscrivez à la prochaine séance «${item.title}».`,
        icon: 'calendar-number-outline',
        iconColor: Colors.primary,
        iconBg: Colors.primaryLight,
        confirmLabel: 'Je participe',
        confirmStyle: 'primary',
        bullets: [
          'Les membres seront notifiés de votre présence',
          'Vous recevrez un rappel avant la séance',
        ],
      });
    }
    setPendingCallback(() => async () => {
      setTogglingId(item.point_id);
      try {
        const res = item.is_going
          ? await api.delete(`/spot-you/${item.point_id}/going`)
          : await api.post(`/spot-you/${item.point_id}/going`, {});
        setSpotYou(prev => prev.map(p =>
          p.point_id === item.point_id
            ? { ...p, is_going: res.is_going, going_count: res.going_count ?? p.going_count, is_full: res.is_full || false }
            : p
        ));
        await cacheInvalidate(['/tag-points/saved', '/planning']);
      } catch (e: any) {
        Alert.alert('Erreur', e.message || 'Une erreur est survenue');
      } finally {
        setTogglingId(null);
      }
    });
    setConfirmVisible(true);
  };

  const totalCount = SpotYou.length + services.length;
  const items = activeTab === 'spotyou' ? SpotYou : services;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Enregistrés</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Onglets */}
      <View style={s.tabs}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'spotyou' && s.tabActive]}
          onPress={() => setActiveTab('spotyou')}
          testID="tab-spotyou"
        >
          <Text style={[s.tabText, activeTab === 'spotyou' && s.tabTextActive]}>
            SpotYou {SpotYou.length > 0 ? `(${SpotYou.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'services' && s.tabActive, activeTab === 'services' && { borderBottomColor: ORANGE }]}
          onPress={() => setActiveTab('services')}
          testID="tab-services"
        >
          <Text style={[s.tabText, activeTab === 'services' && s.tabTextActive, activeTab === 'services' && { color: ORANGE }]}>
            Services {services.length > 0 ? `(${services.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={s.center} testID="saved-empty-state">
          <View style={s.emptyIcon}>
            <Ionicons name="bookmark-outline" size={48} color={Colors.muted} />
          </View>
          <Text style={s.emptyTitle}>
            {activeTab === 'spotyou' ? 'Aucun SpotYou enregistré' : 'Aucun service enregistré'}
          </Text>
          <Text style={s.emptySubtitle}>
            Appuyez sur <Ionicons name="bookmark-outline" size={14} color={Colors.muted} /> dans un {activeTab === 'spotyou' ? 'SpotYou' : 'service'} pour le retrouver ici.
          </Text>
          <TouchableOpacity style={s.exploreBtn} onPress={() => router.push('/(tabs)/search' as any)} testID="explore-btn">
            <Text style={s.exploreBtnText}>Explorer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => (item as any).point_id || (item as any).service_id}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          renderItem={({ item }) => {
            if (activeTab === 'services') {
              const svc = item as SavedService;
              return (
                <SavedServiceCard
                  item={svc}
                  onPress={() => router.push(`/service/${svc.service_id}` as any)}
                  onUnsave={() => handleUnsaveService(svc.service_id)}
                  userLat={location.lat}
                  userLng={location.lng}
                />
              );
            }
            const pt = item as any;
            return (
              <View style={s.spotYouCardWrap} testID={`saved-card-${pt.point_id}`}>
                <SpotYouCard
                  item={pt}
                  onNavigate={id => router.push(`/spot-you/${id}` as any)}
                  onToggleGoing={toggleGoing}
                  togglingId={togglingId}
                  isLive
                  userLat={location.lat}
                  userLng={location.lng}
                />
                <TouchableOpacity
                  style={s.unsaveOverlay}
                  onPress={() => handleUnsavePoint(pt.point_id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  testID={`unsave-btn-${pt.point_id}`}
                >
                  <Ionicons name="bookmark" size={18} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            );
          }}
          ListHeaderComponent={
            <Text style={s.count} testID="saved-count">
              {items.length} {activeTab === 'spotyou' ? `SpotYou${items.length > 1 ? 's' : ''} enregistré${items.length > 1 ? 's' : ''}` : `service${items.length > 1 ? 's' : ''} enregistré${items.length > 1 ? 's' : ''}`}
            </Text>
          }
        />
      )}

      {/* Modal de confirmation */}
      <ConfirmActionModal
        visible={confirmVisible}
        action={confirmAction}
        onConfirm={() => {
          setConfirmVisible(false);
          if (pendingCallback) pendingCallback();
        }}
        onCancel={() => setConfirmVisible(false)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, backgroundColor: Colors.background },
  list: { padding: Spacing.md, paddingBottom: 40, backgroundColor: Colors.background },
  count: { fontSize: 13, color: Colors.muted, marginBottom: Spacing.md, fontWeight: '500' },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: Spacing.sm, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl },
  exploreBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm + 4,
    borderRadius: Radius.full,
  },
  exploreBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.background },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },
  // SpotYou card wrapper avec bouton de désave
  spotYouCardWrap: { position: 'relative', marginBottom: 12 },
  unsaveOverlay: {
    position: 'absolute',
    top: 44,
    right: 10,
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    zIndex: 10,
  },
});
