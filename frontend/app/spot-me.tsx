import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNextDate(next_session_date: string | null, event_date: string | null, event_schedule: any): string {
  const src = next_session_date || event_date;
  if (!src) return '';
  const d = new Date(src);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.setHours(0,0,0,0)) / 86400000);
  let prefix = '';
  if (diffDays === 0) prefix = "Aujourd'hui";
  else if (diffDays === 1) prefix = 'Demain';
  else prefix = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${prefix} · ${time}`;
}

function isPastDate(event_date: string | null, event_schedule: any): boolean {
  if (event_schedule) return false;
  if (!event_date) return false;
  return new Date(event_date) < new Date();
}

// ─── SpotMe Card ────────────────────────────────────────────────────────────

function SpotCard({ item, onNavigate, onToggleGoing, togglingId }: {
  item: any;
  onNavigate: (id: string) => void;
  onToggleGoing: (item: any) => void;
  togglingId: string | null;
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

          {/* Badges: visibility + participants */}
          <View style={st.metaBadgesRow}>
            {item.is_public === false && (
              <View style={st.badge}>
                <Ionicons name="eye-off-outline" size={10} color={Colors.muted} />
                <Text style={st.badgeText}>Masqué</Text>
              </View>
            )}
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
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const loadPoints = async () => {
    try {
      const data = await api.get('/tag-points/mine');
      setPoints(data || []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { loadPoints(); }, []);
  const onRefresh = useCallback(() => { setRefreshing(true); loadPoints(); }, []);

  const toggleGoing = async (item: any) => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour participer.'); return; }
    setTogglingId(item.point_id);
    try {
      const res = item.is_going
        ? await api.delete(`/spot-you/${item.point_id}/going`)
        : await api.post(`/spot-you/${item.point_id}/going`, {});
      setPoints(prev => prev.map(p =>
        p.point_id === item.point_id
          ? {
              ...p,
              is_going: res.is_going,
              going_count: res.going_count ?? p.going_count,
              is_full: res.is_full || false,
            }
          : p
      ));
    } catch (e: any) { Alert.alert('Erreur', e.message || 'Une erreur est survenue'); }
    finally { setTogglingId(null); }
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

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
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
