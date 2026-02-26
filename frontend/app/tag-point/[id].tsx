import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, Dimensions,
  ActivityIndicator, TouchableOpacity, Alert, Image, Share,
  TextInput, Modal, KeyboardAvoidingView, Platform, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import { MarkdownText } from '../../components/RichTextInput';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from '../../context/LocationContext';
import { useLang } from '../../context/LanguageContext';
import { useRefresh } from '../../context/RefreshContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { haversineDistance, formatDistance } from '../../utils/distance';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(d: string) {
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  if (diff < 1) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  if (diff < 7) return `${diff} j`;
  if (diff < 30) return `${Math.floor(diff / 7)} sem`;
  return `${Math.floor(diff / 30)} mois`;
}

const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function formatRecurring(s: any): { summary: string; perDay: Array<{ day: string; times: string[] }> | null } {
  if (!s) return { summary: '', perDay: null };
  // If s is a string (legacy double-encoded), parse it first
  if (typeof s === 'string') {
    try { s = JSON.parse(s); } catch { return { summary: 'Récurrent', perDay: null }; }
  }
// New format: { type:'weekly', schedule:{'0': [...slots], '2': [...slots]} }
// Slots can be old format (string: '18:00') or new format ({start:'18:00', end:'19:00'})
  if (s.schedule && typeof s.schedule === 'object') {
    const entries = Object.entries(s.schedule as Record<string, any[]>)
      .map(([d, slots]) => {
        const times = (slots as any[]).map((slot: any) => {
          if (typeof slot === 'string') return slot;
          if (slot?.start) return slot.end ? `${slot.start} → ${slot.end}` : slot.start;
          return String(slot);
        });
        return { dayIdx: parseInt(d), times };
      })
      .sort((a, b) => a.dayIdx - b.dayIdx);
    if (entries.length === 0) return { summary: 'Récurrent', perDay: null };
    const summary = entries.map(e => `${DAYS_SHORT[e.dayIdx]}: ${e.times.join(', ')}`).join(' · ');
    const perDay = entries.map(e => ({ day: DAYS_FULL[e.dayIdx], times: e.times }));
    return { summary, perDay };
  }
  // Intermediate format: { type:'weekly', days:[0,2], times:['09:00'] }
  if (s.days && s.times) {
    const perDay = (s.days as number[]).map(d => ({ day: DAYS_FULL[d], times: s.times as string[] }));
    const summary = (s.days as number[]).map(d => DAYS_SHORT[d]).join(', ') + ` · ${(s.times as string[]).join(', ')}`;
    return { summary, perDay };
  }
  // Legacy format: { type:'weekly', day:0, time:'09:00' }
  if (s.day !== undefined && s.time) {
    return { summary: `Chaque ${DAYS_FULL[s.day]} à ${s.time}`, perDay: [{ day: DAYS_FULL[s.day], times: [s.time] }] };
  }
  return { summary: 'Récurrent', perDay: null };
}

// Calcule la prochaine occurrence d'un événement récurrent
function getNextOccurrence(s: any): { date: Date; startTime: string; endTime: string | null } | null {
  if (!s) return null;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return null; } }
  if (!s.schedule || typeof s.schedule !== 'object') return null;
  const now = new Date();
  // JS getDay(): 0=Dim..6=Sam → notre idx: 0=Lun..6=Dim
  const todayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  let earliest: { date: Date; startTime: string; endTime: string | null } | null = null;
  Object.entries(s.schedule as Record<string, any>).forEach(([dayStr, slots]) => {
    const dayIdx = parseInt(dayStr);
    const slotsArr = Array.isArray(slots) ? slots : [];
    if (slotsArr.length === 0) return;
    const firstSlot = slotsArr[0];
    let startTime: string;
    let endTime: string | null = null;
    if (typeof firstSlot === 'string') { startTime = firstSlot; }
    else if (firstSlot?.start) { startTime = firstSlot.start; endTime = firstSlot.end || null; }
    else { return; }
    const [h, m] = startTime.split(':').map(Number);
    let daysUntil = (dayIdx - todayIdx + 7) % 7;
    if (daysUntil === 0 && (h * 60 + m) <= (now.getHours() * 60 + now.getMinutes())) {
      daysUntil = 7;
    }
    const nextDate = new Date(now);
    nextDate.setDate(now.getDate() + daysUntil);
    nextDate.setHours(h, m, 0, 0);
    if (!earliest || nextDate < earliest.date) {
      earliest = { date: nextDate, startTime, endTime };
    }
  });
  return earliest;
}

// Formate le label jour relatif pour le prochain événement
function formatDayLabel(date: Date): string {
  const now = new Date();
  const diff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
     new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000
  );
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Demain';
  if (diff < 7) {
    const day = date.toLocaleDateString('fr-FR', { weekday: 'long' });
    return day.charAt(0).toUpperCase() + day.slice(1);
  }
  const label = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}



function formatEventDate(d: string): string {
  const date = new Date(d);
  const now = new Date();
  const diff = Math.floor((date.getTime() - now.getTime()) / 86400000);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Aujourd'hui à ${time}`;
  if (diff === 1) return `Demain à ${time}`;
  if (diff === -1) return `Hier à ${time}`;
  if (diff > 1 && diff < 7) {
    const day = date.toLocaleDateString('fr-FR', { weekday: 'long' });
    return `${day.charAt(0).toUpperCase() + day.slice(1)} à ${time}`;
  }
  const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  return `${dateStr} à ${time}`;
}

function formatEventDateFull(d: string): string {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

const CATEGORY_COLORS: Record<string, string> = {
  cat_running: '#00BFA5', cat_football: '#4CAF50', cat_basketball: '#FF9800',
  cat_tennis: '#E91E63', cat_yoga: '#9C27B0', cat_cycling: '#2196F3',
  cat_fitness: '#F44336', cat_swimming: '#00BCD4', cat_boxing: '#FF5722',
  cat_hiking: '#8BC34A', cat_volleyball: '#FF9500', default: '#00BFA5',
};
const tagColor = (cat?: string) => cat ? (CATEGORY_COLORS[cat] || CATEGORY_COLORS.default) : CATEGORY_COLORS.default;

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ w, h, radius = 8 }: { w: number | string; h: number; radius?: number }) {
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
      Animated.timing(anim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
    ])).start();
  }, []);
  return <Animated.View style={{ width: w as any, height: h, borderRadius: radius, backgroundColor: Colors.card, opacity: anim }} />;
}

function TagPointSkeleton() {
  return (
    <ScrollView style={{ flex: 1, backgroundColor: Colors.background }} contentContainerStyle={{ gap: 16, padding: Spacing.md }}>
      <Skeleton w="100%" h={220} radius={Radius.lg} />
      <Skeleton w="70%" h={26} />
      <Skeleton w="40%" h={16} />
      <Skeleton w="100%" h={60} />
      <Skeleton w="100%" h={180} radius={Radius.lg} />
    </ScrollView>
  );
}

// ─── Image Carousel ───────────────────────────────────────────────────────────
function ImageCarousel({ images, fallback }: { images: string[]; fallback?: string }) {
  const [index, setIndex] = useState(0);
  const allImgs = images.length > 0 ? images : fallback ? [fallback] : [];
  if (allImgs.length === 0) {
    return (
      <View style={carSt.box}>
        <View style={carSt.placeholder}><Ionicons name="image-outline" size={64} color={Colors.muted} /></View>
      </View>
    );
  }
  return (
    <View style={carSt.box}>
      <FlatList
        data={allImgs}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / (SCREEN_W - Spacing.md * 2)))}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_W - Spacing.md * 2, height: 220 }}>
            <Image source={{ uri: item }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          </View>
        )}
      />
      {allImgs.length > 1 && (
        <View style={carSt.dots}>
          {allImgs.map((_, i) => (
            <View key={i} style={[carSt.dot, i === index && carSt.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}
const carSt = StyleSheet.create({
  box: { height: 220, borderRadius: Radius.lg, overflow: 'hidden' },
  placeholder: { flex: 1, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  dots: { position: 'absolute', bottom: 10, alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#fff', width: 18 },
});

// ─── Interactive Stars ────────────────────────────────────────────────────────
function InteractiveStars({ value, onChange, size = 30 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[1,2,3,4,5].map(i => (
        <TouchableOpacity key={i} onPress={() => onChange(i)} activeOpacity={0.6}
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }} testID={`star-${i}`}>
          <Ionicons name={i <= value ? 'star' : 'star-outline'} size={size}
            color={i <= value ? Colors.star : Colors.muted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Rating Distribution ──────────────────────────────────────────────────────
function RatingBars({ dist, total }: { dist: Record<string, number>; total: number }) {
  if (total === 0) return null;
  return (
    <View style={{ gap: 5, marginTop: Spacing.sm }}>
      {[5,4,3,2,1].map(star => {
        const count = dist[String(star)] || 0;
        const pct = total > 0 ? count / total : 0;
        return (
          <View key={star} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontSize: 12, color: Colors.muted, width: 10 }}>{star}</Text>
            <Ionicons name="star" size={11} color={Colors.star} />
            <View style={{ flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' }}>
              <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: Colors.star, borderRadius: 3 }} />
            </View>
            <Text style={{ fontSize: 11, color: Colors.muted, width: 20, textAlign: 'right' }}>{count}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Vote Card ────────────────────────────────────────────────────────────────
function VoteCard({ v }: { v: any }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = v.comment && v.comment.length > 120;
  return (
    <View style={vcSt.card} testID={`vote-item-${v.vote_id}`}>
      <View style={vcSt.topRow}>
        <View style={vcSt.avatar}>
          {v.user_picture
            ? <Image source={{ uri: v.user_picture }} style={{ width: '100%', height: '100%' }} />
            : <Text style={vcSt.avatarText}>{v.user_name?.charAt(0)?.toUpperCase() || '?'}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={vcSt.name}>{v.user_name}</Text>
            <Text style={vcSt.date}>{timeAgo(v.created_at)}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 2, marginTop: 2 }}>
            {[1,2,3,4,5].map(i => (
              <Ionicons key={i} name={i <= v.rating ? 'star' : 'star-outline'} size={12}
                color={i <= v.rating ? Colors.star : Colors.muted} />
            ))}
          </View>
        </View>
      </View>
      {v.comment && (
        <>
          <Text style={vcSt.comment} numberOfLines={expanded ? undefined : 3}>{v.comment}</Text>
          {isLong && (
            <TouchableOpacity onPress={() => setExpanded(!expanded)}>
              <Text style={vcSt.readMore}>{expanded ? 'Réduire' : 'Lire la suite'}</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </View>
  );
}
const vcSt = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  topRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  name: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  date: { fontSize: 11, color: Colors.muted },
  comment: { fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  readMore: { fontSize: 12, fontWeight: '600', color: Colors.primary, marginTop: 4 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function TagPointDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { location } = useLocation();
  const { lang } = useLang();
  const { triggerProfileRefresh } = useRefresh();

  const [point, setPoint] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [votes, setVotes] = useState<any[]>([]);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showAllVotes, setShowAllVotes] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);
  const [similar, setSimilar] = useState<any[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [myVote, setMyVote] = useState<{ rating: number; comment: string | null } | null>(null);
  const [pendingStar, setPendingStar] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [voteSuccess, setVoteSuccess] = useState(false);
  const [currentRating, setCurrentRating] = useState(0);
  const [currentVotes, setCurrentVotes] = useState(0);
  const [ratingDist, setRatingDist] = useState<Record<string, number>>({});
  const [isParticipant, setIsParticipant] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [ownerActionLoading, setOwnerActionLoading] = useState(false);

  useEffect(() => {
    if (id) { loadPoint(); loadVotes(); if (user) loadMyVote(); }
  }, [id, user]);

  // Reload data when screen comes back into focus (e.g. after editing)
  useFocusEffect(
    useCallback(() => {
      if (id) { loadPoint(); if (user) loadMyVote(); loadVotes(); }
    }, [id, user])
  );

  const loadPoint = async () => {
    try {
      const data = await api.get(`/tag-points/${id}`);
      setPoint(data);
      setCurrentRating(data.rating || 0);
      setCurrentVotes(data.votes || 0);
      setRatingDist(data.rating_distribution || {});
      setIsParticipant(data.is_participant || false);
      setParticipantsCount(data.participants_count || 0);
      setIsSaved(data.is_saved || false);
      setIsPublic(data.is_public !== false);
    } catch (e: any) { Alert.alert('Erreur', e.message); }
    finally { setLoading(false); }
  };

  const handleToggleVisibility = async () => {
    setOwnerActionLoading(true);
    try {
      const res = await api.patch(`/tag-points/${id}/visibility`, {});
      setIsPublic(res.is_public);
    } catch (e: any) { Alert.alert('Erreur', e.message); }
    finally { setOwnerActionLoading(false); }
  };

  const handleDelete = () => {
    Alert.alert(
      'Supprimer ce tagPoint ?',
      'Cette action est irréversible. Le tagPoint sera définitivement supprimé.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => {
            setOwnerActionLoading(true);
            api.del(`/tag-points/${id}`)
              .then(() => {
                triggerProfileRefresh();
                setTimeout(() => router.replace('/(tabs)/map' as any), 100);
              })
              .catch((e: any) => Alert.alert('Erreur', e.message))
              .finally(() => setOwnerActionLoading(false));
          },
        },
      ]
    );
  };

  const handleEdit = () => {
    if (!point) return;
    // Merge images array + fallback image_url (for points with only a single image_url)
    const parsedImages: string[] = (() => {
      try { return Array.isArray(point.images) ? point.images : JSON.parse(point.images || '[]'); } catch { return []; }
    })();
    const allImages = parsedImages.length > 0
      ? parsedImages
      : (point.image_url ? [point.image_url] : []);
    router.push({
      pathname: '/(tabs)/create' as any,
      params: {
        editMode: 'true',
        pointId: id,
        title: point.title || '',
        description: point.description || '',
        domainId: point.domain_id || '',
        precision: point.precision || 'exact',
        tagIds: JSON.stringify(point.tags?.map((t: any) => t.tag_id) || []),
        images: JSON.stringify(allImages),
        eventDate: point.event_date || '',
        eventEndDate: point.event_end_date || '',
        eventSchedule: point.event_schedule ? JSON.stringify(point.event_schedule) : '',
        lat: String(point.latitude ?? ''),
        lng: String(point.longitude ?? ''),
      },
    });
  };

  const loadMyVote = async () => {
    try {
      const data = await api.get(`/tag-points/${id}/my-vote`);
      if (data.exists) setMyVote({ rating: data.rating, comment: data.comment });
    } catch {}
  };

  const loadVotes = async () => {
    try { setVotes(await api.get(`/tag-points/${id}/votes`)); } catch {}
  };

  const openVoteModal = () => {
    setPendingStar(myVote?.rating || 0);
    setComment(myVote?.comment || '');
    setVoteSuccess(false);
    setShowVoteModal(true);
  };

  const handleVoteSubmit = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour voter.'); return; }
    if (pendingStar === 0) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/tag-points/${id}/vote`, { rating: pendingStar, comment: comment.trim() || null });
      setCurrentRating(res.avg_rating); setCurrentVotes(res.vote_count);
      setMyVote({ rating: pendingStar, comment: comment.trim() || null });
      setVoteSuccess(true); setComment(''); setPendingStar(0);
      loadVotes(); loadPoint();
      setTimeout(() => { setVoteSuccess(false); setShowVoteModal(false); }, 1500);
    } catch (e: any) { Alert.alert('Erreur', e.message || "Impossible d'envoyer"); }
    finally { setSubmitting(false); }
  };

  const toggleRSVP = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour participer.'); return; }
    setRsvpLoading(true);
    try {
      const res = isParticipant
        ? await api.del(`/tag-points/${id}/leave`)
        : await api.post(`/tag-points/${id}/join`, {});
      setIsParticipant(res.is_participant);
      setParticipantsCount(res.participants_count);
    } catch (e: any) { Alert.alert('Erreur', e.message); }
    finally { setRsvpLoading(false); }
  };

  const openSimilar = async () => {
    setShowSimilar(true);
    if (similar.length > 0) return;
    setLoadingSimilar(true);
    try { setSimilar(await api.get(`/tag-points/${id}/similar`)); } catch {}
    setLoadingSimilar(false);
  };

  const toggleSave = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour sauvegarder.'); return; }
    setSaveLoading(true);
    try {
      const res = isSaved
        ? await api.del(`/tag-points/${id}/unsave`)
        : await api.post(`/tag-points/${id}/save`, {});
      setIsSaved(res.is_saved);
    } catch (e: any) { Alert.alert('Erreur', e.message); }
    finally { setSaveLoading(false); }
  };

  const toggleNewDateComing = async () => {
    if (!user) return;
    try {
      const res = await api.patch(`/tag-points/${id}/new-date`, {});
      setPoint((prev: any) => ({ ...prev, new_date_coming: res.new_date_coming }));
    } catch (e: any) { Alert.alert('Erreur', e.message); }
  };

  const getPrecisionRadius = (p: string) => p === '100m' ? 100 : p === '1000m' ? 1000 : 0;

  if (loading) return (
    <View style={st.screen}><Stack.Screen options={{ headerShown: false }} /><TagPointSkeleton /></View>
  );
  if (!point) return (
    <View style={[st.screen, { alignItems: 'center', justifyContent: 'center' }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <Ionicons name="alert-circle-outline" size={48} color={Colors.muted} />
      <Text style={{ color: Colors.muted, marginTop: 8 }}>TagPoint introuvable</Text>
    </View>
  );

  const lat = point.latitude ?? point.location?.coordinates?.[1];
  const lng = point.longitude ?? point.location?.coordinates?.[0];
  const tags: any[] = point.tags || [];
  const images: string[] = (() => {
    try { return Array.isArray(point.images) ? point.images : JSON.parse(point.images || '[]'); } catch { return []; }
  })();
  const distanceStr = (lat != null && lng != null)
    ? formatDistance(haversineDistance(location.lat, location.lng, lat, lng)) : '---';
  const isOwner = !!(user && point.owner && user.user_id === point.owner.user_id);

  return (
    <View style={st.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map' as any)} style={st.headerBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={st.headerTitle}>Détails</Text>
          <View style={{ flexDirection: 'row', gap: Spacing.md }}>
            <TouchableOpacity onPress={() => router.push('/set-location' as any)} style={st.headerBtn}>
              <Ionicons name="location" size={22} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/(tabs)/search' as any)} style={st.headerBtn}>
              <Ionicons name="search" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Barre d'actions propriétaire */}
      {isOwner && (
        <View style={st.ownerBar} testID="owner-action-bar">
          <TouchableOpacity style={st.ownerBarBtn} onPress={handleEdit} testID="edit-btn" disabled={ownerActionLoading}>
            <Ionicons name="create-outline" size={18} color={Colors.primary} />
            <Text style={st.ownerBarBtnText}>Modifier</Text>
          </TouchableOpacity>
          <View style={st.ownerBarDivider} />
          <TouchableOpacity style={st.ownerBarBtn} onPress={handleToggleVisibility} testID="visibility-btn" disabled={ownerActionLoading}>
            <Ionicons name={isPublic ? 'eye-outline' : 'eye-off-outline'} size={18} color={isPublic ? Colors.foreground : Colors.muted} />
            <Text style={[st.ownerBarBtnText, !isPublic && { color: Colors.muted }]}>
              {isPublic ? 'Visible' : 'Masqué'}
            </Text>
          </TouchableOpacity>
          <View style={st.ownerBarDivider} />
          <TouchableOpacity style={[st.ownerBarBtn, { gap: 4 }]} onPress={handleDelete} testID="delete-btn" disabled={ownerActionLoading}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
            <Text style={[st.ownerBarBtnText, { color: '#EF4444' }]}>Supprimer</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* 1. Image Carousel */}
        <View style={{ marginHorizontal: Spacing.md, marginTop: Spacing.md }}>
          <ImageCarousel images={images} fallback={point.image_url} />
          {/* Owner avatar overlay */}
          {point.owner && (
            <TouchableOpacity
              style={st.ownerBadge}
              onPress={() => point.owner.role === 'coach' && router.push(`/coach/${point.owner.user_id}` as any)}
              activeOpacity={point.owner.role === 'coach' ? 0.7 : 1}
              testID="owner-avatar"
            >
              <View style={st.ownerAvatar}>
                {point.owner.picture
                  ? <Image source={{ uri: point.owner.picture }} style={{ width: '100%', height: '100%' }} />
                  : <Text style={st.ownerInitial}>{point.owner.name?.charAt(0)?.toUpperCase() || '?'}</Text>}
              </View>
              <View>
                <Text style={st.ownerName}>{point.owner.name}</Text>
                {point.owner.role === 'coach' && <Text style={st.ownerRole}>Coach →</Text>}
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* 2. Titre + distance + tags */}
        <View style={st.titleSection}>
          <Text style={st.title}>{point.title}</Text>
          <View style={st.metaRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="location-outline" size={15} color={Colors.primary} />
              <Text style={st.distText} testID="tagpoint-distance">{distanceStr}</Text>
            </View>
            <TouchableOpacity style={st.ratingTap} onPress={!isOwner ? openVoteModal : undefined} testID="open-vote-modal-btn" disabled={isOwner}>
              {[1,2,3,4,5].map(i => (
                <Ionicons key={i} name={i <= Math.round(currentRating) ? 'star' : 'star-outline'}
                  size={14} color={i <= Math.round(currentRating) ? Colors.star : Colors.muted} />
              ))}
              {currentVotes > 0 && <Text style={st.ratingCount}>{currentRating.toFixed(1)} ({currentVotes})</Text>}
            </TouchableOpacity>
          </View>

          {/* Tags colorés */}
          {tags.length > 0 && (
            <View style={st.tagsRow}>
              {tags.map(tag => (
                <View key={tag.tag_id} style={[st.tagPill, { backgroundColor: tagColor(tag.category_id) + '22', borderColor: tagColor(tag.category_id) }]}>
                  <Text style={[st.tagText, { color: tagColor(tag.category_id) }]}>
                    {lang === 'fr' ? tag.label_fr : tag.label_en}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 3. Date & Horaire */}
        {(point.event_date || point.event_schedule) && (() => {
          // Mutual exclusivity: prefer event_schedule (recurring) over event_date (once)
          const showRecurring = !!point.event_schedule;
          const showOnce = !showRecurring && !!point.event_date;
          const isPast = showOnce && point.event_date ? new Date(point.event_date) < new Date() : false;
          const isCreator = user?.user_id === point.user_id;
          return (
            <View style={[st.dateCard, isPast && st.dateCardPast]}>
              {showOnce && (
                <View style={st.dateRow}>
                  <View style={[st.dateIconBox, isPast && st.dateIconBoxPast]}>
                    <Ionicons name={isPast ? 'calendar-outline' : 'calendar'} size={20} color={isPast ? Colors.muted : Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={[st.dateLabel, isPast && { color: Colors.muted }]}>
                        {isPast ? 'Événement passé' : 'Prochain événement'}
                      </Text>
                      {isPast && (
                        <View style={st.pastBadge}>
                          <Text style={st.pastBadgeText}>Passé</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[st.dateValue, isPast && { color: Colors.muted }]}>
                      {formatEventDate(point.event_date)}
                      {point.event_end_date && (
                        ` → ${new Date(point.event_end_date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                      )}
                    </Text>
                    <Text style={st.dateSub}>{formatEventDateFull(point.event_date)}</Text>
                  </View>
                </View>
              )}
              {showRecurring && (() => {
                const rec = formatRecurring(point.event_schedule);
                return (
                  <View>
                    <View style={st.dateRow}>
                      <View style={st.dateIconBox}>
                        <Ionicons name="repeat-outline" size={20} color={Colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={st.dateLabel}>Récurrent</Text>
                        <Text style={st.dateValue}>{rec.summary}</Text>
                      </View>
                    </View>
                    {/* Per-day schedule table */}
                    {rec.perDay && rec.perDay.length > 0 && (
                      <View style={st.scheduleTable}>
                        {rec.perDay.map((entry, idx) => (
                          <View key={idx} style={[st.scheduleRow, idx < rec.perDay!.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border + '60' }]}>
                            <Text style={st.scheduleDayText}>{entry.day}</Text>
                            <View style={st.scheduleTimesRow}>
                              {entry.times.map((t, ti) => (
                                <View key={ti} style={st.scheduleTimeChip}>
                                  <Text style={st.scheduleTimeChipText}>{t}</Text>
                                </View>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })()}
              {/* Banner: bientôt une nouvelle date */}
              {point.new_date_coming && (
                <View style={st.newDateBanner}>
                  <Ionicons name="time-outline" size={15} color={Colors.primary} />
                  <Text style={st.newDateBannerText}>Bientôt une nouvelle date</Text>
                </View>
              )}
              {/* Creator toggle (only visible when event is past) */}
              {isPast && isCreator && (
                <TouchableOpacity style={st.newDateToggle} onPress={toggleNewDateComing} testID="new-date-toggle">
                  <Ionicons
                    name={point.new_date_coming ? 'checkmark-circle' : 'add-circle-outline'}
                    size={16} color={Colors.primary}
                  />
                  <Text style={st.newDateToggleText}>
                    {point.new_date_coming ? 'Retirer "Nouvelle date"' : 'Annoncer une nouvelle date'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {/* 4. RSVP + Message sur la même ligne */}
        {!isOwner && (
        <View style={st.rsvpRow}>
          <TouchableOpacity
            style={[st.rsvpBtn, isParticipant && st.rsvpBtnActive]}
            onPress={toggleRSVP}
            disabled={rsvpLoading}
            testID="rsvp-button"
          >
            {rsvpLoading
              ? <ActivityIndicator color={isParticipant ? Colors.primary : Colors.background} size="small" />
              : <>
                  <Ionicons name={isParticipant ? 'checkmark-circle' : 'add-circle-outline'}
                    size={18} color={isParticipant ? Colors.primary : Colors.background} />
                  <Text style={[st.rsvpText, isParticipant && st.rsvpTextActive]}>
                    {isParticipant ? 'Je participe' : 'Rejoindre'}
                  </Text>
                </>}
          </TouchableOpacity>

          {participantsCount > 0 && (
            <Text style={st.rsvpCount} testID="participants-count">
              {participantsCount} participant{participantsCount > 1 ? 's' : ''}
            </Text>
          )}

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={st.msgBtn}
            onPress={() => Alert.alert('Chat', 'Bientôt disponible !')}
            testID="message-button"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={20} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
        )}

        <View style={st.actionsRow}>
          <TouchableOpacity style={st.actionBtn} onPress={openSimilar} activeOpacity={0.7} testID="similar-btn">
            <View style={st.actionIcon}>
              <Ionicons name="layers-outline" size={26} color={Colors.foreground} />
            </View>
            <Text style={st.actionLabel}>Similaires</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={st.actionBtn}
            onPress={async () => { try { await Share.share({ message: `"${point.title}" sur WINEK !` }); } catch {} }}
            activeOpacity={0.7}
            testID="share-btn"
          >
            <View style={st.actionIcon}>
              <Ionicons name="share-social-outline" size={26} color={Colors.foreground} />
            </View>
            <Text style={st.actionLabel}>Partager</Text>
          </TouchableOpacity>

          {!isOwner && (
          <TouchableOpacity style={st.actionBtn} onPress={toggleSave} disabled={saveLoading} activeOpacity={0.7} testID="save-btn">
            <View style={[st.actionIcon, isSaved && st.actionIconSaved]}>
              {saveLoading
                ? <ActivityIndicator size="small" color={isSaved ? Colors.primary : Colors.foreground} />
                : <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={26} color={isSaved ? Colors.primary : Colors.foreground} />}
            </View>
            <Text style={[st.actionLabel, isSaved && { color: Colors.primary }]}>
              {isSaved ? 'Enregistré' : 'Sauvegarder'}
            </Text>
          </TouchableOpacity>
          )}
        </View>

        {/* 6. Map */}
        {lat != null && lng != null && (
          <View style={st.mapWrap}>
            <MapViewComponent centerLat={lat} centerLng={lng}
              zoom={getPrecisionRadius(point.precision) > 500 ? 14 : 16}
              precisionRadius={getPrecisionRadius(point.precision)}
              selectedLat={lat} selectedLng={lng} />
          </View>
        )}

        {/* 7. Description */}
        {point.description && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>Description</Text>
            <MarkdownText
              text={showFullDesc ? point.description : point.description.slice(0, 150) + (point.description.length > 150 ? '…' : '')}
              style={st.descText}
            />
            {point.description.length > 150 && (
              <TouchableOpacity onPress={() => setShowFullDesc(!showFullDesc)}>
                <Text style={st.showMore}>{showFullDesc ? 'Réduire' : 'Voir plus'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* 8. Avis */}
        {(currentVotes > 0) && (
          <View style={st.section}>
            <View style={st.reviewsHeader}>
              <View style={st.reviewsBig}>
                <Text style={st.reviewsNum}>{currentRating.toFixed(1)}</Text>
                <View>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {[1,2,3,4,5].map(i => (
                      <Ionicons key={i} name={i <= Math.round(currentRating) ? 'star' : 'star-outline'}
                        size={16} color={i <= Math.round(currentRating) ? Colors.star : Colors.muted} />
                    ))}
                  </View>
                  <Text style={st.reviewsCountTxt}>{currentVotes} avis</Text>
                </View>
              </View>
              <View style={{ flex: 1, paddingLeft: Spacing.md }}>
                <RatingBars dist={ratingDist} total={currentVotes} />
              </View>
            </View>

            {votes.slice(0, 3).map(v => <VoteCard key={v.vote_id} v={v} />)}
            {votes.length > 3 && (
              <TouchableOpacity style={st.seeAllBtn} onPress={() => setShowAllVotes(true)} testID="see-all-votes-btn">
                <Text style={st.seeAllText}>Voir les {votes.length} avis</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {/* FAB Voter */}
      {!isOwner && (
      <TouchableOpacity style={st.fab} onPress={openVoteModal} testID="fab-vote">
        <Ionicons name="star" size={22} color={Colors.background} />
      </TouchableOpacity>
      )}

      {/* ── Modals ── */}

      {/* Tous les avis */}
      <Modal visible={showAllVotes} animationType="slide" transparent onRequestClose={() => setShowAllVotes(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowAllVotes(false)} />
          <View style={[ms.sheet, { maxHeight: '90%' }]}>
            <View style={ms.header}>
              <View>
                <Text style={ms.title}>{votes.length} avis</Text>
                <Text style={{ fontSize: 13, color: Colors.muted }}>{currentRating.toFixed(1)} / 5</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAllVotes(false)}>
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40 }}>
              {votes.map(v => <VoteCard key={v.vote_id} v={v} />)}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Similaires */}
      <Modal visible={showSimilar} animationType="slide" transparent onRequestClose={() => setShowSimilar(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowSimilar(false)} />
          <View style={[ms.sheet, { maxHeight: '80%' }]}>
            <View style={ms.header}>
              <Text style={ms.title}>TagPoints similaires</Text>
              <TouchableOpacity onPress={() => setShowSimilar(false)}>
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            {loadingSimilar
              ? <View style={{ padding: Spacing.xl, alignItems: 'center' }}><ActivityIndicator color={Colors.primary} size="large" /></View>
              : similar.length === 0
                ? <View style={{ padding: Spacing.xl, alignItems: 'center' }}>
                    <Ionicons name="search-outline" size={40} color={Colors.muted} />
                    <Text style={{ color: Colors.muted, marginTop: 8 }}>Aucun résultat similaire</Text>
                  </View>
                : (
                  <ScrollView contentContainerStyle={{ padding: Spacing.md, gap: 12 }}>
                    {similar.reduce<any[][]>((rows, item, i) => {
                      if (i % 2 === 0) rows.push([item]); else rows[rows.length - 1].push(item); return rows;
                    }, []).map((row, ri) => (
                      <View key={ri} style={{ flexDirection: 'row', gap: 12 }}>
                        {row.map((item: any) => (
                          <TouchableOpacity key={item.point_id} style={ms.simCard}
                            onPress={() => { setShowSimilar(false); router.replace(`/tag-point/${item.point_id}` as any); }}
                            testID={`similar-card-${item.point_id}`}>
                            <View style={ms.simImg}>
                              {item.image_url
                                ? <Image source={{ uri: item.image_url }} style={{ width: '100%', height: '100%', borderRadius: Radius.md }} />
                                : <View style={{ flex: 1, backgroundColor: Colors.border, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' }}>
                                    <Ionicons name="image-outline" size={24} color={Colors.muted} />
                                  </View>}
                            </View>
                            <Text style={ms.simTitle} numberOfLines={2}>{item.title}</Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 }}>
                              <Ionicons name="location-outline" size={11} color={Colors.primary} />
                              <Text style={ms.simDist}>
                                {item.dist_m != null ? (item.dist_m < 1000 ? `${Math.round(item.dist_m)}m` : `${(item.dist_m/1000).toFixed(1)}km`) : '---'}
                              </Text>
                            </View>
                          </TouchableOpacity>
                        ))}
                        {row.length === 1 && <View style={{ flex: 1 }} />}
                      </View>
                    ))}
                    <View style={{ height: 20 }} />
                  </ScrollView>
                )}
          </View>
        </View>
      </Modal>

      {/* Vote Modal */}
      <Modal visible={showVoteModal} animationType="slide" transparent onRequestClose={() => setShowVoteModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={ms.overlay}>
            <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowVoteModal(false)} />
            <View style={ms.sheet}>
              <View style={ms.header}>
                <Text style={ms.title}>{myVote ? 'Modifier votre avis' : 'Votre avis'}</Text>
                <TouchableOpacity onPress={() => setShowVoteModal(false)}>
                  <Ionicons name="close" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>
              {voteSuccess
                ? <View style={{ alignItems: 'center', paddingVertical: Spacing.xl }}>
                    <Ionicons name="checkmark-circle" size={56} color={Colors.primary} />
                    <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.foreground, marginTop: Spacing.md }}>Vote enregistré !</Text>
                  </View>
                : (
                  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <View style={{ alignItems: 'center', marginBottom: Spacing.sm }}>
                      <InteractiveStars value={pendingStar} onChange={setPendingStar} size={38} />
                    </View>
                    {pendingStar > 0 && (
                      <Text style={{ textAlign: 'center', fontSize: 14, color: Colors.primary, fontWeight: '600', marginBottom: Spacing.md }}>
                        {['','Mauvais','Moyen','Bien','Très bien','Excellent'][pendingStar]}
                      </Text>
                    )}
                    <TextInput
                      style={ms.input}
                      placeholder="Commentaire (optionnel)…"
                      placeholderTextColor={Colors.muted}
                      value={comment} onChangeText={setComment}
                      multiline numberOfLines={3} textAlignVertical="top"
                      testID="vote-comment-input"
                    />
                    <TouchableOpacity
                      style={[ms.submitBtn, (submitting || pendingStar === 0) && { opacity: 0.4 }]}
                      onPress={handleVoteSubmit} disabled={submitting || pendingStar === 0}
                      testID="vote-submit-btn">
                      {submitting
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={ms.submitText}>Envoyer</Text>}
                    </TouchableOpacity>
                    <View style={{ height: 20 }} />
                  </ScrollView>
                )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.header },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerBtn: { padding: 4 },
  ownerBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.header, borderBottomWidth: 1, borderBottomColor: Colors.border },
  ownerBarBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  ownerBarBtnText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  ownerBarDivider: { width: 1, height: 20, backgroundColor: Colors.border },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  scroll: { flex: 1, backgroundColor: Colors.background },

  ownerBadge: { position: 'absolute', bottom: -16, left: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.full, paddingRight: 12, paddingVertical: 4, paddingLeft: 4, borderWidth: 1, borderColor: Colors.border },
  ownerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ownerInitial: { fontSize: 15, fontWeight: '700', color: Colors.background },
  ownerName: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  ownerRole: { fontSize: 11, color: Colors.primary },

  titleSection: { paddingHorizontal: Spacing.md, paddingTop: 28, paddingBottom: Spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  distText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  ratingTap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingCount: { fontSize: 12, color: Colors.muted, marginLeft: 4 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tagPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1.5 },
  tagText: { fontSize: 13, fontWeight: '600' },

  scheduleBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginHorizontal: Spacing.md, marginBottom: Spacing.md, backgroundColor: Colors.card, padding: Spacing.md, borderRadius: Radius.lg, borderLeftWidth: 3, borderLeftColor: Colors.primary },
  scheduleText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },

  // Date card
  dateCard: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  dateCardPast: { borderColor: Colors.border },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  dateIconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dateIconBoxPast: { backgroundColor: Colors.card, borderColor: Colors.border },
  dateLabel: { fontSize: 11, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  dateValue: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  dateSub: { fontSize: 12, color: Colors.muted, marginTop: 2, textTransform: 'capitalize' },
  dateSep: { height: 1, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
  // Per-day recurring schedule table
  scheduleTable: { marginHorizontal: Spacing.md, marginTop: 8, marginBottom: 4, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 9 },
  scheduleDayText: { fontSize: 12, fontWeight: '800', color: Colors.foreground, width: 72 },
  scheduleTimesRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scheduleTimeChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary + '40' },
  scheduleTimeChipText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  pastBadge: { backgroundColor: Colors.border, borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2 },
  pastBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  newDateBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.md, marginBottom: Spacing.sm, backgroundColor: Colors.primary + '15', borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  newDateBannerText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  newDateToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: Spacing.md, marginBottom: Spacing.md, paddingVertical: Spacing.sm },
  newDateToggleText: { fontSize: 13, color: Colors.primary, fontWeight: '500' },

  rsvpRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  rsvpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full },
  rsvpBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  rsvpText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  rsvpTextActive: { color: Colors.primary },
  rsvpCount: { fontSize: 13, color: Colors.muted },
  msgBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },

  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.header, marginHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full, gap: Spacing.sm, marginBottom: Spacing.sm },
  messageBtnText: { fontSize: 14, fontWeight: '600', color: Colors.foreground },

  actionsRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: Spacing.md, justifyContent: 'space-around' },
  actionBtn: { flex: 1, alignItems: 'center', gap: 8 },
  actionIcon: { width: 54, height: 54, borderRadius: Radius.lg, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  actionIconSaved: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  actionLabel: { fontSize: 12, color: Colors.muted, fontWeight: '500' },

  mapWrap: { height: 180, marginHorizontal: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', marginBottom: Spacing.md },

  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.md },
  descText: { fontSize: 15, color: Colors.muted, lineHeight: 22 },
  showMore: { fontSize: 14, fontWeight: '600', color: Colors.primary, textAlign: 'center', marginTop: Spacing.sm },

  reviewsHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: Spacing.md },
  reviewsBig: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  reviewsNum: { fontSize: 44, fontWeight: '800', color: Colors.foreground, lineHeight: 50 },
  reviewsCountTxt: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: Spacing.sm, marginTop: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border },
  seeAllText: { fontSize: 14, fontWeight: '600', color: Colors.primary },

  fab: { position: 'absolute', bottom: 32, right: 20, width: 54, height: 54, borderRadius: 27, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  title: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  input: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, color: Colors.foreground, fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md, alignItems: 'center' },
  submitText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  simCard: { flex: 1, backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.sm },
  simImg: { height: 100, borderRadius: Radius.md, marginBottom: Spacing.sm, overflow: 'hidden' },
  simTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground, lineHeight: 18 },
  simDist: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
});
