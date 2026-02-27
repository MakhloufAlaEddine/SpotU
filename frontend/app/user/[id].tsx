import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, TextInput, Alert, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

const TEAL_DIM = 'rgba(0,191,165,0.12)';
const TEAL_BORDER = 'rgba(0,191,165,0.3)';

// ── Badge logic ───────────────────────────────────────────────────────────────
type Badge = { label: string; color: string; bg: string; icon: string };
function computeBadge(avg: number | null, count: number): Badge | null {
  if (!avg || count === 0 || avg < 3.5) return null;
  if (avg >= 4.8 && count >= 10) return { label: 'Elite', color: '#FFD700', bg: 'rgba(255,215,0,0.15)', icon: 'diamond' };
  if (avg >= 4.5 && count >= 5)  return { label: 'Top Joueur', color: '#FFD700', bg: 'rgba(255,215,0,0.12)', icon: 'trophy' };
  if (avg >= 4.0 && count >= 3)  return { label: 'Très Apprécié', color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)', icon: 'star' };
  return { label: 'Bien Noté', color: '#CD7F32', bg: 'rgba(205,127,50,0.15)', icon: 'thumbs-up' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatScheduleShort(tp: any): string {
  if (tp.event_date) {
    const d = new Date(tp.event_date);
    const today = new Date();
    const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86400000);
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

function StarRow({ rating, size = 16, onPress }: { rating: number; size?: number; onPress?: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity key={n} onPress={() => onPress?.(n)} disabled={!onPress} activeOpacity={onPress ? 0.7 : 1}>
          <Ionicons
            name={n <= rating ? 'star' : 'star-outline'}
            size={size}
            color={n <= rating ? '#FFD700' : Colors.muted}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: me } = useAuth();

  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  // My review state
  const [myReview, setMyReview] = useState<any>(null);
  const [editingReview, setEditingReview] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reload every time the screen comes into focus (fix: data not updating after edit)
  useFocusEffect(
    useCallback(() => {
      if (id) {
        setLoading(true);
        load();
      }
    }, [id])
  );

  const load = async () => {
    try {
      const data = await api.get(`/users/${id}/public`);
      setProfile(data);
      if (data.show_reviews) await loadReviews();
    } catch {}
    finally { setLoading(false); }
  };

  const loadReviews = async () => {
    setReviewsLoading(true);
    try {
      const data: any[] = await api.get(`/users/${id}/reviews`) || [];
      setReviews(data);
      if (me) {
        const mine = data.find(r => r.reviewer_id === me.user_id);
        if (mine) {
          setMyReview(mine);
          setMyRating(mine.rating);
          setMyComment(mine.comment || '');
        } else {
          setMyReview(null);
        }
      }
    } catch {}
    finally { setReviewsLoading(false); }
  };

  const handleSubmitReview = async () => {
    if (myRating === 0) { Alert.alert('Note requise', 'Sélectionnez 1 à 5 étoiles.'); return; }
    setSubmitting(true);
    try {
      let updated: any;
      if (myReview) {
        // Edit existing review
        updated = await api.put(`/users/${id}/reviews/${myReview.review_id}`, {
          rating: myRating,
          comment: myComment.trim() || null,
        });
        setReviews(prev => prev.map(r => r.review_id === updated.review_id ? updated : r));
        setMyReview(updated);
      } else {
        // New review
        updated = await api.post(`/users/${id}/reviews`, {
          rating: myRating,
          comment: myComment.trim() || null,
        });
        setReviews(prev => [updated, ...prev]);
        setMyReview(updated);
      }
      setEditingReview(false);
      Alert.alert('Merci !', myReview ? 'Avis mis à jour.' : 'Avis publié !');
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de publier votre avis.');
    } finally { setSubmitting(false); }
  };

  const handleCallPhone = (phone: string) => {
    const url = `tel:${phone.replace(/\s/g, '')}`;
    Linking.canOpenURL(url).then(ok => {
      if (ok) Linking.openURL(url);
      else Alert.alert('Impossible', 'Votre appareil ne supporte pas les appels.');
    });
  };

  if (loading) {
    return <View style={st.center}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }
  if (!profile) {
    return <View style={st.center}><Text style={st.notFound}>Profil introuvable</Text></View>;
  }

  const isCoach = profile.role === 'coach';
  const tagPoints: any[] = profile.tag_points || [];
  const services: any[] = profile.services || [];
  const interests: any[] = profile.interests || [];
  const isOwnProfile = me && me.user_id === id;
  const canWriteNewReview = me && !isOwnProfile && profile.show_reviews && !myReview;
  const canEditReview = me && !isOwnProfile && myReview && editingReview;

  const avgRating = reviews.length > 0
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : null;

  const badge = computeBadge(avgRating, reviews.length);

  const REVIEWS_PREVIEW = 3;
  const displayedReviews = showAllReviews ? reviews : reviews.slice(0, REVIEWS_PREVIEW);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* ── Header ─────────────────────────────── */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map' as any)}
          style={st.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Profil</Text>
        {isOwnProfile
          ? <TouchableOpacity style={st.editBtn} onPress={() => router.push('/edit-profile' as any)} testID="edit-profile-btn">
              <Ionicons name="pencil-outline" size={15} color={Colors.primary} />
              <Text style={st.editBtnText}>Modifier</Text>
            </TouchableOpacity>
          : <View style={{ width: 40 }} />
        }
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>
        {/* ── HERO ─────────────────────────────── */}
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

            {/* ── Rating badge ── */}
            {avgRating != null && (
              <View style={st.ratingBadge} testID="rating-badge">
                <Ionicons name="star" size={12} color="#FFD700" />
                <Text style={st.ratingText}>{avgRating} ({reviews.length})</Text>
              </View>
            )}
          </View>

          {/* ── Achievement badge (only when positive) ── */}
          {badge && (
            <View style={[st.achievementBadge, { backgroundColor: badge.bg, borderColor: badge.color + '44' }]}
              testID="achievement-badge">
              <Ionicons name={badge.icon as any} size={13} color={badge.color} />
              <Text style={[st.achievementText, { color: badge.color }]}>{badge.label}</Text>
            </View>
          )}

          {profile.bio ? <Text style={st.bio}>{profile.bio}</Text> : null}
        </View>

        {/* ── TÉLÉPHONE ──────────────────────────── */}
        {profile.phone ? (
          <TouchableOpacity style={st.infoRow} onPress={() => handleCallPhone(profile.phone)}
            activeOpacity={0.75} testID="phone-call-btn">
            <View style={st.infoIcon}>
              <Ionicons name="call-outline" size={15} color={Colors.primary} />
            </View>
            <Text style={st.infoText}>{profile.phone}</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
          </TouchableOpacity>
        ) : null}

        {/* ── INTÉRÊTS ─────────────────────────── */}
        {interests.length > 0 && (
          <View style={st.section} testID="interests-section">
            <Text style={st.sectionTitle}>
              <Ionicons name="heart-outline" size={13} color={Colors.primary} />
              {'  '}{isCoach ? 'Spécialisations' : "Centres d'intérêt"}
            </Text>
            <View style={st.tagsRow}>
              {interests.map((tag: any) => (
                <View key={tag.tag_id} style={st.tagChip} testID={`interest-${tag.tag_id}`}>
                  {tag.icon ? <Text style={st.tagIcon}>{tag.icon}</Text> : null}
                  <Text style={st.tagText}>{tag.label_fr || tag.label_en}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── TAGPOINTS ──────────────────────────── */}
        {tagPoints.length > 0 && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>
              <Ionicons name="location-outline" size={13} color={Colors.primary} />
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

        {/* ── SERVICES (coach) ──────────────────── */}
        {isCoach && services.length > 0 && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>
              <Ionicons name="briefcase-outline" size={13} color={Colors.primary} />
              {'  '}Services proposés
            </Text>
            {services.map((svc: any) => (
              <View key={svc.service_id} style={st.serviceCard}>
                <Text style={st.serviceTitle}>{svc.title}</Text>
                {svc.description && <Text style={st.serviceDesc} numberOfLines={2}>{svc.description}</Text>}
                <View style={st.serviceStats}>
                  <View style={st.stat}><Text style={st.statVal}>{svc.price}€</Text><Text style={st.statLbl}>Prix</Text></View>
                  <View style={st.statDivider} />
                  <View style={st.stat}><Text style={st.statVal}>{svc.duration_min}min</Text><Text style={st.statLbl}>Durée</Text></View>
                  <View style={st.statDivider} />
                  <View style={st.stat}><Text style={st.statVal}>{svc.max_participants}</Text><Text style={st.statLbl}>Places</Text></View>
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

        {/* ── AVIS ──────────────────────────────── */}
        {profile.show_reviews && (
          <View style={st.section} testID="reviews-section">
            {/* Header */}
            <View style={st.reviewsHeader}>
              <Text style={st.sectionTitle}>
                <Ionicons name="star-outline" size={13} color={Colors.primary} />
                {'  '}Avis{reviews.length > 0 ? ` (${reviews.length})` : ''}
              </Text>
              {avgRating != null && (
                <View style={st.avgRatingRow}>
                  <StarRow rating={Math.round(avgRating)} size={13} />
                  <Text style={st.avgRatingText}>{avgRating}</Text>
                </View>
              )}
            </View>

            {/* ── New review form ── */}
            {(canWriteNewReview || canEditReview) && (
              <View style={st.reviewForm} testID="review-form">
                <Text style={st.reviewFormTitle}>
                  {myReview ? 'Modifier mon avis' : 'Laisser un avis'}
                </Text>
                <View style={st.starPicker}>
                  <StarRow rating={myRating} size={30} onPress={setMyRating} />
                </View>
                <TextInput
                  style={st.reviewInput}
                  value={myComment}
                  onChangeText={setMyComment}
                  placeholder="Partagez votre expérience... (optionnel)"
                  placeholderTextColor={Colors.muted}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  testID="review-comment-input"
                />
                <View style={st.reviewFormActions}>
                  {editingReview && (
                    <TouchableOpacity style={st.cancelBtn}
                      onPress={() => { setEditingReview(false); setMyRating(myReview?.rating || 0); setMyComment(myReview?.comment || ''); }}>
                      <Text style={st.cancelBtnText}>Annuler</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[st.submitBtn, submitting && st.submitBtnDisabled, editingReview && { flex: 1 }]}
                    onPress={handleSubmitReview}
                    disabled={submitting}
                    testID="submit-review-btn">
                    {submitting
                      ? <ActivityIndicator size="small" color={Colors.background} />
                      : <>
                          <Ionicons name="send" size={14} color={Colors.background} />
                          <Text style={st.submitBtnText}>{myReview ? 'Mettre à jour' : "Publier"}</Text>
                        </>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* ── "Mon avis" banner with edit button ── */}
            {myReview && !editingReview && !isOwnProfile && (
              <View style={st.myReviewBanner} testID="my-review-banner">
                <View style={{ flex: 1 }}>
                  <Text style={st.myReviewLabel}>Mon avis</Text>
                  <StarRow rating={myReview.rating} size={13} />
                  {myReview.comment ? <Text style={st.myReviewComment} numberOfLines={2}>{myReview.comment}</Text> : null}
                </View>
                <TouchableOpacity style={st.editReviewBtn}
                  onPress={() => { setEditingReview(true); setMyRating(myReview.rating); setMyComment(myReview.comment || ''); }}
                  testID="edit-review-btn">
                  <Ionicons name="pencil" size={13} color={Colors.primary} />
                  <Text style={st.editReviewBtnText}>Modifier</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Reviews list ── */}
            {reviewsLoading ? (
              <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 12 }} />
            ) : reviews.length === 0 ? (
              <View style={st.noReviews} testID="no-reviews">
                <Ionicons name="chatbubble-outline" size={24} color={Colors.muted} />
                <Text style={st.noReviewsText}>Aucun avis pour l'instant</Text>
              </View>
            ) : (
              <>
                {displayedReviews
                  .filter(r => !myReview || r.review_id !== myReview.review_id) // Don't double-show my review
                  .map((r: any) => (
                    <View key={r.review_id} style={st.reviewCard} testID={`review-${r.review_id}`}>
                      <View style={st.reviewHeader}>
                        <View style={st.reviewerInfo}>
                          {r.reviewer_picture
                            ? <Image source={{ uri: r.reviewer_picture }} style={st.reviewerAvatar} />
                            : <View style={st.reviewerAvatarPlaceholder}>
                                <Text style={st.reviewerInitial}>{r.reviewer_name?.charAt(0)?.toUpperCase() || '?'}</Text>
                              </View>
                          }
                          <View>
                            <Text style={st.reviewerName}>{r.reviewer_name}</Text>
                            <Text style={st.reviewDate}>
                              {new Date(r.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </Text>
                          </View>
                        </View>
                        <StarRow rating={r.rating} size={13} />
                      </View>
                      {r.comment ? <Text style={st.reviewComment}>{r.comment}</Text> : null}
                    </View>
                  ))
                }

                {/* Voir plus / Voir moins */}
                {reviews.length > REVIEWS_PREVIEW && (
                  <TouchableOpacity style={st.seeMoreBtn}
                    onPress={() => setShowAllReviews(v => !v)}
                    testID="see-more-reviews-btn">
                    <Text style={st.seeMoreText}>
                      {showAllReviews ? 'Voir moins' : `Voir les ${reviews.length - REVIEWS_PREVIEW} autres avis`}
                    </Text>
                    <Ionicons name={showAllReviews ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.primary} />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
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
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: TEAL_DIM, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  editBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  scroll: { paddingBottom: 20 },

  // Hero
  hero: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg },
  avatarWrap: { position: 'relative', marginBottom: Spacing.md },
  avatarImg: { width: 88, height: 88, borderRadius: 44, borderWidth: 2, borderColor: Colors.primary },
  avatarPlaceholder: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: TEAL_DIM,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary,
  },
  avatarInitial: { fontSize: 38, fontWeight: '800', color: Colors.primary },
  verifiedDot: {
    position: 'absolute', bottom: 2, right: 2, width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  name: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: 10 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.secondary, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  roleBadgeCoach: { backgroundColor: TEAL_DIM },
  roleBadgeText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,215,0,0.12)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
  },
  ratingText: { fontSize: 12, fontWeight: '600', color: '#FFD700' },
  achievementBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 1, marginBottom: 10,
  },
  achievementText: { fontSize: 13, fontWeight: '700' },
  bio: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20, maxWidth: 300, marginTop: 4 },

  // Info row (phone)
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  infoIcon: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center',
  },
  infoText: { fontSize: 14, fontWeight: '600', color: Colors.foreground, flex: 1 },

  // Section
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.primary, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.8 },

  // Interests
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: TEAL_DIM, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  tagIcon: { fontSize: 14 },
  tagText: { fontSize: 12, fontWeight: '600', color: Colors.primary },

  // TagPoints
  tpList: { gap: 8 },
  tpCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.secondary, borderRadius: Radius.lg, padding: 10,
  },
  tpThumb: { width: 56, height: 56, borderRadius: Radius.md },
  tpThumbPlaceholder: { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  tpInfo: { flex: 1 },
  tpTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 3 },
  tpDate: { fontSize: 12, color: Colors.primary },
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.muted },

  // Services
  serviceCard: { backgroundColor: Colors.secondary, borderRadius: Radius.xl, padding: Spacing.md, marginBottom: Spacing.sm },
  serviceTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, marginBottom: 4 },
  serviceDesc: { fontSize: 13, color: Colors.muted, marginBottom: Spacing.sm, lineHeight: 18 },
  serviceStats: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  stat: { flex: 1, alignItems: 'center' },
  statVal: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  statLbl: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  statDivider: { width: 1, height: 36, backgroundColor: Colors.border },
  bookBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 12, marginTop: 6,
  },
  bookBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },

  // Reviews
  reviewsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  avgRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  avgRatingText: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  reviewForm: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  reviewFormTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 12 },
  starPicker: { marginBottom: 12 },
  reviewInput: {
    backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, color: Colors.foreground, minHeight: 80, marginBottom: 12,
  },
  reviewFormActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    borderRadius: Radius.full, paddingVertical: 11, paddingHorizontal: 18,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  submitBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 12,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },

  // My review banner
  myReviewBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: TEAL_DIM, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: TEAL_BORDER, marginBottom: Spacing.sm,
  },
  myReviewLabel: { fontSize: 11, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  myReviewComment: { fontSize: 12, color: Colors.muted, marginTop: 4 },
  editReviewBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.background, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: TEAL_BORDER,
  },
  editReviewBtnText: { fontSize: 12, fontWeight: '700', color: Colors.primary },

  noReviews: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  noReviewsText: { fontSize: 13, color: Colors.muted },
  reviewCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border,
  },
  reviewHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  reviewerInfo: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  reviewerAvatar: { width: 36, height: 36, borderRadius: 18 },
  reviewerAvatarPlaceholder: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center',
  },
  reviewerInitial: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  reviewerName: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  reviewDate: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  reviewComment: { fontSize: 13, color: Colors.muted, lineHeight: 18 },
  seeMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.lg, borderWidth: 1, borderColor: TEAL_BORDER,
    backgroundColor: TEAL_DIM, marginTop: 4,
  },
  seeMoreText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
});
