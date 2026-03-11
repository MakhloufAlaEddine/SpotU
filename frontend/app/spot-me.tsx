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

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNextDate(next_session_date: string | null, event_date: string | null, event_schedule: any): string {
  const src = next_session_date || event_date;
  if (!src) return '';

  const d = new Date(src);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000);
  let prefix = '';
  if (diffDays === 0) prefix = "Aujourd'hui";
  else if (diffDays === 1) prefix = 'Demain';
  else prefix = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

  // Récupérer l'heure depuis event_schedule (récurrent) ou event_date (date unique)
  let timeStr = '';
  if (event_schedule && next_session_date) {
    // Extraire l'heure du planning pour le jour de la semaine de next_session_date
    try {
      const sched = typeof event_schedule === 'string' ? JSON.parse(event_schedule) : event_schedule;
      const weekday = d.getDay(); // 0=Dim..6=Sam (JS)
      // Conversion JS Sunday=0 → Python Monday=0 convention
      const pyWeekday = weekday === 0 ? 6 : weekday - 1;
      const slots = sched?.schedule?.[String(pyWeekday)] || [];
      const firstSlot = Array.isArray(slots) ? slots[0] : slots;
      timeStr = firstSlot?.start || '';
    } catch (_) {}
  } else if (event_date) {
    // Événement date unique : extraire l'heure depuis event_date (datetime ISO)
    const dt = new Date(event_date);
    const h = dt.getHours().toString().padStart(2, '0');
    const m = dt.getMinutes().toString().padStart(2, '0');
    timeStr = `${h}:${m}`;
  }

  return timeStr ? `${prefix} · ${timeStr}` : prefix;
}

function isPastDate(event_date: string | null, event_schedule: any): boolean {
  if (event_schedule) return false;
  if (!event_date) return false;
  return new Date(event_date) < new Date();
}

// ─── SpotMe Card ────────────────────────────────────────────────────────────

function SpotCard({ item, onNavigate, onToggleGoing, togglingId, onViewMembers }: {
  item: any;
  onNavigate: (id: string) => void;
  onToggleGoing: (item: any) => void;
  togglingId: string | null;
  onViewMembers: (id: string, title: string) => void;
}) {
  const isRecurring = !!item.event_schedule;
  const past = isPastDate(item.event_date, item.event_schedule);
  const nextLabel = formatNextDate(item.next_session_date, item.event_date, item.event_schedule);
  const rating = parseFloat(item.rating) || 0;
  const votes = item.vote_count || 0;
  const goingCount = item.going_count || 0;
  const maxP = item.maximum_participants;
  const isFull = item.is_full || false;
  const isGoing = item.is_going || false;
  const isLoading = togglingId === item.point_id;

  return (
    <TouchableOpacity
      style={st.card}
      onPress={() => onNavigate(item.point_id)}
      activeOpacity={0.9}
      testID={`my-tp-${item.point_id}`}
    >
      {/* Header: image + title + badge */}
      <View style={st.cardHeader}>
        <View style={st.thumbWrap}>
          {item.images?.[0] ? (
            <Image source={{ uri: item.images[0] }} style={st.thumb} />
          ) : (
            <View style={[st.thumb, st.thumbPlaceholder]}>
              <Ionicons name="location-outline" size={24} color={Colors.muted} />
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          {/* Title + type badge */}
          <View style={st.titleRow}>
            <Text style={st.cardTitle} numberOfLines={2}>{item.title || 'Sans titre'}</Text>
            <View style={[st.typeBadge, isRecurring ? st.typeBadgeRecurring : st.typeBadgeOnce]}>
              <Ionicons
                name={isRecurring ? 'repeat' : 'calendar-outline'}
                size={10}
                color={isRecurring ? Colors.primary : Colors.muted}
              />
              <Text style={[st.typeBadgeText, isRecurring ? { color: Colors.primary } : { color: Colors.muted }]}>
                {isRecurring ? 'Récurrent' : 'Unique'}
              </Text>
            </View>
          </View>

          {/* Rating */}
          {votes > 0 && (
            <View style={st.ratingRow}>
              {[1,2,3,4,5].map(i => (
                <Ionicons
                  key={i}
                  name={i <= Math.round(rating) ? 'star' : 'star-outline'}
                  size={12}
                  color={i <= Math.round(rating) ? Colors.star : Colors.muted}
                />
              ))}
              <Text style={st.ratingText}>{rating.toFixed(1)} ({votes})</Text>
            </View>
          )}

          {/* Badges: visibility + membres cliquable */}
          <View style={st.metaBadgesRow}>
            {item.is_public === false && (
              <View style={st.badge}>
                <Ionicons name="eye-off-outline" size={10} color={Colors.muted} />
                <Text style={st.badgeText}>Masqué</Text>
              </View>
            )}
            {/* Chip membres — toujours visible (propriétaire est toujours membre) */}
            <TouchableOpacity
              style={st.membersChip}
              onPress={() => onViewMembers(item.point_id, item.title)}
              testID={`members-chip-${item.point_id}`}
            >
              <Ionicons name="people-outline" size={11} color={Colors.primary} />
              <Text style={st.membersChipText}>
                {Math.max(item.participants_count || 0, 1)} membre{Math.max(item.participants_count || 0, 1) > 1 ? 's' : ''}
              </Text>
              <Ionicons name="chevron-forward" size={10} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Event section — next date + action bar */}
      {(nextLabel || past) && (
        <View style={st.eventSection}>
          {/* Date row */}
          <View style={st.eventDateRow}>
            <View style={[st.eventIconBox, past && { backgroundColor: Colors.border + '40' }]}>
              <Ionicons
                name={isRecurring ? 'repeat' : 'calendar'}
                size={15}
                color={past ? Colors.muted : Colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[st.eventLabel, past && { color: Colors.muted }]}>
                  {past ? 'Événement passé' : 'Prochain événement'}
                </Text>
                {isRecurring && !past && (
                  <View style={st.recurBadge}>
                    <Text style={st.recurBadgeText}>Récurrent</Text>
                  </View>
                )}
              </View>
              <Text style={[st.eventDate, past && { color: Colors.muted }]}>{nextLabel}</Text>
            </View>
          </View>

          {/* Action bar */}
          {past ? (
            <View style={[st.actionBar, { justifyContent: 'flex-start', gap: 6 }]}>
              <Ionicons name="time-outline" size={12} color={Colors.muted} />
              <Text style={st.pastText}>
                Terminé · {new Date(item.event_date || '').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </View>
          ) : (
            <View style={st.actionBar}>
              {/* Participants chip */}
              <View style={st.participantChip}>
                <Ionicons name="people-outline" size={13} color={Colors.primary} />
                <Text style={st.participantChipText}>
                  {goingCount} participant{goingCount > 1 ? 's' : ''}{maxP ? ` / ${maxP}` : ''}
                </Text>
              </View>

              {/* Je participe button */}
              <TouchableOpacity
                style={[
                  st.goingBtn,
                  isGoing && st.goingBtnActive,
                  (isFull && !isGoing) && st.goingBtnFull,
                ]}
                onPress={() => !isFull || isGoing ? onToggleGoing(item) : null}
                disabled={isLoading || (isFull && !isGoing)}
                testID={`going-btn-${item.point_id}`}
              >
                {isLoading
                  ? <ActivityIndicator size="small" color={isGoing ? Colors.primary : Colors.background} />
                  : (isFull && !isGoing)
                    ? <>
                        <Ionicons name="flash" size={12} color="#F59E0B" />
                        <Text style={[st.goingBtnText, { color: '#F59E0B' }]}>Complet</Text>
                      </>
                    : <>
                        <Ionicons
                          name={isGoing ? 'checkmark-circle' : 'add-circle-outline'}
                          size={12}
                          color={isGoing ? Colors.primary : Colors.background}
                        />
                        <Text style={[st.goingBtnText, isGoing && { color: Colors.primary }]}>
                          {isGoing ? 'Je participe ✓' : 'Je participe'}
                        </Text>
                      </>
                }
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

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
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
      ) : screenState === 'error_no_data' ? (
        <ErrorNoData onRetry={() => loadPoints(true)} testID="spotme-error-no-data" />
      ) : (
        <FlatList
          data={points}
          keyExtractor={item => item.point_id}
          renderItem={({ item }) => (
            <SpotCard
              item={item}
              onNavigate={id => router.push(`/spot-you/${id}` as any)}
              onToggleGoing={toggleGoing}
              togglingId={togglingId}
              onViewMembers={openMembersModal}
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
                    <View style={st.memberAvatar}>
                      {m.picture
                        ? <Image source={{ uri: m.picture }} style={{ width: '100%', height: '100%', borderRadius: 20 }} />
                        : <Text style={st.memberAvatarLetter}>{m.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                      }
                    </View>
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

  // Card
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
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
  },
  typeBadgeRecurring: { backgroundColor: Colors.primary + '12', borderColor: Colors.primary + '40' },
  typeBadgeOnce: { backgroundColor: Colors.border + '60', borderColor: Colors.border },
  typeBadgeText: { fontSize: 10, fontWeight: '600' },

  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 4 },
  ratingText: { fontSize: 11, color: Colors.muted, marginLeft: 2 },

  metaBadgesRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.background, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeText: { fontSize: 10, color: Colors.muted },

  // Event section
  eventSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  eventDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: 4,
  },
  eventIconBox: {
    width: 30, height: 30,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventLabel: { fontSize: 11, fontWeight: '600', color: Colors.foreground, marginBottom: 1 },
  eventDate: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  recurBadge: {
    backgroundColor: Colors.primary + '15',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: Colors.primary + '30',
  },
  recurBadgeText: { fontSize: 9, fontWeight: '600', color: Colors.primary },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 38,
    paddingTop: 0,
  },
  participantChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary + '12',
    borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  participantChipText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  goingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Radius.full,
  },
  goingBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  goingBtnFull: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#F59E0B' },
  goingBtnText: { fontSize: 12, fontWeight: '700', color: Colors.background },
  pastText: { fontSize: 11, color: Colors.muted, fontStyle: 'italic' },

  membersChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primary + '12',
    borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  membersChipText: { fontSize: 11, fontWeight: '600', color: Colors.primary },

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
