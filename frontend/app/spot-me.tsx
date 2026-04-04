import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, Alert, Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { useLocation } from '../context/LocationContext';
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
import { useGuardedRouter } from '../hooks/useGuardedRouter';
import { useSpotYouListLive } from '../hooks/useSpotYouListLive';

// ─── Screen ─────────────────────────────────────────────────────────────────

export default function MySpotYouScreen() {
  const router = useGuardedRouter();
  const { user } = useAuth();
  const { location } = useLocation();
  const { playClickSound } = useClickSound();

  const { isOnline } = useNetwork();

  const [tab, setTab] = useState<'active' | 'deactivated' | 'communities'>('active');
  const [points, setPoints] = useState<any[]>([]);
  const [deactivated, setDeactivated] = useState<any[]>([]);
  const [joined, setJoined] = useState<any[]>([]);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [invitations, setInvitations] = useState<any[]>([]);
  const [inviteActionId, setInviteActionId] = useState<string | null>(null);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);
  const [screenState, setScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  // Modal membres
  const [membersModal, setMembersModal] = useState(false);
  const [membersTitle, setMembersTitle] = useState('');
  const [membersList, setMembersList] = useState<any[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Modal de confirmation
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);

  // ── Mises à jour temps réel — SpotYou actifs ────────────────────────────
  useSpotYouListLive(points, (pid, update) => {
    setPoints(prev => prev.map(p =>
      p.point_id === pid ? { ...p, ...update } : p
    ));
  });

  // ── Mises à jour temps réel — Communautés rejointes ───────────────────────
  useSpotYouListLive(joined, (pid, update) => {
    setJoined(prev => prev.map(p =>
      p.point_id === pid ? { ...p, ...update } : p
    ));
  });

  const loadPoints = useCallback(async (isRefresh = false) => {
    const userId = user?.user_id;
    const cacheKey = buildCacheKey({ path: '/tag-points/mine', userId, schemaVersion: SCHEMA_VERSION });
    const ttl = getTtl('/tag-points/mine') ?? 5 * 60_000;

    // Toujours charger les désactivés et communautés en parallèle (pas de cache)
    const fetchDeactivated = () =>
      api.get('/users/me/reactivatable')
        .then((d: any) => { if (d?.spotyous) setDeactivated(d.spotyous); })
        .catch(() => {});

    const fetchJoined = () => {
      api.get('/users/me/events')
        .then((d: any) => {
          if (Array.isArray(d)) {
            setJoined(d.filter((item: any) => !item.is_owner));
          }
        })
        .catch(() => {});
      api.get('/users/me/pending-requests')
        .then((d: any) => { if (Array.isArray(d)) setPendingRequests(d); })
        .catch(() => {});
      api.get('/users/me/spotyou-invitations')
        .then((d: any) => { if (Array.isArray(d)) setInvitations(d); })
        .catch(() => {});
    };

    // Étape 1 : lecture cache sur le premier chargement
    if (!isRefresh) {
      const cached = await cacheGet<any[]>(cacheKey);
      if (cached) {
        setPoints(Array.isArray(cached.data) ? cached.data : []);
        const fresh = isFresh(cached);
        setScreenState(fresh ? 'ready_fresh' : 'ready_cached');
        setStaleMinutes(fresh ? null : cacheAgeMinutes(cached));
        fetchDeactivated();
        fetchJoined();
        if (fresh) return;
      }
    }

    if (isRefresh) setRefreshing(true);

    // Étape 2 : fetch réseau
    try {
      const [data] = await Promise.all([
        api.get('/tag-points/mine'),
        fetchDeactivated(),
        fetchJoined(),
      ]);
      const list = data || [];
      setPoints(list);
      setScreenState('ready_fresh');
      setStaleMinutes(null);
      setNetworkFailed(false);
      await cacheSet(cacheKey, list, ttl);
    } catch {
      setNetworkFailed(true);
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

  const handleReactivate = async (entity: any) => {
    Alert.alert(
      'Réactiver ce SpotYou ?',
      entity.media_purged
        ? 'Votre SpotYou sera réactivé. Les photos sont manquantes — ajoutez-en de nouvelles pour le publier.'
        : `"${entity.title}" redeviendra visible publiquement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réactiver', style: 'default',
          onPress: async () => {
            setReactivatingId(entity.id);
            try {
              await api.post(`/tag-points/${entity.id}/reactivate`, {});
              setDeactivated(prev => prev.filter(e => e.id !== entity.id));
              loadPoints(true);
            } catch (e: any) {
              Alert.alert('Erreur', e.message || 'Réactivation impossible.');
            } finally {
              setReactivatingId(null);
            }
          },
        },
      ]
    );
  };

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

  const toggleJoin = (item: any) => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour rejoindre.'); return; }
    if (!isOnline) {
      Alert.alert('Action impossible hors ligne', 'Vérifiez votre connexion réseau.');
      return;
    }
    const alreadyMember = joined.some(j => j.point_id === item.point_id);
    const isItemDeactivated = item.active === false;
    if (alreadyMember) {
      if (isItemDeactivated) {
        setConfirmAction({
          title: 'Quitter cette communauté désactivée ?',
          description: `«${item.title}» est désactivé par son créateur. En quittant, vous perdrez votre place de membre.`,
          icon: 'exit-outline',
          iconColor: '#F59E0B',
          iconBg: '#FFFBEB',
          confirmLabel: 'Quitter quand même',
          confirmStyle: 'danger',
          cancelLabel: 'Rester membre',
          bullets: [
            'Le SpotYou est désactivé — aucune séance active',
            'Vous pouvez rejoindre à nouveau ce SpotYou s\'il est réactivé',
          ],
        });
      } else {
        setConfirmAction({
          title: 'Quitter cette communauté ?',
          description: `Vous quitterez «${item.title}» et vos participations futures seront annulées.`,
          icon: 'exit-outline',
          iconColor: '#EF4444',
          iconBg: '#FEF2F2',
          confirmLabel: 'Quitter la communauté',
          confirmStyle: 'danger',
          cancelLabel: 'Rester membre',
          bullets: [
            'Vos participations futures seront annulées',
            'Vous pourrez rejoindre à nouveau plus tard',
          ],
        });
      }
      setPendingCallback(() => async () => {
        setJoiningId(item.point_id);
        try {
          await api.delete(`/tag-points/${item.point_id}/leave`);
          setJoined(prev => prev.filter(j => j.point_id !== item.point_id));
        } catch (e: any) {
          Alert.alert('Erreur', e.message || 'Une erreur est survenue');
        } finally {
          setJoiningId(null);
        }
      });
      setConfirmVisible(true);
    } else {
      setJoiningId(item.point_id);
      api.post(`/tag-points/${item.point_id}/join`, {})
        .then((res: any) => {
          setJoined(prev => [...prev, {
            ...item,
            participants_count: res.participants_count ?? (item.participants_count || 0) + 1,
          }]);
        })
        .catch((e: any) => {
          Alert.alert('Erreur', e.message || 'Une erreur est survenue');
        })
        .finally(() => setJoiningId(null));
    }
  };

  const toggleGoing = (item: any) => {    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour participer.'); return; }
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
        await cacheInvalidate(['/tag-points/mine', '/planning']);
      } catch (e: any) { Alert.alert('Erreur', e.message || 'Une erreur est survenue'); }
      finally { setTogglingId(null); }
    });
    setConfirmVisible(true);
  };

  return (
    <SafeAreaView style={st.container} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.headerBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Mes SpotMe</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/create' as any)} style={st.headerBtn} testID="add-spotyou-btn">
          <Ionicons name="add" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={st.tabs}>
        <TouchableOpacity
          style={[st.tab, tab === 'active' && st.tabActive]}
          onPress={() => setTab('active')}
          testID="tab-active"
        >
          <Text style={[st.tabText, tab === 'active' && st.tabTextActive]}>Actifs</Text>
          {points.length > 0 && (
            <View style={[st.tabBadge, tab === 'active' && st.tabBadgeActive]}>
              <Text style={[st.tabBadgeText, tab === 'active' && st.tabBadgeTextActive]}>{points.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.tab, tab === 'deactivated' && st.tabActive]}
          onPress={() => setTab('deactivated')}
          testID="tab-deactivated"
        >
          <Text style={[st.tabText, tab === 'deactivated' && st.tabTextActive]}>Désactivés</Text>
          {deactivated.length > 0 && (
            <View style={[st.tabBadge, tab === 'deactivated' ? st.tabBadgeActive : st.tabBadgeAmber]}>
              <Text style={[st.tabBadgeText, tab === 'deactivated' && st.tabBadgeTextActive]}>{deactivated.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[st.tab, tab === 'communities' && st.tabActive]}
          onPress={() => setTab('communities')}
          testID="tab-communities"
        >
          <Text style={[st.tabText, tab === 'communities' && st.tabTextActive]}>Communautés</Text>
          {(invitations.length > 0 || joined.length > 0) && (
            <View style={[st.tabBadge, tab === 'communities' && st.tabBadgeActive]}>
              <Text style={[st.tabBadgeText, tab === 'communities' && st.tabBadgeTextActive]}>
                {joined.length + invitations.length}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {screenState === 'ready_cached' && networkFailed && <StaleBanner staleMinutes={staleMinutes} />}

      {/* Contenu onglet Actifs */}
      {tab === 'active' && (
        screenState === 'loading_initial' ? (
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
                isLive
                userLat={location.lat}
                userLng={location.lng}
              />
            )}
            contentContainerStyle={{ padding: Spacing.md, gap: 12, paddingBottom: 48 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
            ListEmptyComponent={
              <View style={st.empty}>
                <Ionicons name="location-outline" size={48} color={Colors.muted} />
                <Text style={st.emptyTitle}>Aucun SpotMe actif</Text>
                <Text style={st.emptyText}>Vous n'avez pas encore créé de SpotYou.</Text>
                <TouchableOpacity style={st.createBtn} onPress={() => router.push('/(tabs)/create' as any)}>
                  <Text style={st.createBtnText}>Créer mon premier SpotMe</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )
      )}

      {/* Contenu onglet Désactivés */}
      {tab === 'deactivated' && (
        <FlatList
          data={deactivated}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: Spacing.md, gap: 12, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          renderItem={({ item }) => {
            const days = item.days_until_media_purge;
            const urgent = days !== null && days <= 7;
            return (
              <View style={st.deactivatedCard} testID={`deactivated-tp-${item.id}`}>
                {/* Même card SpotYou — réutilisation du composant */}
                <SpotYouCard
                  item={{
                    point_id: item.id,
                    title: item.title,
                    images: item.thumbnail ? [item.thumbnail] : [],
                    image_url: item.thumbnail,
                    active: false,
                  }}
                  onNavigate={id => router.push(`/spot-you/${id}` as any)}
                  onToggleGoing={() => {}}
                  togglingId={null}
                  onViewMembers={() => {}}
                  testID={`deactivated-card-${item.id}`}
                  userLat={location.lat}
                  userLng={location.lng}
                />
                {/* Bandeau informatif */}
                <View style={[st.deactivatedBanner, urgent && st.deactivatedBannerUrgent]}>
                  <View style={st.deactivatedBannerLeft}>
                    <Ionicons
                      name={item.media_purged ? 'image-outline' : 'pause-circle-outline'}
                      size={14}
                      color={urgent ? '#F59E0B' : Colors.muted}
                    />
                    <Text style={[st.deactivatedBannerText, urgent && st.deactivatedBannerTextUrgent]}>
                      {item.media_purged
                        ? 'Photos manquantes — ajoutez-en pour publier'
                        : days !== null
                          ? `Médias supprimés dans ${days} jour${days > 1 ? 's' : ''}`
                          : 'Désactivé'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={st.reactivateBtn}
                    onPress={() => handleReactivate(item)}
                    disabled={reactivatingId === item.id}
                    testID={`reactivate-btn-${item.id}`}
                  >
                    {reactivatingId === item.id
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={st.reactivateBtnText}>Réactiver</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={st.empty}>
              <Ionicons name="pause-circle-outline" size={48} color={Colors.muted} />
              <Text style={st.emptyTitle}>Aucun SpotYou désactivé</Text>
              <Text style={st.emptyText}>Vos SpotYous désactivés apparaîtront ici.</Text>
            </View>
          }
        />
      )}

      {/* Contenu onglet Communautés */}
      {tab === 'communities' && (
        <FlatList
          data={joined}
          keyExtractor={item => item.point_id}
          contentContainerStyle={{ padding: Spacing.md, gap: 12, paddingBottom: 48 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListHeaderComponent={(pendingRequests.length > 0 || invitations.length > 0) ? (
            <>
              {/* ── Section Invitations reçues ── */}
              {invitations.length > 0 && (
                <View style={st.pendingSection} testID="invitations-section">
                  <View style={st.pendingSectionHeader}>
                    <Ionicons name="mail-outline" size={14} color={Colors.primary} />
                    <Text style={[st.pendingSectionTitle, { color: Colors.primary }]}>
                      Invitations reçues ({invitations.length})
                    </Text>
                  </View>
                  {invitations.map(item => (
                    <View key={item.point_id} style={[st.pendingCard, { borderLeftColor: Colors.primary, borderLeftWidth: 3 }]} testID={`invitation-card-${item.point_id}`}>
                      <View style={st.pendingCardLeft}>
                        {item.images?.[0] ? (
                          <Image source={{ uri: item.images[0] }} style={st.pendingThumb} />
                        ) : (
                          <View style={[st.pendingThumb, st.pendingThumbPlaceholder]}>
                            <Ionicons name="location-outline" size={16} color={Colors.muted} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={st.pendingTitle} numberOfLines={1}>{item.title}</Text>
                          {item.inviter ? (
                            <Text style={[st.pendingSubtitle, { color: Colors.primary }]}>
                              Invité par {item.inviter.name}
                            </Text>
                          ) : null}
                          <View style={{ flexDirection: 'row', gap: 4, marginTop: 3 }}>
                            <View style={[st.pendingBadge, { backgroundColor: item.visibility_type === 'private' ? '#6366F120' : Colors.primary + '15' }]}>
                              <Ionicons name={item.visibility_type === 'private' ? 'lock-closed-outline' : 'globe-outline'} size={10} color={item.visibility_type === 'private' ? '#6366F1' : Colors.primary} />
                              <Text style={[st.pendingBadgeText, { color: item.visibility_type === 'private' ? '#6366F1' : Colors.primary }]}>
                                {item.visibility_type === 'private' ? 'Privé' : 'Public'}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                      <View style={{ gap: 6 }}>
                        <TouchableOpacity
                          style={[st.inviteActionBtn, { backgroundColor: Colors.primary }]}
                          testID={`accept-invite-${item.point_id}`}
                          disabled={inviteActionId === item.point_id}
                          onPress={async () => {
                            setInviteActionId(item.point_id);
                            try {
                              await api.post(`/tag-points/${item.point_id}/invitations/accept`, {});
                              setInvitations(prev => prev.filter(i => i.point_id !== item.point_id));
                            } catch (e: any) {
                              console.warn('Accept error', e?.message);
                            } finally {
                              setInviteActionId(null);
                            }
                          }}
                        >
                          {inviteActionId === item.point_id
                            ? <ActivityIndicator size="small" color={Colors.background} />
                            : <Text style={st.inviteActionBtnText}>Accepter</Text>}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[st.inviteActionBtn, { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]}
                          testID={`refuse-invite-${item.point_id}`}
                          disabled={inviteActionId === item.point_id}
                          onPress={async () => {
                            setInviteActionId(item.point_id);
                            try {
                              await api.post(`/tag-points/${item.point_id}/invitations/refuse`, {});
                              setInvitations(prev => prev.filter(i => i.point_id !== item.point_id));
                            } catch (e: any) {
                              console.warn('Refuse error', e?.message);
                            } finally {
                              setInviteActionId(null);
                            }
                          }}
                        >
                          <Text style={[st.inviteActionBtnText, { color: Colors.foreground }]}>Refuser</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))}
                  <View style={st.pendingDivider} />
                </View>
              )}

              {/* ── Section demandes en attente ── */}
              {pendingRequests.length > 0 && (
                <View style={st.pendingSection} testID="pending-requests-section">
                  <View style={st.pendingSectionHeader}>
                    <Ionicons name="time-outline" size={14} color="#F59E0B" />
                    <Text style={st.pendingSectionTitle}>En attente de validation ({pendingRequests.length})</Text>
                  </View>
                  {pendingRequests.map(item => (
                    <View key={item.point_id} style={st.pendingCard} testID={`pending-card-${item.point_id}`}>
                      <View style={st.pendingCardLeft}>
                        {item.images?.[0] ? (
                          <Image source={{ uri: item.images[0] }} style={st.pendingThumb} />
                        ) : (
                          <View style={[st.pendingThumb, st.pendingThumbPlaceholder]}>
                            <Ionicons name="location-outline" size={16} color={Colors.muted} />
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={st.pendingTitle} numberOfLines={1}>{item.title}</Text>
                          <Text style={st.pendingSubtitle}>En attente de validation</Text>
                        </View>
                      </View>
                      <View style={st.pendingBadge}>
                        <Ionicons name="hourglass-outline" size={11} color="#F59E0B" />
                        <Text style={st.pendingBadgeText}>Pending</Text>
                      </View>
                    </View>
                  ))}
                  <View style={st.pendingDivider} />
                </View>
              )}
            </>
          ) : null}
          renderItem={({ item }) => (
            <SpotYouCard
              item={item}
              onNavigate={item.active !== false ? (id => router.push(`/spot-you/${id}` as any)) : () => {}}
              onToggleGoing={toggleGoing}
              togglingId={togglingId}
              onViewMembers={item.active !== false ? openMembersModal : undefined}
              testID={`community-card-${item.point_id}`}
              isLive={item.active !== false}
              userLat={location.lat}
              userLng={location.lng}
              onToggleJoin={toggleJoin}
              joiningId={joiningId}
              isMember={true}
              isOwner={false}
              isDeactivated={item.active === false}
            />
          )}
          ListEmptyComponent={pendingRequests.length === 0 ? (
            <View style={st.empty}>
              <Ionicons name="people-outline" size={48} color={Colors.muted} />
              <Text style={st.emptyTitle}>Aucune communauté</Text>
              <Text style={st.emptyText}>Rejoignez des SpotYou pour les retrouver ici.</Text>
            </View>
          ) : null}
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
  // ── Demandes en attente ─────────────────────────────────────────────────
  pendingSection: { marginBottom: 8 },
  pendingSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 8,
  },
  pendingSectionTitle: { fontSize: 13, fontWeight: '700', color: '#F59E0B' },
  pendingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.card, borderRadius: Radius.md,
    borderWidth: 1, borderColor: '#F59E0B40',
    padding: Spacing.sm, marginBottom: 6,
  },
  pendingCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  pendingThumb: { width: 36, height: 36, borderRadius: 8 },
  pendingThumbPlaceholder: { backgroundColor: Colors.cardElevated, alignItems: 'center', justifyContent: 'center' },
  pendingTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  pendingSubtitle: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  pendingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F59E0B18', borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: '#F59E0B40',
  },
  pendingBadgeText: { fontSize: 10, fontWeight: '700', color: '#F59E0B' },
  pendingDivider: { height: 1, backgroundColor: Colors.border, marginBottom: 12, marginTop: 4 },
  inviteActionBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', minWidth: 72 },
  inviteActionBtnText: { fontSize: 12, fontWeight: '700', color: Colors.background },

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

  // Tabs
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.background,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: Colors.primary,
  },
  tabText: { fontSize: 14, fontWeight: '500', color: Colors.muted },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  tabBadge: {
    minWidth: 18, height: 18,
    borderRadius: 9,
    backgroundColor: Colors.cardElevated,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeActive: { backgroundColor: Colors.primary + '20' },
  tabBadgeAmber: { backgroundColor: '#F59E0B20' },
  tabBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.muted },
  tabBadgeTextActive: { color: Colors.primary },

  // Deactivated card
  deactivatedCard: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.card,
    opacity: 0.85,
  },
  deactivatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.cardElevated,
    gap: 8,
  },
  deactivatedBannerUrgent: { backgroundColor: '#F59E0B15' },
  deactivatedBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  deactivatedBannerText: { fontSize: 12, color: Colors.muted, flex: 1 },
  deactivatedBannerTextUrgent: { color: '#F59E0B' },
  reactivateBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  reactivateBtnText: { color: Colors.background, fontWeight: '700', fontSize: 12 },

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
