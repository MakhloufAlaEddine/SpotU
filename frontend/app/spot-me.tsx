import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';
import ConfirmActionModal, { ConfirmAction } from '../components/ConfirmActionModal';
import { useClickSound } from '../hooks/useClickSound';
import { useNetwork, registerScreenRefresh } from '../hooks/useNetwork';
import { StaleBanner, ErrorNoData } from '../components/OfflineBanner';
import { buildCacheKey, cacheGet, cacheSet, isFresh, cacheAgeMinutes, getTtl, SCHEMA_VERSION, cacheInvalidate } from '../lib/cache';
import { SpotYouCard } from '../components/SpotYouCard';
import { UserAvatar } from '../components/UserAvatar';
import { ScreenLoader } from '../components/ScreenLoader';
import { EmptyState } from '../components/EmptyState';

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function MySpotYouScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { playClickSound } = useClickSound();

  const { isOnline } = useNetwork();

  const [points, setPoints] = useState<any[]>([]);
  const [screenState, setScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Modal membres
  const [membersModal, setMembersModal] = useState(false);
  const [membersTitle, setMembersTitle] = useState('');
  const [membersList, setMembersList] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Modal de confirmation
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

  const loadPoints = useCallback(async (isRefresh = false) => {
    const userId = user?.user_id;
    const cacheKey = buildCacheKey({ path: '/tag-points/mine', userId, schemaVersion: SCHEMA_VERSION });
    const ttl = getTtl('/tag-points/mine') ?? 5 * 60_000;

    // Étape 1 : lecture cache sur le premier chargement
    if (!isRefresh) {
      const cached = await cacheGet<any[]>(cacheKey);
      if (cached) {
        setPoints(Array.isArray(cached.data) ? cached.data : []);
        const fresh = isFresh(cached);
        setScreenState(fresh ? 'ready_fresh' : 'ready_cached');
        setStaleMinutes(fresh ? null : cacheAgeMinutes(cached));
        if (fresh) return;
      }
    }

    if (isRefresh) setRefreshing(true);

    // Étape 2 : fetch réseau
    try {
      const data = await api.get('/tag-points/mine');
      const list = data || [];
      setPoints(list);
      setScreenState('ready_fresh');
      setStaleMinutes(null);
      await cacheSet(cacheKey, list, ttl);
    } catch {
      setPoints(prev => {
        if (prev.length > 0) {
          setScreenState('ready_cached');
        } else {
          setScreenState('error_no_data');
        }
        return prev;
      });
    } finally {
      setRefreshing(false);
    }
  }, [user?.user_id]);

  useEffect(() => { loadPoints(false); }, [loadPoints]);
  useEffect(() => registerScreenRefresh('spot-me', () => loadPoints(true), 5), [loadPoints]);
  const onRefresh = useCallback(() => { loadPoints(true); }, [loadPoints]);

  const openMembersModal = async (pointId: string, title: string) => {
    setMembersTitle(title);
    setMembersList([]);
    setMembersModal(true);
    setMembersLoading(true);
    try {
      const data = await api.get(`/tag-points/${pointId}/participants`);
      setMembersList(data || []);
    } catch {}
    finally { setMembersLoading(false); }
  };

  const toggleGoing = (item: any) => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour participer.'); return; }
    if (!isOnline) {
      Alert.alert(
        'Action impossible hors ligne',
        'Impossible de modifier votre participation sans connexion réseau. Vérifiez votre Wi-Fi ou données mobiles et réessayez.'
      );
      return;
    }
    playClickSound();
    if (item.is_going) {
      setConfirmAction({
        title: 'Annuler votre participation ?',
        description: 'Vous vous désinscrivez de la prochaine séance.',
        icon: 'close-circle-outline',
        iconColor: '#F59E0B',
        iconBg: '#FFFBEB',
        confirmLabel: 'Annuler ma participation',
        confirmStyle: 'danger',
        cancelLabel: 'Garder ma place',
        bullets: [
          'Vous restez créateur / membre de la communauté',
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
        setPoints(prev => prev.map(p =>
          p.point_id === item.point_id
            ? { ...p, is_going: res.is_going, going_count: res.going_count ?? p.going_count, is_full: res.is_full || false }
            : p
        ));
        // Invalidation ciblée après mutation de participation
        await cacheInvalidate(['/tag-points/mine', '/planning']);
      } catch (e: any) { Alert.alert('Erreur', e.message || 'Une erreur est survenue'); }
      finally { setTogglingId(null); }
    });
    setConfirmVisible(true);
  };

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.headerBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Mes SpotMe</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/create' as any)} style={st.headerBtn} testID="add-spotyou-btn">
          <Ionicons name="add" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {screenState === 'ready_cached' && <StaleBanner staleMinutes={staleMinutes} />}

      {screenState === 'loading_initial' ? (
        <ScreenLoader />
      ) : screenState === 'error_no_data' ? (
        <ErrorNoData onRetry={() => loadPoints(true)} testID="spotme-error-no-data" />
      ) : (
        <FlatList
          data={points}
          keyExtractor={item => item.point_id}
          renderItem={({ item }) => (
            <SpotYouCard
              item={item}
              onNavigate={id => router.push(`/spot-you/${id}` as any)}
              onToggleGoing={toggleGoing}
              togglingId={togglingId}
              onViewMembers={openMembersModal}
              testID={`my-tp-${item.point_id}`}
            />
          )}
          contentContainerStyle={{ padding: Spacing.md, gap: 12, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={st.empty}>
              <Ionicons name="location-outline" size={48} color={Colors.muted} />
              <Text style={st.emptyTitle}>Aucun SpotMe</Text>
              <Text style={st.emptyText}>Vous n'avez pas encore créé de SpotYou.</Text>
              <TouchableOpacity style={st.createBtn} onPress={() => router.push('/(tabs)/create' as any)}>
                <Text style={st.createBtnText}>Créer mon premier SpotMe</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}

      {/* Modal liste des membres */}
      <Modal visible={membersModal} animationType="slide" transparent onRequestClose={() => setMembersModal(false)}>
        <View style={st.modalOverlay}>
          <TouchableOpacity style={st.modalBackdrop} activeOpacity={1} onPress={() => setMembersModal(false)} />
          <View style={st.modalSheet}>
            <View style={st.modalHeader}>
              <View>
                <Text style={st.modalTitle}>
                  {membersLoading ? 'Chargement...' : `${membersList.length} membre${membersList.length > 1 ? 's' : ''}`}
                </Text>
                <Text style={st.modalSubtitle} numberOfLines={1}>{membersTitle}</Text>
              </View>
              <TouchableOpacity onPress={() => setMembersModal(false)} testID="close-members-modal">
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {membersLoading ? (
                <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
              ) : membersList.length === 0 ? (
                <Text style={st.emptyModalText}>Aucun membre pour l'instant</Text>
              ) : (
                membersList.map((m) => (
                  <TouchableOpacity
                    key={m.user_id}
                    style={st.memberRow}
                    onPress={() => { setMembersModal(false); router.push(`/user/${m.user_id}` as any); }}
                    testID={`member-row-${m.user_id}`}
                  >
                    <UserAvatar uri={m.picture} name={m.name} size={40} />
                    <Text style={st.memberName} numberOfLines={1}>{m.name}</Text>
                    {m.role === 'coach' && (
                      <View style={st.coachBadge}>
                        <Text style={st.coachBadgeText}>Coach</Text>
                      </View>
                    )}
                    <Ionicons name="chevron-forward" size={14} color={Colors.muted} style={{ marginLeft: 'auto' }} />
                  </TouchableOpacity>
                ))
              )}
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal de confirmation (Je participe / Annuler) */}
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

// ─── Styles ─────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },

  // Modal membres
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 8,
  },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  modalSubtitle: { fontSize: 12, color: Colors.muted, marginTop: 2, maxWidth: 240 },
  emptyModalText: { textAlign: 'center', color: Colors.muted, paddingVertical: 32, fontSize: 14 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border + '50',
  },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.primary + '20',
    alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  memberAvatarLetter: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground },
  coachBadge: {
    backgroundColor: Colors.primary + '15', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  coachBadgeText: { fontSize: 10, fontWeight: '600', color: Colors.primary },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  createBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 8,
  },
  createBtnText: { color: Colors.background, fontWeight: '700', fontSize: 14 },
});
