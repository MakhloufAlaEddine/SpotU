import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Image, TextInput, Alert, Linking, Dimensions, Platform,
  Modal, PanResponder, Animated,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';
import { ErrorNoData } from '../../components/OfflineBanner';
import { UserAvatar } from '../../components/UserAvatar';
import { ScreenLoader } from '../../components/ScreenLoader';
import { SpotYouCard } from '../../components/SpotYouCard';
import { FollowListModal } from '../../components/FollowListModal';

// Cover photo dimensions
const COVER_H = 220;
const COVER_IMG_H = 380; // image taller than container for repositioning
const SCREEN_W = Dimensions.get('window').width;
const MAX_OFFSET_PX = COVER_IMG_H - COVER_H; // 160px of drag range

const CARD_WIDTH = SCREEN_W - 48;

const TEAL_DIM = 'rgba(0,191,165,0.12)';
const TEAL_BORDER = 'rgba(0,191,165,0.3)';

// ── Badge logic ───────────────────────────────────────────────────────────────
type Badge = { label: string; color: string; bg: string; icon: string };
function computeBadge(avg: number | null, count: number): Badge | null {
  if (!avg || count < 3 || avg < 3.5) return null;
  if (avg >= 4.8 && count >= 10) return { label: 'Elite',         color: '#FFD700', bg: 'rgba(255,215,0,0.15)',   icon: 'diamond' };
  if (avg >= 4.5 && count >= 5)  return { label: 'Top Joueur',    color: '#FFD700', bg: 'rgba(255,215,0,0.12)',   icon: 'trophy' };
  if (avg >= 4.0 && count >= 3)  return { label: 'Très Apprécié', color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)', icon: 'star' };
  return                                 { label: 'Bien Noté',     color: '#CD7F32', bg: 'rgba(205,127,50,0.15)',  icon: 'thumbs-up' };
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

// ─── Barre de complétion de profil ─────────────────────────────────────────

interface CompletionStep {
  id: string;
  label: string;
  icon: string;
  done: boolean;
  onPress: () => void;
}

function ProfileCompletionBar({ profile, spotYouCount, interests, hasBooking, isCommunityMember, hasParticipation, onEditProfile, onCreateSpotYou, onExplore }: {
  profile: any; spotYouCount: number; interests: any[]; hasBooking: boolean;
  isCommunityMember: boolean; hasParticipation: boolean;
  onEditProfile: () => void; onCreateSpotYou: () => void; onExplore: () => void;
}) {
  const steps: CompletionStep[] = [
    { id: 'photo',       label: 'Photo',                   icon: 'camera-outline',     done: !!profile.picture,      onPress: onEditProfile },
    { id: 'bio',         label: 'Bio',                     icon: 'text-outline',       done: !!profile.bio?.trim(),  onPress: onEditProfile },
    { id: 'interests',   label: "Centres d'intérêt",       icon: 'heart-outline',      done: interests.length > 0,   onPress: onEditProfile },
    { id: 'spotyou',     label: 'SpotYou',                 icon: 'location-outline',   done: spotYouCount > 0,       onPress: onCreateSpotYou },
    { id: 'booking',     label: 'Réservation',             icon: 'calendar-outline',   done: hasBooking,             onPress: onExplore },
    { id: 'community',   label: 'Communauté',              icon: 'people-outline',     done: isCommunityMember,      onPress: onExplore },
    { id: 'participate', label: '1ère participation',      icon: 'checkmark-circle-outline', done: hasParticipation, onPress: onExplore },
  ];
  const doneCount = steps.filter(s => s.done).length;
  const pct = Math.round((doneCount / steps.length) * 100);
  const isComplete = pct === 100;

  return (
    <View style={pb.card} testID="profile-completion-bar">
      <View style={pb.headerRow}>
        <View style={pb.headerLeft}>
          <Ionicons name={isComplete ? 'trophy-outline' : 'ribbon-outline'} size={15} color={Colors.primary} />
          <Text style={pb.title}>
            {isComplete ? 'Profil complété à ' : 'Profil complété à '}
            <Text style={pb.pct}>{pct}%</Text>
          </Text>
        </View>
        <Text style={[pb.remaining, isComplete && pb.remainingDone]}>
          {isComplete ? 'Complet !' : `${steps.length - doneCount} restant${steps.length - doneCount > 1 ? 's' : ''}`}
        </Text>
      </View>
      <View style={pb.track}>
        <View style={[pb.fill, { width: `${pct}%` as any }]} />
      </View>
      <View style={pb.grid}>
        {steps.map(step => (
          <TouchableOpacity
            key={step.id}
            style={[pb.step, step.done && pb.stepDone]}
            onPress={step.done ? undefined : step.onPress}
            activeOpacity={step.done ? 1 : 0.75}
            testID={`completion-step-${step.id}`}
          >
            <View style={[pb.stepIconWrap, step.done && pb.stepIconWrapDone]}>
              <Ionicons
                name={step.done ? 'checkmark' : step.icon as any}
                size={13}
                color={step.done ? Colors.primary : Colors.muted}
              />
            </View>
            <Text style={[pb.stepLabel, step.done && pb.stepLabelDone]} numberOfLines={1}>
              {step.label}
            </Text>
            {!step.done && <Ionicons name="chevron-forward" size={11} color={Colors.muted} />}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const pb = StyleSheet.create({
  card: {
    marginHorizontal: Spacing.md, marginBottom: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.primary + '35',
    padding: 14, gap: 10,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  pct: { color: Colors.primary, fontWeight: '800' },
  remaining: { fontSize: 11, color: Colors.muted },
  remainingDone: { color: Colors.primary, fontWeight: '700' },
  track: { height: 5, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  step: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.background,
    borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: Colors.border,
    flex: 1, minWidth: '45%',
  },
  stepDone: { borderColor: Colors.primary + '40', backgroundColor: Colors.primary + '08' },
  stepIconWrap: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepIconWrapDone: { backgroundColor: Colors.primary + '25' },
  stepLabel: { flex: 1, fontSize: 12, fontWeight: '600', color: Colors.muted },
  stepLabelDone: { color: Colors.foreground },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function UserProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user: me, token } = useAuth();

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
  const [hasBooking, setHasBooking] = useState(false);
  const [isCommunityMember, setIsCommunityMember] = useState(false);
  const [hasParticipation, setHasParticipation] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [spotYouIndex, setSpotYouIndex] = useState(0);
  const [serviceIndex, setServiceIndex] = useState(0);
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);

  // Modales followers / following
  const [showFollowers, setShowFollowers] = useState(false);
  const [showFollowing, setShowFollowing] = useState(false);

  // Cover photo offset (0 = top, 1 = bottom) + scale (zoom)
  const [coverOffsetY, setCoverOffsetY] = useState(0.5);
  const [coverScale, setCoverScale] = useState(1.0);
  const [repositioning, setRepositioning] = useState(false);
  const [savingOffset, setSavingOffset] = useState(false);

  // Animated values for modal drag/pinch
  const repoTopAnim   = useRef(new Animated.Value(-MAX_OFFSET_PX * 0.5)).current;
  const repoScaleAnim = useRef(new Animated.Value(1.0)).current;
  // Animated derived values for image display (width, height, left offset)
  const animImgWidth  = useRef(Animated.multiply(repoScaleAnim, SCREEN_W)).current;
  const animImgHeight = useRef(Animated.multiply(repoScaleAnim, COVER_IMG_H)).current;
  // left = -(scale-1)*SCREEN_W/2  →  Animated.multiply(Animated.subtract(1, scale), SCREEN_W/2)
  const animImgLeft   = useRef(Animated.multiply(Animated.subtract(1, repoScaleAnim), SCREEN_W / 2)).current;

  // Gesture tracking refs
  const repoTopRef   = useRef(-MAX_OFFSET_PX * 0.5);
  const repoScaleRef = useRef(1.0);
  const isPinchingRef = useRef(false);
  const pinchInitDistRef   = useRef(0);
  const pinchInitScaleRef  = useRef(1.0);
  const lastSingleTouchY   = useRef(0);

  // Helper: distance between two touch points
  const getTouchDist = (t1: any, t2: any) =>
    Math.sqrt(Math.pow(t1.pageX - t2.pageX, 2) + Math.pow(t1.pageY - t2.pageY, 2));

  const repoPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  () => true,

      onPanResponderGrant: (evt) => {
        repoTopRef.current   = (repoTopAnim   as any)._value;
        repoScaleRef.current = (repoScaleAnim as any)._value;
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          isPinchingRef.current    = true;
          pinchInitDistRef.current = getTouchDist(touches[0], touches[1]);
          pinchInitScaleRef.current = repoScaleRef.current;
        } else {
          isPinchingRef.current     = false;
          lastSingleTouchY.current  = touches[0]?.pageY ?? 0;
        }
      },

      onPanResponderMove: (evt) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length >= 2) {
          if (!isPinchingRef.current) {
            // Transition single → pinch
            isPinchingRef.current    = true;
            pinchInitDistRef.current = getTouchDist(touches[0], touches[1]);
            pinchInitScaleRef.current = (repoScaleAnim as any)._value;
            repoTopRef.current        = (repoTopAnim as any)._value;
          }
          // Pinch: update scale
          const ratio = getTouchDist(touches[0], touches[1]) / pinchInitDistRef.current;
          const newScale = Math.max(1.0, Math.min(3.0, pinchInitScaleRef.current * ratio));
          repoScaleAnim.setValue(newScale);
          repoScaleRef.current = newScale;
          // Clamp top position
          const maxDrag = COVER_IMG_H * newScale - COVER_H;
          repoTopAnim.setValue(Math.max(-maxDrag, Math.min(0, repoTopRef.current)));
        } else if (touches.length === 1) {
          if (isPinchingRef.current) {
            // Transition pinch → single
            isPinchingRef.current    = false;
            repoTopRef.current       = (repoTopAnim as any)._value;
            lastSingleTouchY.current = touches[0].pageY;
          }
          // Pan: vertical drag using absolute touch position (avoids gestureState.dy drift)
          const scale   = (repoScaleAnim as any)._value;
          const maxDrag = COVER_IMG_H * scale - COVER_H;
          const dy      = touches[0].pageY - lastSingleTouchY.current;
          const newTop  = Math.max(-maxDrag, Math.min(0, repoTopRef.current + dy));
          repoTopAnim.setValue(newTop);
          // Update for next frame
          lastSingleTouchY.current = touches[0].pageY;
          repoTopRef.current = newTop;
        }
      },

      onPanResponderRelease: () => {
        repoTopRef.current   = (repoTopAnim   as any)._value;
        repoScaleRef.current = (repoScaleAnim as any)._value;
        isPinchingRef.current = false;
      },
    })
  ).current;

  // Reload every time the screen comes into focus (fix: data not updating after edit)
  useFocusEffect(
    useCallback(() => {
      if (id) {
        setLoading(true);
        load();
      }
      // Refresh bookings on every focus so the completion bar stays up to date
      if (me?.user_id && me.user_id === id) {
        api.get<any[]>('/bookings/me').then(b => {
          setHasBooking(Array.isArray(b) && b.length > 0);
        }).catch(() => {});
        api.get<{ is_community_member: boolean; has_participation: boolean }>('/spot-you/my-completion-stats').then(s => {
          setIsCommunityMember(s.is_community_member);
          setHasParticipation(s.has_participation);
        }).catch(() => {});
      }
    }, [id, me?.user_id])
  );

  // Re-detect myReview when me loads after reviews are already fetched
  // (fix: auth context may not be ready on initial page load, causing myReview detection to fail)
  React.useEffect(() => {
    if (me && reviews.length > 0 && !myReview) {
      const mine = reviews.find((r: any) => r.reviewer_id === me.user_id);
      if (mine) {
        setMyReview(mine);
        setMyRating(mine.rating);
        setMyComment(mine.comment || '');
      }
    }
  }, [me?.user_id, reviews]);

  const load = async () => {
    try {
      const data = await api.get(`/users/${id}/public`);
      setProfile(data);
      setIsFollowing(data.is_following ?? false);
      setFollowersCount(data.followers_count ?? 0);
      // Initialize cover offset + scale
      const offsetY = data.cover_offset_y ?? 0.5;
      const scale   = data.cover_scale   ?? 1.0;
      setCoverOffsetY(offsetY);
      setCoverScale(scale);
      const initTop = -(offsetY * (COVER_IMG_H * scale - COVER_H));
      repoTopAnim.setValue(initTop);
      repoScaleAnim.setValue(scale);
      repoTopRef.current   = initTop;
      repoScaleRef.current = scale;
      if (data.show_reviews) await loadReviews();
    } catch {}
    finally { setLoading(false); }
  };

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
    } finally {
      setFollowLoading(false);
    }
  };

  const [uploadingCover, setUploadingCover] = useState(false);

  // Show action sheet if cover exists, otherwise open picker directly
  const handleCoverEdit = () => {
    if (profile?.cover_picture) {
      Alert.alert(
        'Photo de couverture',
        'Que souhaitez-vous faire ?',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Repositionner', onPress: openReposition },
          { text: 'Changer la photo', onPress: pickAndUploadCover },
        ]
      );
    } else {
      pickAndUploadCover();
    }
  };

  const openReposition = () => {
    const offset = coverOffsetY ?? 0.5;
    const scale  = coverScale  ?? 1.0;
    const initTop = -(offset * (COVER_IMG_H * scale - COVER_H));
    repoTopAnim.setValue(initTop);
    repoScaleAnim.setValue(scale);
    repoTopRef.current   = initTop;
    repoScaleRef.current = scale;
    setRepositioning(true);
  };

  const cancelReposition = () => {
    // Revert animated values to saved state
    const offset   = coverOffsetY ?? 0.5;
    const scale    = coverScale   ?? 1.0;
    const savedTop = -(offset * (COVER_IMG_H * scale - COVER_H));
    repoTopAnim.setValue(savedTop);
    repoScaleAnim.setValue(scale);
    repoTopRef.current   = savedTop;
    repoScaleRef.current = scale;
    setRepositioning(false);
  };

  const saveReposition = async () => {
    const currentTop   = (repoTopAnim   as any)._value;
    const currentScale = (repoScaleAnim as any)._value;
    const maxDrag      = COVER_IMG_H * currentScale - COVER_H;
    const newOffsetY   = maxDrag > 0 ? Math.max(0, Math.min(1, -currentTop / maxDrag)) : 0.5;
    setSavingOffset(true);
    try {
      await api.patch(`/users/${id}/cover`, {
        cover_picture:   profile.cover_picture,
        cover_offset_y:  newOffsetY,
        cover_scale:     currentScale,
      });
      setCoverOffsetY(newOffsetY);
      setCoverScale(currentScale);
      setProfile((prev: any) => ({ ...prev, cover_offset_y: newOffsetY, cover_scale: currentScale }));
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder le cadrage.');
    } finally {
      setSavingOffset(false);
      setRepositioning(false);
    }
  };

  const pickAndUploadCover = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', 'Accès à la galerie nécessaire pour changer la photo de couverture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [16, 9],
    });
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
        const blobRes = await fetch(asset.uri);
        const blob = await blobRes.blob();
        const file = new File([blob], `cover.${ext}`, { type: blob.type || mimeType });
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`${BASE_URL}/api/upload-image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
        if (!res.ok) throw new Error('Upload échoué');
        uploadUrl = (await res.json()).url;
      } else {
        const form = new FormData();
        form.append('file', { uri: asset.uri, name: `cover.${ext}`, type: mimeType } as any);
        const res = await fetch(`${BASE_URL}/api/upload-image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
        if (!res.ok) throw new Error('Upload échoué');
        uploadUrl = (await res.json()).url;
      }
      // After upload, reset offset to 0.5 (center) + scale 1.0 so user can then reposition
      await api.patch(`/users/${id}/cover`, { cover_picture: uploadUrl, cover_offset_y: 0.5, cover_scale: 1.0 });
      const newOffsetY = 0.5;
      const newScale   = 1.0;
      setCoverOffsetY(newOffsetY);
      setCoverScale(newScale);
      const initTop = -(newOffsetY * (COVER_IMG_H * newScale - COVER_H));
      repoTopAnim.setValue(initTop);
      repoScaleAnim.setValue(newScale);
      repoTopRef.current   = initTop;
      repoScaleRef.current = newScale;
      setProfile((prev: any) => ({ ...prev, cover_picture: uploadUrl, cover_offset_y: newOffsetY, cover_scale: newScale }));
      // After upload, immediately offer to reposition
      setTimeout(() => {
        Alert.alert(
          'Photo uploadée !',
          'Voulez-vous ajuster le cadrage ?',
          [
            { text: 'Non', style: 'cancel' },
            { text: 'Repositionner', onPress: () => setRepositioning(true) },
          ]
        );
      }, 400);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible d\'uploader la photo de couverture.');
    } finally {
      setUploadingCover(false);
    }
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

  const handleToggleGoing = async (item: any) => {
    if (!me) return;
    setTogglingId(item.point_id);
    try {
      const wasGoing = item.is_going;
      const endpoint = `/spot-you/${item.point_id}/going`;
      if (wasGoing) {
        await api.delete(endpoint);
      } else {
        await api.post(endpoint, {});
      }
      // Update in-place
      setProfile((prev: any) => ({
        ...prev,
        tag_points: prev.tag_points.map((tp: any) =>
          tp.point_id === item.point_id
            ? { ...tp, is_going: !wasGoing, going_count: tp.going_count + (wasGoing ? -1 : 1) }
            : tp
        ),
      }));
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de mettre à jour la participation.');
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return <ScreenLoader />;
  }
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

          {/* COVER PHOTO — pleine largeur avec offset vertical + zoom */}
          <View style={st.coverWrap}>
            {profile.cover_picture ? (
              <Animated.Image
                source={{ uri: profile.cover_picture }}
                style={[st.coverImg, {
                  width:  animImgWidth,
                  height: animImgHeight,
                  left:   animImgLeft,
                  top:    repoTopAnim,
                }]}
              />
            ) : (
              <View style={st.coverPlaceholder} />
            )}
            {/* Overlay gradient bas pour lisibilité avatar */}
            <View style={st.coverOverlay} />
            {/* Bouton upload cover (propriétaire) — bas droite */}
            {isOwnProfile && (
              <TouchableOpacity
                style={st.coverEditBtn}
                onPress={handleCoverEdit}
                disabled={uploadingCover}
                testID="cover-edit-btn"
                activeOpacity={0.85}>
                {uploadingCover
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="camera" size={18} color="#fff" />
                }
              </TouchableOpacity>
            )}
            {/* Indicateur repositionnement actif — non utilisé ici (géré dans modal) */}
          </View>

          {/* BANDE AVATAR + ACTIONS — chevauchement Facebook */}
          <View style={st.avatarRow}>
            {/* Avatar bas-gauche */}
            <View style={st.avatarWrap}>
              {profile.picture
                ? <Image source={{ uri: profile.picture }} style={st.avatarImg} />
                : <View style={st.avatarPlaceholder}>
                    <Text style={st.avatarInitial}>{profile.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                  </View>
              }
              {isCoach && profile.is_coach_verified && (
                <View style={st.verifiedDot} testID="verified-badge">
                  <Ionicons name="checkmark" size={10} color="#0A0A0A" />
                </View>
              )}
            </View>

            {/* Boutons droite : Suivre uniquement (Modifier est dans le header) */}
            <View style={st.heroActions}>
              {me && !isOwnProfile && (
                <TouchableOpacity
                  style={[st.followBtn, isFollowing && st.followBtnActive]}
                  onPress={handleFollow}
                  disabled={followLoading}
                  testID="follow-btn"
                  activeOpacity={0.8}>
                  {followLoading
                    ? <ActivityIndicator size="small" color={isFollowing ? Colors.primary : '#0A0A0A'} />
                    : <>
                        <Ionicons
                          name={isFollowing ? 'checkmark-circle' : 'person-add-outline'}
                          size={14}
                          color={isFollowing ? Colors.primary : '#0A0A0A'} />
                        <Text style={[st.followBtnText, isFollowing && st.followBtnTextActive]}>
                          {isFollowing ? 'Abonné' : 'Suivre'}
                        </Text>
                      </>
                  }
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* NOM + BADGES */}
          <View style={st.heroInfo}>
            <View style={st.nameRow}>
              <Text style={st.name} testID="user-profile-name">{profile.name}</Text>
              {badge && (
                <View style={[st.achievementBadge, { backgroundColor: badge.bg, borderColor: badge.color + '44' }]}
                  testID="achievement-badge">
                  <Ionicons name={badge.icon as any} size={11} color={badge.color} />
                  <Text style={[st.achievementText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              )}
            </View>

            {/* Pills rôle + rating */}
            <View style={st.badgeRow}>
              <View style={[st.roleBadge, isCoach && st.roleBadgeCoach]}>
                <Ionicons name={isCoach ? 'trophy-outline' : 'person-outline'} size={11}
                  color={isCoach ? Colors.primary : Colors.muted} />
                <Text style={[st.roleBadgeText, isCoach && { color: Colors.primary }]}>
                  {isCoach ? 'Coach' : 'Membre'}
                </Text>
              </View>
              {avgRating != null && (
                <View style={st.ratingBadge} testID="rating-badge">
                  <Ionicons name="star" size={11} color="#FFD700" />
                  <Text style={st.ratingText}>{avgRating} ({reviews.length})</Text>
                </View>
              )}
            </View>

            {profile.bio ? <Text style={st.bio}>{profile.bio}</Text> : null}

            {/* STATS INLINE — style Facebook */}
            <View style={st.statsInline} testID="profile-stats">
              <TouchableOpacity
                onPress={() => setShowFollowers(true)}
                activeOpacity={0.7}
                testID="followers-count-btn"
                style={st.statInlineTap}
              >
                <Text style={st.statInlineNum}>{followersCount}</Text>
                <Text style={st.statInlineLbl}> abonnés</Text>
              </TouchableOpacity>
              <Text style={st.statInlineSep}> · </Text>
              <TouchableOpacity
                onPress={() => setShowFollowing(true)}
                activeOpacity={0.7}
                testID="following-count-btn"
                style={st.statInlineTap}
              >
                <Text style={st.statInlineNum}>{profile.following_count ?? 0}</Text>
                <Text style={st.statInlineLbl}> abonnements</Text>
              </TouchableOpacity>
              <Text style={st.statInlineSep}> · </Text>
              <Text style={st.statInlineNum}>{SpotYou.length}</Text>
              <Text style={st.statInlineLbl}> SpotYou</Text>
            </View>
          </View>
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

        {/* ── INTÉRÊTS / SPÉCIALISATIONS ─────────── */}
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
                  {tag.icon ? <Text style={st.tagIcon}>{tag.icon}</Text> : null}
                  <Text style={st.tagText}>{tag.label_fr || tag.label_en}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── BARRE DE COMPLÉTION (propriétaire uniquement) ─── */}
        {isOwnProfile && (
          <ProfileCompletionBar
            profile={profile}
            spotYouCount={SpotYou.length}
            interests={interests}
            hasBooking={hasBooking}
            isCommunityMember={isCommunityMember}
            hasParticipation={hasParticipation}
            onEditProfile={() => router.push('/edit-profile' as any)}
            onCreateSpotYou={() => router.push('/(tabs)/create' as any)}
            onExplore={() => router.push('/(tabs)/search' as any)}
          />
        )}

        {/* ── SERVICES (coach) — Carrousel avec photo ── */}
        {isCoach && services.length > 0 && (
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <View style={st.sectionAccent} />
              <Ionicons name="briefcase-outline" size={14} color={Colors.primary} />
              <Text style={st.sectionTitle}>Services proposés</Text>
              {services.length > 1 && <Text style={st.carouselCount}>{services.length}</Text>}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.carouselContent}
              decelerationRate="fast"
              snapToInterval={CARD_WIDTH + 16}
              snapToAlignment="start"
              onScroll={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 16));
                setServiceIndex(Math.max(0, Math.min(idx, services.length - 1)));
              }}
              scrollEventThrottle={16}
            >
              {services.map((svc: any) => {
                const rawImages = svc.images;
                const parsedImages = Array.isArray(rawImages)
                  ? rawImages
                  : (typeof rawImages === 'string' ? JSON.parse(rawImages || '[]') : []);
                const svcImage = parsedImages[0] || null;
                return (
                  <TouchableOpacity key={svc.service_id}
                    style={[st.serviceCard, { width: CARD_WIDTH }]}
                    onPress={() => router.push(`/service/${svc.service_id}` as any)}
                    activeOpacity={0.9} testID={`service-card-${svc.service_id}`}>
                    {/* Photo */}
                    {svcImage
                      ? <Image source={{ uri: svcImage }} style={st.serviceImage} />
                      : <View style={st.serviceImagePlaceholder}>
                          <Ionicons name="barbell-outline" size={36} color={Colors.primary} />
                        </View>
                    }
                    {/* Badge prix flottant */}
                    <View style={st.servicePriceBadge}>
                      <Text style={st.servicePriceText}>{svc.price}€</Text>
                    </View>
                    {/* Contenu */}
                    <View style={st.serviceBody}>
                      <Text style={st.serviceTitle}>{svc.title}</Text>
                      {svc.description && (
                        <Text style={st.serviceDesc} numberOfLines={2}>{svc.description}</Text>
                      )}
                      <View style={st.serviceMetaRow}>
                        <View style={st.metaPill}>
                          <Ionicons name="time-outline" size={14} color="#A1A1AA" />
                          <Text style={st.metaText}>{svc.duration_min} min</Text>
                        </View>
                        <View style={st.metaPill}>
                          <Ionicons name="people-outline" size={14} color="#A1A1AA" />
                          <Text style={st.metaText}>{svc.max_participants} max</Text>
                        </View>
                      </View>
                      {me && me.user_id !== profile.user_id && (
                        <View style={st.reserveBtn} testID={`reserve-btn-${svc.service_id}`}>
                          <Text style={st.reserveBtnText}>Réserver</Text>
                          <Ionicons name="arrow-forward" size={16} color="#0A0A0A" />
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {services.length > 1 && (
              <View style={st.dotsRow}>
                {services.map((_: any, i: number) => (
                  <View key={i} style={[st.dot, i === serviceIndex && st.dotActive]} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* ── SPOTYOU PUBLIÉS — Carrousel ────────────────── */}
        {SpotYou.length > 0 && (
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <View style={st.sectionAccent} />
              <Ionicons name="location-outline" size={14} color={Colors.primary} />
              <Text style={st.sectionTitle}>SpotYou publiés</Text>
              <Text style={st.carouselCount}>{SpotYou.length}</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.carouselContent}
              decelerationRate="fast"
              snapToInterval={CARD_WIDTH + 16}
              snapToAlignment="start"
              onScroll={(e) => {
                const idx = Math.round(e.nativeEvent.contentOffset.x / (CARD_WIDTH + 16));
                setSpotYouIndex(Math.max(0, Math.min(idx, SpotYou.length - 1)));
              }}
              scrollEventThrottle={16}
            >
              {SpotYou.map((tp: any) => (
                <View key={tp.point_id} style={[st.carouselCard, { width: CARD_WIDTH }]}>
                  <SpotYouCard
                    item={tp}
                    onNavigate={(id) => router.push(`/spot-you/${id}` as any)}
                    onToggleGoing={() => handleToggleGoing(tp)}
                    togglingId={togglingId}
                    testID={`carousel-tp-${tp.point_id}`}
                  />
                </View>
              ))}
            </ScrollView>
            {SpotYou.length > 1 && (
              <View style={st.dotsRow}>
                {SpotYou.map((_: any, i: number) => (
                  <View key={i} style={[st.dot, i === spotYouIndex && st.dotActive]} />
                ))}
              </View>
            )}
          </View>
        )}

        {SpotYou.length === 0 && (
          <View style={st.emptySection} testID="empty-spotyou">
            {isOwnProfile ? (
              <View style={st.emptyCTA}>
                <View style={st.emptyCTAIconWrap}>
                  <View style={st.emptyCTAIconRing}>
                    <Ionicons name="location" size={28} color={Colors.primary} />
                  </View>
                  <View style={[st.emptyCTADot, { top: 6, left: 8 }]} />
                  <View style={[st.emptyCTADot, { top: 14, right: 4, width: 5, height: 5 }]} />
                  <View style={[st.emptyCTADot, { bottom: 4, left: 18, width: 4, height: 4 }]} />
                </View>
                <Text style={st.emptyCTATitle}>Partagez vos activités sportives</Text>
                <Text style={st.emptyCTADesc}>
                  Créez un SpotYou et invitez la communauté à vous rejoindre pour vos entraînements, sorties ou séances.
                </Text>
                <TouchableOpacity style={st.emptyCTABtn} onPress={() => router.push('/(tabs)/create' as any)}
                  activeOpacity={0.88} testID="create-spotyou-cta-btn">
                  <Ionicons name="add-circle" size={17} color={Colors.background} />
                  <Text style={st.emptyCTABtnText}>Créer un SpotYou</Text>
                </TouchableOpacity>
                <Text style={st.emptyCTAHint}>Gratuit · Visible par toute la communauté</Text>
              </View>
            ) : (
              <View style={st.emptyVisitor}>
                <View style={st.emptyVisitorIcon}>
                  <Ionicons name="location-outline" size={26} color={Colors.muted} />
                </View>
                <Text style={st.emptyVisitorTitle}>Aucun SpotYou public</Text>
                <Text style={st.emptyVisitorDesc}>Cet utilisateur n'a pas encore partagé d'activités.</Text>
              </View>
            )}
          </View>
        )}

        {/* ── AVIS ──────────────────────────────── */}
        {profile.show_reviews && (
          <View style={st.section} testID="reviews-section">
            {/* Header */}
            <View style={[st.reviewsHeader, { marginBottom: 14 }]}>
              <View style={st.sectionHeader}>
                <View style={st.sectionAccent} />
                <Ionicons name="star-outline" size={14} color={Colors.primary} />
                <Text style={st.sectionTitle}>Avis{reviews.length > 0 ? ` (${reviews.length})` : ''}</Text>
              </View>
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
                {/* Stars décoratives */}
                <View style={st.noReviewsStars}>
                  {[1,2,3,4,5].map(i => (
                    <Ionicons key={i} name="star-outline" size={18} color={Colors.border} />
                  ))}
                </View>
                <Text style={st.noReviewsTitle}>
                  {isOwnProfile ? "Pas encore d'avis" : "Soyez le premier à laisser un avis"}
                </Text>
                <Text style={st.noReviewsDesc}>
                  {isOwnProfile
                    ? "Participez à des activités et échangez avec la communauté pour recevoir vos premiers avis."
                    : "Rejoignez une session et partagez votre expérience avec la communauté."
                  }
                </Text>
              </View>
            ) : (
              <>
                {displayedReviews
                  .filter(r => !myReview || r.review_id !== myReview.review_id) // Don't double-show my review
                  .map((r: any) => (
                    <View key={r.review_id} style={st.reviewCard} testID={`review-${r.review_id}`}>
                      <View style={st.reviewHeader}>
                        <View style={st.reviewerInfo}>
                          <UserAvatar
                            uri={r.reviewer_picture}
                            name={r.reviewer_name}
                            size={36}
                          />
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
                      {showAllReviews ? 'Voir moins' : `Voir ${reviews.length - REVIEWS_PREVIEW > 1 ? 'les' : 'le'} ${reviews.length - REVIEWS_PREVIEW} autre${reviews.length - REVIEWS_PREVIEW > 1 ? 's' : ''} avis`}
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

      {/* ── MODAL REPOSITIONNEMENT ─────────────────────────────── */}
      <Modal
        visible={repositioning}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={cancelReposition}
      >
        <View style={rm.overlay}>
          {/* Header */}
          <View style={rm.header}>
            <TouchableOpacity
              onPress={cancelReposition}
              style={rm.headerBtn}
              testID="reposition-cancel-btn">
              <Ionicons name="close" size={20} color="rgba(255,255,255,0.8)" />
              <Text style={rm.headerBtnText}>Annuler</Text>
            </TouchableOpacity>
            <Text style={rm.headerTitle}>Repositionner</Text>
            <TouchableOpacity
              onPress={saveReposition}
              style={rm.headerBtn}
              disabled={savingOffset}
              testID="reposition-save-btn">
              {savingOffset
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <>
                    <Ionicons name="checkmark" size={20} color={Colors.primary} />
                    <Text style={[rm.headerBtnText, { color: Colors.primary }]}>Enregistrer</Text>
                  </>
              }
            </TouchableOpacity>
          </View>

          {/* Zone de drag/pinch */}
          <View style={rm.coverFrame} {...repoPanResponder.panHandlers}>
            {profile?.cover_picture && (
              <Animated.Image
                source={{ uri: profile.cover_picture }}
                style={[rm.coverImg, {
                  width:  animImgWidth,
                  height: animImgHeight,
                  left:   animImgLeft,
                  top:    repoTopAnim,
                }]}
              />
            )}
            {/* Ligne guide centrale */}
            <View style={rm.guideLine} pointerEvents="none" />
          </View>

          {/* Instructions */}
          <View style={rm.hintsRow}>
            <View style={rm.hint}>
              <Ionicons name="swap-vertical-outline" size={15} color="rgba(255,255,255,0.6)" />
              <Text style={rm.hintText}>Glisser pour cadrer</Text>
            </View>
            <View style={rm.hintDivider} />
            <View style={rm.hint}>
              <Ionicons name="search-outline" size={15} color="rgba(255,255,255,0.6)" />
              <Text style={rm.hintText}>Pincer pour zoomer</Text>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── MODALS FOLLOWERS / FOLLOWING ─────────────────────────── */}
      <FollowListModal
        visible={showFollowers}
        onClose={() => setShowFollowers(false)}
        profileId={id}
        meId={me?.user_id ?? null}
        type="followers"
        count={followersCount}
        isOwnProfile={!!isOwnProfile}
      />
      <FollowListModal
        visible={showFollowing}
        onClose={() => setShowFollowing(false)}
        profileId={id}
        meId={me?.user_id ?? null}
        type="following"
        count={profile?.following_count ?? 0}
        isOwnProfile={!!isOwnProfile}
      />
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
  scroll: { paddingBottom: 40 },

  // ── HERO FACEBOOK STYLE ──────────────────────
  hero: { marginBottom: 4 },

  // Cover photo — overflow hidden pour contrôler le cadrage
  coverWrap: { width: '100%' as any, height: COVER_H, overflow: 'hidden', position: 'relative' as any },
  coverImg: {
    position: 'absolute' as any,
    resizeMode: 'cover',
  },
  coverPlaceholder: {
    width: '100%' as any, height: COVER_H,
    backgroundColor: '#0D2420',
  },
  coverOverlay: {
    position: 'absolute' as any, bottom: 0, left: 0, right: 0, height: 80,
    backgroundColor: 'transparent',
  },
  coverEditBtn: {
    position: 'absolute' as any, bottom: 12, right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 22,
    width: 36, height: 36, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },

  // Bande avatar + actions (chevauchement −52px)
  avatarRow: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: 16, marginTop: -52, marginBottom: 10,
  },
  avatarWrap: { position: 'relative' as any },
  avatarImg: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 4, borderColor: Colors.background,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  avatarPlaceholder: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: TEAL_DIM, borderWidth: 4, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 38, fontWeight: '800', color: Colors.primary },
  verifiedDot: {
    position: 'absolute' as any, bottom: 4, right: 4,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },

  // Boutons à droite de l'avatar
  heroActions: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  followBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.primary, borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 9,
  },
  followBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  followBtnText: { fontSize: 13, fontWeight: '800', color: '#0A0A0A' },
  followBtnTextActive: { color: Colors.primary },
  editProfileBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.secondary, borderRadius: 8, borderWidth: 1, borderColor: Colors.border,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  editProfileBtnText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },

  // Nom + infos
  heroInfo: { paddingHorizontal: 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.secondary },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as any, marginBottom: 6 },
  name: { fontSize: 22, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.5 },
  badgeRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  roleBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.secondary, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  roleBadgeCoach: { backgroundColor: TEAL_DIM },
  roleBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  ratingBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,215,0,0.12)', borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.25)',
  },
  ratingText: { fontSize: 11, fontWeight: '600', color: '#FFD700' },
  achievementBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1,
  },
  achievementText: { fontSize: 11, fontWeight: '700' },
  bio: { fontSize: 14, color: Colors.muted, lineHeight: 20, marginBottom: 10 },

  // Stats inline — style Facebook
  statsInline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' as any },
  statInlineTap: { flexDirection: 'row', alignItems: 'center' },
  statInlineNum: { fontSize: 14, fontWeight: '800', color: Colors.foreground },
  statInlineLbl: { fontSize: 13, color: Colors.muted },
  statInlineSep: { fontSize: 13, color: Colors.muted },

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
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
  },
  sectionAccent: {
    width: 3, height: 16, borderRadius: 2, backgroundColor: Colors.primary,
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 1.2 },

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

  // SpotYou carousel
  carouselContent: { paddingHorizontal: 4, gap: 16 },
  carouselCard: { /* width set dynamically */ },
  carouselCount: {
    marginLeft: 'auto' as any, fontSize: 12, fontWeight: '700',
    color: Colors.primary, backgroundColor: Colors.secondary,
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  tpCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.secondary, borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  tpThumb: { width: 80, height: 80, borderRadius: 12 },
  tpThumbPlaceholder: { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  tpInfo: { flex: 1, gap: 6 },
  tpTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 19 },
  tpMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tpDate: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  // ── Empty states ─────────────────────────────────────────────────────────
  emptySection: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  // CTA pour le propriétaire (profil vide)
  emptyCTA: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 24,
    alignItems: 'center',
  },
  emptyCTAIconWrap: { position: 'relative', width: 64, height: 64, marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  emptyCTAIconRing: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary + '15',
    borderWidth: 1.5, borderColor: Colors.primary + '30',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyCTADot: { position: 'absolute', width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary + '40' },
  emptyCTATitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground, textAlign: 'center', marginBottom: 8 },
  emptyCTADesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  emptyCTABtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: Colors.primary,
    paddingHorizontal: 22, paddingVertical: 11,
    borderRadius: Radius.full, marginBottom: 10,
  },
  emptyCTABtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
  emptyCTAHint: { fontSize: 11, color: Colors.muted },
  // Message doux pour visiteur
  emptyVisitor: {
    backgroundColor: Colors.card,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border,
    padding: 24, alignItems: 'center', gap: 8,
  },
  emptyVisitorIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  emptyVisitorTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  emptyVisitorDesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 18 },
  // Legacy (inutilisés mais gardés pour sécurité)
  emptyState: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 8 },
  emptyText: { fontSize: 14, color: Colors.muted },
  // Reviews vides
  noReviews: { paddingVertical: 24, alignItems: 'center', gap: 10 },
  noReviewsStars: { flexDirection: 'row', gap: 5, marginBottom: 4 },
  noReviewsTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  noReviewsDesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19, maxWidth: 280 },
  noReviewsText: { fontSize: 13, color: Colors.muted },

  // Services
  serviceCard: {
    backgroundColor: '#181A1B',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.15)',
    overflow: 'hidden',
    marginBottom: 4,
  },
  serviceImage: { width: '100%' as any, height: 180, resizeMode: 'cover' },
  serviceImagePlaceholder: {
    width: '100%' as any, height: 140, backgroundColor: 'rgba(0,191,165,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  serviceBody: { padding: 16 },
  serviceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  serviceTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 12,
    letterSpacing: -0.2,
  },
  servicePriceBadge: {
    position: 'absolute' as any,
    top: 12, right: 12,
    backgroundColor: '#00BFA5',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  servicePriceText: {
    color: '#0A0A0A',
    fontWeight: '900',
    fontSize: 15,
  },
  serviceDesc: {
    fontSize: 13,
    color: '#A1A1AA',
    lineHeight: 20,
    marginBottom: 14,
  },
  serviceMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#27272A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E4E4E7',
  },

  // Dots indicator
  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.muted, opacity: 0.4 },
  dotActive: { width: 18, borderRadius: 3, backgroundColor: Colors.primary, opacity: 1 },
  reserveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#00BFA5',
    borderRadius: 16,
    paddingVertical: 14,
    shadowColor: '#00BFA5',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  reserveBtnText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0A0A0A',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

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

// ── Styles Modal Repositionnement ────────────────────────────────────────────
const rm = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingTop: 48,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  headerBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.8)',
  },
  headerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  // Cover frame — same width as screen, overflow hidden
  coverFrame: {
    width: SCREEN_W,
    height: COVER_H,
    overflow: 'hidden',
    backgroundColor: '#0D2420',
    borderWidth: 1,
    borderColor: 'rgba(0,191,165,0.3)',
    position: 'relative',
  },
  coverImg: {
    position: 'absolute',
    resizeMode: 'cover',
  } as any,
  guideLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: COVER_H / 2 - 0.5,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  hintsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 20,
    gap: 10,
  },
  hintDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hintText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
});
