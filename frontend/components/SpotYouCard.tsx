/**
 * SpotYouCard — Composant partagé de carte SpotYou
 * Utilisé dans : spot-me.tsx (Mes SpotMe), saved.tsx (Enregistrés)
 */
import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';

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
}

export function SpotYouCard({
  item,
  onNavigate,
  onToggleGoing,
  togglingId,
  onViewMembers,
  testID,
  headerAction,
}: SpotYouCardProps) {
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
            <Image source={{ uri: item.images[0] }} style={sc.thumb} />
          ) : (
            <View style={[sc.thumb, sc.thumbPlaceholder]}>
              <Ionicons name="location-outline" size={24} color={Colors.muted} />
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

          {/* Badges: visibilité + membres */}
          <View style={sc.metaBadgesRow}>
            {item.is_public === false && (
              <View style={sc.badge}>
                <Ionicons name="eye-off-outline" size={10} color={Colors.muted} />
                <Text style={sc.badgeText}>Masqué</Text>
              </View>
            )}
            <TouchableOpacity
              style={sc.membersChip}
              onPress={handleViewMembers}
              testID={`members-chip-${item.point_id}`}
            >
              <Ionicons name="people-outline" size={11} color={Colors.primary} />
              <Text style={sc.membersChipText}>
                {Math.max(item.participants_count || 0, 1)} membre{Math.max(item.participants_count || 0, 1) > 1 ? 's' : ''}
              </Text>
              <Ionicons name="chevron-forward" size={10} color={Colors.primary} />
            </TouchableOpacity>
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
          ) : (
            <View style={sc.actionBar}>
              <View style={sc.participantChip}>
                <Ionicons name="people-outline" size={13} color={Colors.primary} />
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
                  ? <ActivityIndicator size="small" color={isGoing ? Colors.primary : Colors.background} />
                  : (isFull && !isGoing)
                    ? <>
                        <Ionicons name="flash" size={12} color="#F59E0B" />
                        <Text style={[sc.goingBtnText, { color: '#F59E0B' }]}>Complet</Text>
                      </>
                    : <>
                        <Ionicons
                          name={isGoing ? 'checkmark-circle' : 'add-circle-outline'}
                          size={12}
                          color={isGoing ? Colors.primary : Colors.background}
                        />
                        <Text style={[sc.goingBtnText, isGoing && { color: Colors.primary }]}>
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
  membersChipText: { fontSize: 11, fontWeight: '600', color: Colors.primary },

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
});
