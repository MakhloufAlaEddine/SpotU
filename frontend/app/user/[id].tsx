import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Linking, Dimensions, Platform, Animated, RefreshControl,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { ErrorNoData } from '../../components/OfflineBanner';
import { ScreenLoader } from '../../components/ScreenLoader';
import { FollowListModal } from '../../components/FollowListModal';

// ── Extracted components ──
import { computeBadge, COVER_H, COVER_IMG_H, MAX_OFFSET_PX, TEAL_DIM, TEAL_BORDER } from '../../components/profile/profileUtils';
import { ProfileHero } from '../../components/profile/ProfileHero';
import { ProfileServicesCarousel } from '../../components/profile/ProfileServicesCarousel';
import { ProfileSpotYouSection } from '../../components/profile/ProfileSpotYouSection';
import { ProfileReviews } from '../../components/profile/ProfileReviews';
import { CoverRepositionModal } from '../../components/profile/CoverRepositionModal';
import { ProfileCompletionBar } from '../../components/profile/ProfileCompletionBar';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

const SCREEN_W = Dimensions.get('window').width;

export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useGuardedRouter();
  const { user: me, token } = useAuth();

  // ── State ──
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<any[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);
  const [myReview, setMyReview] = useState<any>(null);
  const [editingReview, setEditingReview] = useState(false);
  const [myRating, setMyRating] = useState(0);
  const [myComment, setMyComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hasBooking, setHasBooking] = useState(false);
  const [isCommunityMember, setIsCommunityMember] = useState(false);
  const [hasParticipation, setHasParticipation] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);
  const [showFollowModal, setShowFollowModal] = useState(false);
  const [followModalTab, setFollowModalTab] = useState<'followers' | 'following' | 'suggestions'>('followers');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await load(); } finally { setRefreshing(false); }
  }, [id]);
  const [coverOffsetY, setCoverOffsetY] = useState(0.5);
  const [coverScale, setCoverScale] = useState(1.0);
  const [repositioning, setRepositioning] = useState(false);
  const [savingOffset, setSavingOffset] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  // ── Animated values ──
  const repoTopAnim = useRef(new Animated.Value(-MAX_OFFSET_PX * 0.5)).current;
  const repoScaleAnim = useRef(new Animated.Value(1.0)).current;
  const animImgWidth = useRef(Animated.multiply(repoScaleAnim, SCREEN_W)).current;
  const animImgHeight = useRef(Animated.multiply(repoScaleAnim, COVER_IMG_H)).current;
  const animImgLeft = useRef(Animated.multiply(Animated.subtract(1, repoScaleAnim), SCREEN_W / 2)).current;
  const repoTopRef = useRef(-MAX_OFFSET_PX * 0.5);
  const repoScaleRef = useRef(1.0);

  // ── Data loading ──
  useFocusEffect(
    useCallback(() => {
      if (id) { setLoading(true); load(); }
      if (me?.user_id && me.user_id === id) {
        api.get<any[]>('/bookings/me').then(b => setHasBooking(Array.isArray(b) && b.length > 0)).catch(() => {});
        api.get<{ is_community_member: boolean; has_participation: boolean }>('/spot-you/my-completion-stats')
          .then(s => { setIsCommunityMember(s.is_community_member); setHasParticipation(s.has_participation); }).catch(() => {});
      }
    }, [id, me?.user_id])
  );

  React.useEffect(() => {
    if (me && reviews.length > 0 && !myReview) {
      const mine = reviews.find((r: any) => r.reviewer_id === me.user_id);
      if (mine) { setMyReview(mine); setMyRating(mine.rating); setMyComment(mine.comment || ''); }
    }
  }, [me?.user_id, reviews]);

  const load = async () => {
    try {
      const data = await api.get(`/users/${id}/public`);
      setProfile(data);
      setIsFollowing(data.is_following ?? false);
      setFollowersCount(data.followers_count ?? 0);
      setFollowingCount(data.following_count ?? 0);
      const offsetY = data.cover_offset_y ?? 0.5;
      const scale = data.cover_scale ?? 1.0;
      setCoverOffsetY(offsetY); setCoverScale(scale);
      const initTop = -(offsetY * (COVER_IMG_H * scale - COVER_H));
      repoTopAnim.setValue(initTop); repoScaleAnim.setValue(scale);
      repoTopRef.current = initTop; repoScaleRef.current = scale;
      if (data.show_reviews) await loadReviews();
    } catch {} finally { setLoading(false); }
  };

  const loadReviews = async () => {
    setReviewsLoading(true);
    try {
      const data: any[] = await api.get(`/users/${id}/reviews`) || [];
      setReviews(data);
      if (me) {
        const mine = data.find(r => r.reviewer_id === me.user_id);
        if (mine) { setMyReview(mine); setMyRating(mine.rating); setMyComment(mine.comment || ''); }
        else setMyReview(null);
      }
    } catch {} finally { setReviewsLoading(false); }
  };

  // ── Actions ──
  const handleFollow = async () => {
    if (!me || followLoading) return;
    setFollowLoading(true);
    try {
      if (isFollowing) {
        const r = await api.delete(`/users/${id}/follow`);
        setIsFollowing(false);
        setFollowersCount(r.followers_count ?? Math.max(0, followersCount - 1));
      } else {
        const r = await api.post(`/users/${id}/follow`, {});
        setIsFollowing(true);
        setFollowersCount(r.followers_count ?? followersCount + 1);
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de mettre à jour le suivi.');
    } finally { setFollowLoading(false); }
  };

  const handleCoverEdit = () => {
    if (profile?.cover_picture) {
      Alert.alert('Photo de couverture', 'Que souhaitez-vous faire ?', [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Repositionner', onPress: openReposition },
        { text: 'Changer la photo', onPress: pickAndUploadCover },
      ]);
    } else { pickAndUploadCover(); }
  };

  const openReposition = () => {
    const offset = coverOffsetY ?? 0.5;
    const scale = coverScale ?? 1.0;
    const initTop = -(offset * (COVER_IMG_H * scale - COVER_H));
    repoTopAnim.setValue(initTop); repoScaleAnim.setValue(scale);
    repoTopRef.current = initTop; repoScaleRef.current = scale;
    setRepositioning(true);
  };

  const cancelReposition = () => {
    const offset = coverOffsetY ?? 0.5;
    const scale = coverScale ?? 1.0;
    const savedTop = -(offset * (COVER_IMG_H * scale - COVER_H));
    repoTopAnim.setValue(savedTop); repoScaleAnim.setValue(scale);
    repoTopRef.current = savedTop; repoScaleRef.current = scale;
    setRepositioning(false);
  };

  const saveReposition = async () => {
    const currentTop = (repoTopAnim as any)._value;
    const currentScale = (repoScaleAnim as any)._value;
    const maxDrag = COVER_IMG_H * currentScale - COVER_H;
    const newOffsetY = maxDrag > 0 ? Math.max(0, Math.min(1, -currentTop / maxDrag)) : 0.5;
    setSavingOffset(true);
    try {
      await api.patch(`/users/${id}/cover`, { cover_picture: profile.cover_picture, cover_offset_y: newOffsetY, cover_scale: currentScale });
      setCoverOffsetY(newOffsetY); setCoverScale(currentScale);
      setProfile((prev: any) => ({ ...prev, cover_offset_y: newOffsetY, cover_scale: currentScale }));
    } catch { Alert.alert('Erreur', 'Impossible de sauvegarder le cadrage.'); }
    finally { setSavingOffset(false); setRepositioning(false); }
  };

  const pickAndUploadCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', 'Accès à la galerie nécessaire.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [16, 9] });
    if (result.canceled || !result.assets?.length) return;
    setUploadingCover(true);
    try {
      const asset = result.assets[0];
      const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
      const filename = asset.uri.split('/').pop() || 'cover.jpg';
      const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic' };
      const mimeType = mimeMap[ext] || 'image/jpeg';
      let uploadUrl = '';
      if (Platform.OS === 'web') {
        const blobRes = await fetch(asset.uri); const blob = await blobRes.blob();
        const file = new File([blob], `cover.${ext}`, { type: blob.type || mimeType });
        const formData = new FormData(); formData.append('file', file);
        const res = await fetch(`${BASE_URL}/api/upload-image?category=profiles`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
        if (!res.ok) throw new Error('Upload échoué');
        uploadUrl = (await res.json()).url;
      } else {
        const form = new FormData(); form.append('file', { uri: asset.uri, name: `cover.${ext}`, type: mimeType } as any);
        const res = await fetch(`${BASE_URL}/api/upload-image?category=profiles`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        if (!res.ok) throw new Error('Upload échoué');
        uploadUrl = (await res.json()).url;
      }
      await api.patch(`/users/${id}/cover`, { cover_picture: uploadUrl, cover_offset_y: 0.5, cover_scale: 1.0 });
      setCoverOffsetY(0.5); setCoverScale(1.0);
      const initTop = -(0.5 * (COVER_IMG_H - COVER_H));
      repoTopAnim.setValue(initTop); repoScaleAnim.setValue(1.0);
      repoTopRef.current = initTop; repoScaleRef.current = 1.0;
      setProfile((prev: any) => ({ ...prev, cover_picture: uploadUrl, cover_offset_y: 0.5, cover_scale: 1.0 }));
      setTimeout(() => {
        Alert.alert('Photo uploadée !', 'Voulez-vous ajuster le cadrage ?', [
          { text: 'Non', style: 'cancel' },
          { text: 'Repositionner', onPress: () => setRepositioning(true) },
        ]);
      }, 400);
    } catch (e: any) { Alert.alert('Erreur', e.message || 'Impossible d\'uploader la photo.'); }
    finally { setUploadingCover(false); }
  };

  const handleSubmitReview = async () => {
    if (myRating === 0) { Alert.alert('Note requise', 'Sélectionnez 1 à 5 étoiles.'); return; }
    setSubmitting(true);
    try {
      let updated: any;
      if (myReview) {
        updated = await api.put(`/users/${id}/reviews/${myReview.review_id}`, { rating: myRating, comment: myComment.trim() || null });
        setReviews(prev => prev.map(r => r.review_id === updated.review_id ? updated : r));
      } else {
        updated = await api.post(`/users/${id}/reviews`, { rating: myRating, comment: myComment.trim() || null });
        setReviews(prev => [updated, ...prev]);
      }
      setMyReview(updated); setEditingReview(false);
      Alert.alert('Merci !', myReview ? 'Avis mis à jour.' : 'Avis publié !');
    } catch (e: any) { Alert.alert('Erreur', e.message || 'Impossible de publier votre avis.'); }
    finally { setSubmitting(false); }
  };

  const handleToggleGoing = async (item: any) => {
    if (!me) return;
    setTogglingId(item.point_id);
    try {
      const wasGoing = item.is_going;
      if (wasGoing) await api.delete(`/spot-you/${item.point_id}/going`);
      else await api.post(`/spot-you/${item.point_id}/going`, {});
      setProfile((prev: any) => ({
        ...prev,
        tag_points: prev.tag_points.map((tp: any) =>
          tp.point_id === item.point_id
            ? { ...tp, is_going: !wasGoing, going_count: tp.going_count + (wasGoing ? -1 : 1) }
            : tp
        ),
      }));
    } catch (e: any) { Alert.alert('Erreur', e.message || 'Erreur participation.'); }
    finally { setTogglingId(null); }
  };

  // ── Loading / Error states ──
  if (loading) return <ScreenLoader />;
  if (!profile) {
    return (
      <SafeAreaView style={[st.safe, { backgroundColor: '#0D1117' }]} edges={['top', 'bottom']}>
        <ErrorNoData
          onRetry={load}
          onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map' as any)}
          testID="user-profile-not-found"
        />
      </SafeAreaView>
    );
  }

  // ── Derived values ──
  const isCoach = profile.role === 'coach';
  const SpotYou: any[] = profile.tag_points || [];
  const services: any[] = profile.services || [];
  const interests: any[] = profile.interests || [];
  const isOwnProfile = me && me.user_id === id;
  const canWriteNewReview = me && !isOwnProfile && profile.show_reviews && !myReview;
  const canEditReview = me && !isOwnProfile && myReview && editingReview;
  const avgRating = reviews.length > 0
    ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
    : null;
  const badge = computeBadge(avgRating, reviews.length);

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* Header */}
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
          : <View style={{ width: 40 }} />}
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        <ProfileHero
          profile={profile} isOwnProfile={!!isOwnProfile} isCoach={isCoach}
          me={me} badge={badge} avgRating={avgRating} reviewsCount={reviews.length}
          isFollowing={isFollowing} followLoading={followLoading}
          followersCount={followersCount} followingCount={followingCount}
          spotYouCount={SpotYou.length} uploadingCover={uploadingCover}
          animImgWidth={animImgWidth} animImgHeight={animImgHeight}
          animImgLeft={animImgLeft} repoTopAnim={repoTopAnim}
          onFollow={handleFollow} onCoverEdit={handleCoverEdit}
          onFollowersPress={() => { setFollowModalTab('followers'); setShowFollowModal(true); }}
          onFollowingPress={() => { setFollowModalTab('following'); setShowFollowModal(true); }}
        />

        {/* Phone */}
        {profile.phone ? (
          <TouchableOpacity style={st.infoRow}
            onPress={() => { const url = `tel:${profile.phone.replace(/\s/g, '')}`; Linking.canOpenURL(url).then(ok => ok ? Linking.openURL(url) : Alert.alert('Impossible', 'Appels non supportés.')); }}
            activeOpacity={0.75} testID="phone-call-btn">
            <View style={st.infoIcon}><Ionicons name="call-outline" size={15} color={Colors.primary} /></View>
            <Text style={st.infoText}>{profile.phone}</Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
          </TouchableOpacity>
        ) : null}

        {/* Interests */}
        {interests.length > 0 && (
          <View style={st.section} testID="interests-section">
            <View style={st.sectionHeader}>
              <View style={st.sectionAccent} />
              <Ionicons name="heart-outline" size={14} color={Colors.primary} />
              <Text style={st.sectionTitle}>{isCoach ? 'Spécialisations' : "Centres d'intérêt"}</Text>
            </View>
            <View style={st.tagsRow}>
              {interests.map((tag: any) => (
                <View key={tag.tag_id} style={st.tagChip} testID={`interest-${tag.tag_id}`}>
                  {tag.icon ? <Text style={{ fontSize: 14 }}>{tag.icon}</Text> : null}
                  <Text style={st.tagText}>{tag.label_fr || tag.label_en}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Completion bar */}
        {isOwnProfile && (
          <ProfileCompletionBar
            profile={profile} spotYouCount={SpotYou.length} interests={interests}
            hasBooking={hasBooking} isCommunityMember={isCommunityMember} hasParticipation={hasParticipation}
            onEditProfile={() => router.push('/edit-profile' as any)}
            onCreateSpotYou={() => router.push('/(tabs)/create' as any)}
            onExplore={() => router.push('/(tabs)/search' as any)}
          />
        )}

        {/* Services */}
        {isCoach && (
          <ProfileServicesCarousel
            services={services} me={me} profileUserId={profile.user_id}
            onNavigate={(sid) => router.push(`/service/${sid}` as any)}
          />
        )}

        {/* SpotYou */}
        <ProfileSpotYouSection
          spotYou={SpotYou} isOwnProfile={!!isOwnProfile} me={me}
          togglingId={togglingId} onToggleGoing={handleToggleGoing}
          onNavigate={(pid) => router.push(`/spot-you/${pid}` as any)}
          onCreateSpotYou={() => router.push('/(tabs)/create' as any)}
        />

        {/* Reviews */}
        {profile.show_reviews && (
          <ProfileReviews
            reviews={reviews} myReview={myReview} editingReview={editingReview}
            myRating={myRating} myComment={myComment} submitting={submitting}
            isOwnProfile={!!isOwnProfile} canWriteNewReview={!!canWriteNewReview}
            canEditReview={!!canEditReview} avgRating={avgRating} showAllReviews={showAllReviews}
            onSetMyRating={setMyRating} onSetMyComment={setMyComment}
            onSubmitReview={handleSubmitReview}
            onEditReview={() => { setEditingReview(true); setMyRating(myReview.rating); setMyComment(myReview.comment || ''); }}
            onCancelEdit={() => { setEditingReview(false); setMyRating(myReview?.rating || 0); setMyComment(myReview?.comment || ''); }}
            onToggleShowAll={() => setShowAllReviews(v => !v)}
          />
        )}

        <View style={{ height: 32 }} />
      </ScrollView>

      {/* Modals */}
      <CoverRepositionModal
        visible={repositioning} coverUri={profile.cover_picture} saving={savingOffset}
        animImgWidth={animImgWidth} animImgHeight={animImgHeight}
        animImgLeft={animImgLeft} repoTopAnim={repoTopAnim} repoScaleAnim={repoScaleAnim}
        repoTopRef={repoTopRef} repoScaleRef={repoScaleRef}
        onSave={saveReposition} onCancel={cancelReposition}
      />

      <FollowListModal
        visible={showFollowModal} onClose={() => setShowFollowModal(false)}
        profileId={id} meId={me?.user_id ?? null} initialTab={followModalTab}
        followersCount={followersCount} followingCount={followingCount} isOwnProfile={!!isOwnProfile}
        onFollowersCountChange={(delta) => setFollowersCount(prev => Math.max(0, prev + delta))}
        onFollowingCountChange={(delta) => setFollowingCount(prev => Math.max(0, prev + delta))}
      />
    </SafeAreaView>
  );
}

// ── Styles (minimal — hero/reviews/services/spotyou styles moved to components) ──
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  editBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: TEAL_DIM, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: TEAL_BORDER,
  },
  editBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
  scroll: { paddingBottom: 40 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border,
  },
  infoIcon: { width: 30, height: 30, borderRadius: 8, backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center' },
  infoText: { fontSize: 14, fontWeight: '600', color: Colors.foreground, flex: 1 },
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionAccent: { width: 3, height: 16, borderRadius: 2, backgroundColor: Colors.primary },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 1.2 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: TEAL_DIM, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: TEAL_BORDER,
  },
  tagText: { fontSize: 12, fontWeight: '600', color: Colors.primary },
});
