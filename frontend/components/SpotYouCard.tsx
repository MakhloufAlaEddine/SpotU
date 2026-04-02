/**
 * SpotYouCard — Composant partagé de carte SpotYou
 * Utilisé dans : spot-me.tsx (Mes SpotMe), saved.tsx (Enregistrés)
 */
import React, { useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { haversineDistance, formatDistance } from '../utils/distance';
import { TagImage, DOMAIN_ICONS } from './TagImage';

// ─── PulseDot ───────────────────────────────────────────────────────────────

function PulseDot() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,   duration: 700, useNativeDriver: true }),
      ])
    ).start();
  }, [opacity]);
  return <Animated.View style={[sc.pulseDot, { opacity }]} />;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function formatNextDate(
  next_session_date: string | null,
  event_date: string | null,
  event_schedule: any,
): string {
  const src = next_session_date || event_date;
  if (!src) return '';

  const d = new Date(src);
  const now = new Date();
  const diffDays = Math.floor(
    (d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000,
  );
  let prefix = '';
  if (diffDays === 0) prefix = "Aujourd'hui";
  else if (diffDays === 1) prefix = 'Demain';
  else prefix = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

  let timeStr = '';
  if (event_schedule && next_session_date) {
    try {
      const sched = typeof event_schedule === 'string' ? JSON.parse(event_schedule) : event_schedule;
      const weekday = d.getDay();
      const pyWeekday = weekday === 0 ? 6 : weekday - 1;
      const slots = sched?.schedule?.[String(pyWeekday)] || [];
      const firstSlot = Array.isArray(slots) ? slots[0] : slots;
      timeStr = firstSlot?.start || '';
    } catch (_) {}
  } else if (event_date) {
    const dt = new Date(event_date);
    const h = dt.getHours().toString().padStart(2, '0');
    const m = dt.getMinutes().toString().padStart(2, '0');
    timeStr = `${h}:${m}`;
  }

  return timeStr ? `${prefix} · ${timeStr}` : prefix;
}

export function isPastDate(event_date: string | null, event_schedule: any): boolean {
  if (event_schedule) return false;
  if (!event_date) return false;
  return new Date(event_date) < new Date();
}

// ─── SpotYouCard ─────────────────────────────────────────────────────────────

export interface SpotYouCardProps {
  item: any;
  onNavigate: (id: string) => void;
  onToggleGoing: (item: any) => void;
  togglingId: string | null;
  /** Si absent, le chip membres navigue vers le détail du spot */
  onViewMembers?: (id: string, title: string) => void;
  /** Remplace le testID par défaut spot-card-{id} */
  testID?: string;
  /** Élément extra affiché en overlay haut-droite (ex: bouton désave) */
  headerAction?: React.ReactNode;
  /** Affiche un indicateur de mise à jour temps réel */
  isLive?: boolean;
  /** Position de l'utilisateur pour afficher la distance */
  userLat?: number;
  userLng?: number;
  /** Bouton Rejoindre/Quitter (non-owners) */
  onToggleJoin?: (item: any) => void;
  joiningId?: string | null;
  isMember?: boolean;
  isOwner?: boolean;
}

export function SpotYouCard({
  item,
  onNavigate,
  onToggleGoing,
  togglingId,
  onViewMembers,
  testID,
  headerAction,
  isLive = false,
  userLat,
  userLng,
  onToggleJoin,
  joiningId,
  isMember = false,
  isOwner = true,
}: SpotYouCardProps) {
  const isRecurring = !!item.event_schedule;
  const past = isPastDate(item.event_date, item.event_schedule);
  const nextLabel = formatNextDate(item.next_session_date, item.event_date, item.event_schedule);
  const rating = parseFloat(item.rating) || 0;
  const votes = item.vote_count || 0;
  const goingCount = item.going_count ?? 0;
  const maxP = item.maximum_participants;
  const isFull = item.is_full || false;
  const isGoing = item.is_going || false;
  const isLoading = togglingId === item.point_id;
  const canParticipate = item.can_participate ?? false;

  // Calcul de la distance
  const dist = (() => {
    if (userLat == null || userLng == null) return '';
    const lat = item.latitude ?? item.location?.coordinates?.[1];
    const lng = item.longitude ?? item.location?.coordinates?.[0];
    if (lat == null || lng == null) return '';
    return formatDistance(haversineDistance(userLat, userLng, lat, lng));
  })();

  const handleViewMembers = () => {
    if (onViewMembers) {
      onViewMembers(item.point_id, item.title);
    } else {
      onNavigate(item.point_id);
    }
  };

  return (
    <TouchableOpacity
      style={sc.card}
      onPress={() => onNavigate(item.point_id)}
      activeOpacity={0.9}
      testID={testID || `spot-card-${item.point_id}`}
    >
      {/* Header: image + titre + badge */}
      <View style={sc.cardHeader}>
        {headerAction && (
          <View style={sc.headerActionOverlay}>{headerAction}</View>
        )}
        <View style={sc.thumbWrap}>
          {item.images?.[0] ? (
            <TagImage
              uri={item.images[0]}
              domainId={item.domain_id}
              style={sc.thumb}
              iconSize={24}
            />
          ) : (
            <View style={[sc.thumb, sc.thumbPlaceholder]}>
              <Ionicons name={DOMAIN_ICONS[item.domain_id] || 'location-outline'} size={24} color={Colors.muted} />
            </View>
          )}
        </View>

        <View style={{ flex: 1 }}>
          {/* Titre + badge type */}
          <View style={sc.titleRow}>
            <Text style={sc.cardTitle} numberOfLines={2}>{item.title || 'Sans titre'}</Text>
            <View style={[sc.typeBadge, isRecurring ? sc.typeBadgeRecurring : sc.typeBadgeOnce]}>
              <Ionicons
                name={isRecurring ? 'repeat' : 'calendar-outline'}
                size={10}
                color={isRecurring ? Colors.primary : Colors.muted}
              />
              <Text style={[sc.typeBadgeText, isRecurring ? { color: Colors.primary } : { color: Colors.muted }]}>
                {isRecurring ? 'Récurrent' : 'Unique'}
              </Text>
            </View>
          </View>

          {/* Note */}
          {votes > 0 && (
            <View style={sc.ratingRow}>
              {[1, 2, 3, 4, 5].map(i => (
                <Ionicons
                  key={i}
                  name={i <= Math.round(rating) ? 'star' : 'star-outline'}
                  size={12}
                  color={i <= Math.round(rating) ? Colors.star : Colors.muted}
                />
              ))}
              <Text style={sc.ratingText}>{rating.toFixed(1)} ({votes})</Text>
            </View>
          )}

          {/* Badges: visibilité + membres + distance + rejoindre/quitter */}
          <View style={sc.metaBadgesRow}>
            {item.is_public === false && (
              <View style={sc.badge}>
                <Ionicons name="eye-off-outline" size={10} color={Colors.muted} />
                <Text style={sc.badgeText}>Masqué</Text>
              </View>
            )}
            <TouchableOpacity
              style={[sc.membersChip, isLive && sc.membersChipLive]}
              onPress={handleViewMembers}
              testID={`members-chip-${item.point_id}`}
            >
              {isLive ? <PulseDot /> : <Ionicons name="people-outline" size={11} color={Colors.primary} />}
              <Text style={sc.membersChipText}>
                {Math.max(item.participants_count || 0, 1)} membre{Math.max(item.participants_count || 0, 1) > 1 ? 's' : ''}
              </Text>
              <Ionicons name="chevron-forward" size={10} color={Colors.primary} />
            </TouchableOpacity>
            {dist ? (
              <View style={sc.distChip}>
                <Ionicons name="navigate-outline" size={10} color={Colors.muted} />
                <Text style={sc.distChipText}>{dist}</Text>
              </View>
            ) : null}
            {onToggleJoin && (
              <TouchableOpacity
                style={[sc.joinChip, isMember && sc.leaveChip]}
                onPress={() => onToggleJoin(item)}
                disabled={joiningId === item.point_id}
                testID={`join-btn-${item.point_id}`}
              >
                {joiningId === item.point_id
                  ? <ActivityIndicator size="small" color={isMember ? '#EF4444' : Colors.background} style={{ width: 10, height: 10 }} />
                  : <>
                      <Ionicons
                        name={isMember ? 'exit-outline' : 'person-add-outline'}
                        size={11}
                        color={isMember ? '#EF4444' : Colors.background}
                      />
                      <Text style={[sc.joinChipText, isMember && sc.leaveChipText]}>
                        {isMember ? 'Quitter' : 'Rejoindre'}
                      </Text>
                    </>
                }
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Section événement — prochaine date + bouton */}
      {(nextLabel || past) && (
        <View style={sc.eventSection}>
          <View style={sc.eventDateRow}>
            <View style={[sc.eventIconBox, past && { backgroundColor: Colors.border + '40' }]}>
              <Ionicons
                name={isRecurring ? 'repeat' : 'calendar'}
                size={15}
                color={past ? Colors.muted : Colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[sc.eventLabel, past && { color: Colors.muted }]}>
                  {past ? 'Événement passé' : 'Prochain événement'}
                </Text>
                {isRecurring && !past && (
                  <View style={sc.recurBadge}>
                    <Text style={sc.recurBadgeText}>Récurrent</Text>
                  </View>
                )}
              </View>
              <Text style={[sc.eventDate, past && { color: Colors.muted }]}>{nextLabel}</Text>
            </View>
          </View>

          {past ? (
            <View style={[sc.actionBar, { justifyContent: 'flex-start', gap: 6 }]}>
              <Ionicons name="time-outline" size={12} color={Colors.muted} />
              <Text style={sc.pastText}>
                Terminé · {new Date(item.event_date || '').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
            </View>
          ) : canParticipate ? (
            <View style={sc.actionBar}>
              <View style={[sc.participantChip, isLive && sc.participantChipLive]}>
                {isLive ? <PulseDot /> : <Ionicons name="people-outline" size={13} color={Colors.primary} />}
                <Text style={sc.participantChipText}>
                  {goingCount} participant{goingCount > 1 ? 's' : ''}{maxP ? ` / ${maxP}` : ''}
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  sc.goingBtn,
                  isGoing && sc.goingBtnActive,
                  (isFull && !isGoing) && sc.goingBtnFull,
                ]}
                onPress={() => (!isFull || isGoing) ? onToggleGoing(item) : null}
                disabled={isLoading || (isFull && !isGoing)}
                testID={`going-btn-${item.point_id}`}
              >
                {isLoading
                  ? <ActivityIndicator size="small" color={isGoing ? Colors.muted : Colors.background} />
                  : (isFull && !isGoing)
                    ? <>
                        <Ionicons name="flash" size={12} color="#F59E0B" />
                        <Text style={[sc.goingBtnText, { color: '#F59E0B' }]}>Complet</Text>
                      </>
                    : <>
                        <Ionicons
                          name={isGoing ? 'close-circle-outline' : 'add-circle-outline'}
                          size={12}
                          color={isGoing ? Colors.muted : Colors.background}
                        />
                        <Text style={[sc.goingBtnText, isGoing && sc.goingBtnCancelText]}>
                          {isGoing ? 'Annuler' : 'Je participe'}
                        </Text>
                      </>
                }
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

export const sc = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  headerActionOverlay: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 10,
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

  membersChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primary + '12',
    borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  membersChipLive: {
    borderColor: '#00E676' + '60',
    backgroundColor: '#00E676' + '10',
  },
  membersChipText: { fontSize: 11, fontWeight: '600', color: Colors.primary },
  pulseDot: {
    width: 7, height: 7,
    borderRadius: 4,
    backgroundColor: '#00E676',
  },

  eventSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  eventDateRow: {
    flexDirection: 'row', alignItems: 'center',
    gap: Spacing.sm, marginBottom: 4,
  },
  eventIconBox: {
    width: 30, height: 30, borderRadius: Radius.sm,
    backgroundColor: Colors.primary + '12',
    alignItems: 'center', justifyContent: 'center',
  },
  eventLabel: { fontSize: 11, fontWeight: '600', color: Colors.foreground, marginBottom: 1 },
  eventDate: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  recurBadge: {
    backgroundColor: Colors.primary + '15', borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  recurBadgeText: { fontSize: 9, fontWeight: '600', color: Colors.primary },

  actionBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 38, paddingTop: 0,
  },
  participantChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary + '12',
    borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  participantChipLive: {
    borderColor: '#00E676' + '60',
    backgroundColor: '#00E676' + '10',
  },
  participantChipText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
  goingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: Radius.full,
  },
  goingBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.border },
  goingBtnFull: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#F59E0B' },
  goingBtnText: { fontSize: 12, fontWeight: '700', color: Colors.background },
  goingBtnCancelText: { color: Colors.muted },
  pastText: { fontSize: 11, color: Colors.muted, fontStyle: 'italic' },
  distChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.background,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 1, borderColor: Colors.border,
  },
  distChipText: { fontSize: 10, color: Colors.muted, fontWeight: '600' },

  // ── Rejoindre / Quitter (chip inline) ───────────────────────────────────
  joinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primary,
    borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: Colors.primary,
  },
  leaveChip: {
    backgroundColor: 'transparent',
    borderColor: '#EF4444',
  },
  joinChipText: { fontSize: 11, fontWeight: '700', color: Colors.background },
  leaveChipText: { color: '#EF4444' },
});
