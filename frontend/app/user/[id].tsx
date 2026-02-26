import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

function formatScheduleShort(tp: any): string {
  if (tp.event_date) {
    const d = new Date(tp.event_date);
    const today = new Date();
    const eventDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diff = Math.round((eventDay.getTime() - todayDay.getTime()) / 86400000);
    const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return `Aujourd'hui à ${time}`;
    if (diff === 1) return `Demain à ${time}`;
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ` à ${time}`;
  }
  if (tp.event_schedule) {
    const s = typeof tp.event_schedule === 'string' ? JSON.parse(tp.event_schedule) : tp.event_schedule;
    if (s?.schedule) {
      const days = Object.keys(s.schedule);
      return `Récurrent · ${days.length} jour${days.length > 1 ? 's' : ''}`;
    }
    if (s?.day !== undefined) return 'Récurrent';
  }
  return 'Sans date fixe';
}

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: me } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) load();
  }, [id]);

  const load = async () => {
    try {
      const data = await api.get(`/users/${id}/public`);
      setProfile(data);
    } catch {
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={st.center}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={st.center}>
        <Text style={st.notFound}>Profil introuvable</Text>
      </View>
    );
  }

  const isCoach = profile.role === 'coach';
  const tagPoints: any[] = profile.tag_points || [];
  const services: any[] = profile.services || [];

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map' as any)}
          style={st.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Profil</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar + identité */}
        <View style={st.hero} testID="user-profile-hero">
          <View style={st.avatarWrap}>
            {profile.picture
              ? <Image source={{ uri: profile.picture }} style={st.avatarImg} />
              : <View style={st.avatarPlaceholder}>
                  <Text style={st.avatarInitial}>{profile.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                </View>
            }
            {isCoach && profile.is_coach_verified && (
              <View style={st.verifiedDot}>
                <Ionicons name="checkmark" size={10} color={Colors.background} />
              </View>
            )}
          </View>

          <Text style={st.name} testID="user-profile-name">{profile.name}</Text>

          <View style={st.badgeRow}>
            <View style={[st.roleBadge, isCoach && st.roleBadgeCoach]}>
              <Ionicons name={isCoach ? 'trophy-outline' : 'person-outline'} size={12}
                color={isCoach ? Colors.primary : Colors.muted} />
              <Text style={[st.roleBadgeText, isCoach && { color: Colors.primary }]}>
                {isCoach ? 'Coach' : 'Membre'}
              </Text>
            </View>
            {profile.avg_rating != null && (
              <View style={st.ratingBadge}>
                <Ionicons name="star" size={12} color={Colors.star} />
                <Text style={st.ratingText}>{profile.avg_rating} ({profile.review_count})</Text>
              </View>
            )}
          </View>

          {profile.bio ? (
            <Text style={st.bio}>{profile.bio}</Text>
          ) : null}
        </View>

        {/* TagPoints */}
        {tagPoints.length > 0 && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>
              <Ionicons name="location-outline" size={15} color={Colors.primary} />
              {'  '}TagPoints publiés
            </Text>
            <View style={st.tpList}>
              {tagPoints.map((tp: any) => {
                const thumb = (tp.images as string[] | null)?.[0];
                return (
                  <TouchableOpacity key={tp.point_id} style={st.tpCard}
                    onPress={() => router.push(`/tag-point/${tp.point_id}` as any)}
                    testID={`tp-card-${tp.point_id}`} activeOpacity={0.75}>
                    {thumb
                      ? <Image source={{ uri: thumb }} style={st.tpThumb} />
                      : <View style={[st.tpThumb, st.tpThumbPlaceholder]}>
                          <Ionicons name="image-outline" size={22} color={Colors.muted} />
                        </View>
                    }
                    <View style={st.tpInfo}>
                      <Text style={st.tpTitle} numberOfLines={1}>{tp.title}</Text>
                      <Text style={st.tpDate} numberOfLines={1}>{formatScheduleShort(tp)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {tagPoints.length === 0 && (
          <View style={st.emptyState}>
            <Ionicons name="location-outline" size={32} color={Colors.muted} />
            <Text style={st.emptyText}>Aucun tagPoint public</Text>
          </View>
        )}

        {/* Services (coach uniquement) */}
        {isCoach && services.length > 0 && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>
              <Ionicons name="briefcase-outline" size={15} color={Colors.primary} />
              {'  '}Services proposés
            </Text>
            {services.map((svc: any) => (
              <View key={svc.service_id} style={st.serviceCard}>
                <Text style={st.serviceTitle}>{svc.title}</Text>
                {svc.description && <Text style={st.serviceDesc} numberOfLines={2}>{svc.description}</Text>}
                <View style={st.serviceStats}>
                  <View style={st.stat}>
                    <Text style={st.statVal}>{svc.price}€</Text>
                    <Text style={st.statLbl}>Prix</Text>
                  </View>
                  <View style={st.statDivider} />
                  <View style={st.stat}>
                    <Text style={st.statVal}>{svc.duration_min}min</Text>
                    <Text style={st.statLbl}>Durée</Text>
                  </View>
                  <View style={st.statDivider} />
                  <View style={st.stat}>
                    <Text style={st.statVal}>{svc.max_participants}</Text>
                    <Text style={st.statLbl}>Places</Text>
                  </View>
                </View>
                {me && me.user_id !== profile.user_id && (
                  <TouchableOpacity style={st.bookBtn}
                    onPress={() => router.push(`/coach/${profile.user_id}?service_id=${svc.service_id}` as any)}
                    testID={`book-service-${svc.service_id}`}>
                    <Ionicons name="calendar" size={16} color={Colors.background} />
                    <Text style={st.bookBtnText}>Réserver · {svc.price}€</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  notFound: { fontSize: 16, color: Colors.muted },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  scroll: { paddingBottom: 20 },
  hero: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  avatarWrap: { position: 'relative', marginBottom: Spacing.md },
  avatarImg: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: Colors.primary },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.primary,
  },
  avatarInitial: { fontSize: 38, fontWeight: '800', color: Colors.primary },
  verifiedDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: 10 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.secondary, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  roleBadgeCoach: { backgroundColor: Colors.primaryLight },
  roleBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.secondary, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  ratingText: { fontSize: 12, fontWeight: '600', color: Colors.foreground },
  bio: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 300, marginTop: 6 },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: 12 },
  tpList: { gap: 8 },
  tpCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.secondary, borderRadius: Radius.lg,
    padding: 10, ...Shadow.soft,
  },
  tpThumb: { width: 56, height: 56, borderRadius: Radius.md },
  tpThumbPlaceholder: { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  tpInfo: { flex: 1 },
  tpTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 3 },
  tpDate: { fontSize: 12, color: Colors.primary },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.muted },
  serviceCard: {
    backgroundColor: Colors.secondary, borderRadius: Radius.xl,
    padding: Spacing.md, marginBottom: Spacing.sm, ...Shadow.soft,
  },
  serviceTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, marginBottom: 4 },
  serviceDesc: { fontSize: 13, color: Colors.muted, marginBottom: Spacing.sm, lineHeight: 18 },
  serviceStats: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  statLbl: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  bookBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingVertical: 12, marginTop: 6,
  },
  bookBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
