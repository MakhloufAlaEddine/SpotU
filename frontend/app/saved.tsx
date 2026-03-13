import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
;
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { SpotYouCard } from '../components/SpotYouCard';
import ConfirmActionModal, { ConfirmAction } from '../components/ConfirmActionModal';
import { useNetwork } from '../hooks/useNetwork';
import { useClickSound } from '../hooks/useClickSound';
import { cacheInvalidate } from '../lib/cache';
import { useGuardedRouter } from '../hooks/useGuardedRouter';

const ORANGE = '#FF9500';

interface SavedService {
  service_id: string;
  title: string;
  price?: number;
  images?: string[];
  address?: string;
  coach?: { user_id: string; name: string; picture?: string };
  saved_at?: string;
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

function SavedServiceCard({ item, onPress, onUnsave }: { item: SavedService; onPress: () => void; onUnsave: () => void }) {
  const img = item.images?.[0];
  return (
    <TouchableOpacity style={[card.container, { borderColor: 'rgba(255,149,0,0.3)' }]} onPress={onPress} activeOpacity={0.8} testID={`saved-svc-${item.service_id}`}>
      <View style={card.imageWrap}>
        {img
          ? <Image source={{ uri: img }} style={card.image} resizeMode="cover" />
          : <View style={[card.imageFallback, { backgroundColor: '#1A1000' }]}>
              <Ionicons name="calendar-outline" size={28} color="rgba(255,149,0,0.3)" />
            </View>
        }
        {/* Badge SERVICE */}
        <View style={{ position: 'absolute', top: 6, left: 6, backgroundColor: ORANGE, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
          <Text style={{ fontSize: 8, fontWeight: '800', color: '#fff', letterSpacing: 0.3 }}>SERVICE</Text>
        </View>
      </View>
      <View style={card.info}>
        <Text style={card.title} numberOfLines={2}>{item.title}</Text>
        <View style={card.metaRow}>
          {item.price != null && (
            <View style={card.pill}>
              <Text style={[card.pillText, { color: ORANGE }]}>À partir de {item.price}€</Text>
            </View>
          )}
          {item.coach && (
            <View style={card.pill}>
              <Ionicons name="person-outline" size={11} color={Colors.muted} />
              <Text style={[card.pillText, { color: Colors.muted }]}>{item.coach.name}</Text>
            </View>
          )}
          {item.saved_at && (
            <View style={card.pill}>
              <Ionicons name="bookmark-outline" size={11} color={Colors.muted} />
              <Text style={[card.pillText, { color: Colors.muted }]}>{timeAgo(item.saved_at)}</Text>
            </View>
          )}
        </View>
      </View>
      <TouchableOpacity style={card.unsaveBtn} onPress={onUnsave} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} testID={`unsave-svc-btn-${item.service_id}`}>
        <Ionicons name="bookmark" size={22} color={ORANGE} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const card = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  imageWrap: { width: 88, height: 88, backgroundColor: Colors.border, position: 'relative' },
  image: { width: '100%', height: '100%' },
  imageFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  info: { flex: 1, padding: Spacing.md, gap: 6 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.foreground, lineHeight: 20 },
  metaRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  pillText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  unsaveBtn: { padding: Spacing.md, alignSelf: 'center' },
});

// ── Onglets
type Tab = 'spotyou' | 'services';

export default function SavedScreen() {
  const router = useGuardedRouter();
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
