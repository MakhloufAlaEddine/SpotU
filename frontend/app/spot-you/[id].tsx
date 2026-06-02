import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, FlatList, Dimensions,
  ActivityIndicator, TouchableOpacity, Alert, Image, Share,
  TextInput, Modal, KeyboardAvoidingView, Platform, Animated, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, Stack, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapPreview } from '../../components/MapPreview';
import { TagImage, DOMAIN_COLORS, DOMAIN_ICONS } from '../../components/TagImage';
import { MarkdownText } from '../../components/RichTextInput';
import ConfirmActionModal, { ConfirmAction } from '../../components/ConfirmActionModal';
import { api } from '../../lib/api';
import { getOrCreateConversation } from '../../lib/chat';
import { storage } from '../../lib/storage';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from '../../context/LocationContext';
import { useLang } from '../../context/LanguageContext';
import { useRefresh } from '../../context/RefreshContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { haversineDistance, formatDistance } from '../../utils/distance';
import { useClickSound } from '../../hooks/useClickSound';
import { useNetwork } from '../../hooks/useNetwork';
import { StaleBanner, ErrorNoData, ContentDeletedState } from '../../components/OfflineBanner';
import { buildCacheKey, cacheGet, cacheSet, isFresh, cacheAgeMinutes, getTtl, SCHEMA_VERSION, cacheInvalidate } from '../../lib/cache';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';
import { InviteModal } from '../../components/InviteModal';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const BASE_WS = BASE_URL.replace('https://', 'wss://').replace('http://', 'ws://');

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
  const now = new Date();
  // JS getDay(): 0=Dim..6=Sam → notre idx: 0=Lun..6=Dim
  const todayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;

  const computeNext = (dayIdx: number, startTime: string, endTime: string | null) => {
    const [h, m] = startTime.split(':').map(Number);
    let daysUntil = (dayIdx - todayIdx + 7) % 7;
    if (daysUntil === 0 && (h * 60 + m) <= (now.getHours() * 60 + now.getMinutes())) daysUntil = 7;
    const d = new Date(now);
    d.setDate(now.getDate() + daysUntil);
    d.setHours(h, m, 0, 0);
    return { date: d, startTime, endTime };
  };

  // Format nouveau: { schedule: {'2': [{start:'19:00', end:'20:00'}]} }
  if (s.schedule && typeof s.schedule === 'object') {
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
      const candidate = computeNext(dayIdx, startTime, endTime);
      if (!earliest || candidate.date < earliest.date) earliest = candidate;
    });
    return earliest;
  }
  // Format intermédiaire: { days:[3], times:['19:00'] }
  if (s.days && s.times) {
    const days: number[] = s.days;
    const time: string = (s.times as string[])[0];
    if (!time) return null;
    let earliest: { date: Date; startTime: string; endTime: string | null } | null = null;
    days.forEach(dayIdx => {
      const candidate = computeNext(dayIdx, time, null);
      if (!earliest || candidate.date < earliest.date) earliest = candidate;
    });
    return earliest;
  }
  // Format legacy: { day:3, time:'19:00' }
  if (s.day !== undefined && s.time) {
    return computeNext(s.day, s.time, null);
  }
  return null;
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
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  // Comparer les dates calendaires (pas les timestamps) pour éviter "Aujourd'hui" quand c'est demain
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.round((eventDay.getTime() - today.getTime()) / 86400000);
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

function formatTimeOnly(d?: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
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

function SpotYouSkeleton() {
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
function ImageCarousel({ images, domainId }: { images: string[]; domainId?: string }) {
  const [index, setIndex] = useState(0);
  if (images.length === 0) {
    return (
      <View style={carSt.box}>
        <View style={carSt.placeholder}><Ionicons name="image-outline" size={64} color={Colors.muted} /></View>
      </View>
    );
  }
  return (
    <View style={carSt.box}>
      <FlatList
        data={images}
        horizontal pagingEnabled showsHorizontalScrollIndicator={false}
        keyExtractor={(_, i) => String(i)}
        onMomentumScrollEnd={e => setIndex(Math.round(e.nativeEvent.contentOffset.x / (SCREEN_W - Spacing.md * 2)))}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_W - Spacing.md * 2, height: 220 }}>
            <TagImage uri={item} domainId={domainId} style={{ width: '100%', height: '100%' }} iconSize={50} />
          </View>
        )}
      />
      {images.length > 1 && (
        <View style={carSt.dots}>
          {images.map((_, i) => (
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
export default function SpotYouDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useGuardedRouter();
  const { user } = useAuth();
  const { location } = useLocation();
  const { lang } = useLang();
  const { triggerProfileRefresh } = useRefresh();
  const { playClickSound } = useClickSound();
  const { isOnline } = useNetwork();

  const [point, setPoint] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [screenState, setScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);
  const [contentNotFound, setContentNotFound] = useState(false);
  const [votes, setVotes] = useState<any[]>([]);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [showAllVotes, setShowAllVotes] = useState(false);
  const [showSimilar, setShowSimilar] = useState(false);
  const [showParticipants, setShowParticipants] = useState(false);
  const [showGoingList, setShowGoingList] = useState(false);
  const [goingList, setGoingList] = useState<any[]>([]);
  const [goingListLoading, setGoingListLoading] = useState(false);
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
  const [isMember, setIsMember] = useState(false);
  const [joinStatus, setJoinStatus] = useState<'accepted' | 'pending' | 'invited' | null>(null);
  const [canParticipate, setCanParticipate] = useState(false);
  const [isGoing, setIsGoing] = useState(false);
  const [goingCount, setGoingCount] = useState(0);
  const [maxParticipants, setMaxParticipants] = useState<number | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [participantsCount, setParticipantsCount] = useState(0);
  const [activityFeed, setActivityFeed] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [participantsLoading, setParticipantsLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const [goingLoading, setGoingLoading] = useState(false);
  const [ownerActionLoading, setOwnerActionLoading] = useState(false);
  const [showExactAddress, setShowExactAddress] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [pendingRequests, setPendingRequests] = useState<any[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [conflictBanner, setConflictBanner] = useState<string | null>(null);

  // ── Animation pulse bouton Marketplace ───────────────────────────────────
  const marketplacePulse = useRef(new Animated.Value(1)).current;
  const marketplaceGlow  = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(marketplacePulse, { toValue: 1.18, duration: 700, useNativeDriver: true }),
          Animated.timing(marketplaceGlow,  { toValue: 1,    duration: 700, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(marketplacePulse, { toValue: 1,    duration: 700, useNativeDriver: true }),
          Animated.timing(marketplaceGlow,  { toValue: 0,    duration: 700, useNativeDriver: true }),
        ]),
        Animated.delay(1200),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  // ── Refresh debounced — une seule source de vérité ────────────────────────
  // Ref toujours fraîche (pas de stale closure). Debounce 200ms pour éviter
  // des fetches concurrents quand WS + doRSVP déclenchent un refresh simultané.
  const refreshAllRef = useRef<() => void>(() => {});
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    refreshAllRef.current = () => {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        loadPoint(true);
        loadParticipants();
        loadPendingRequests();
        loadGoingList();
      }, 200);
    };
  });

  // Pull-to-refresh manuel
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadPoint(true), loadParticipants(), loadPendingRequests(), loadGoingList(), loadVotes()]);
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  // ── WebSocket avec auto-reconnect ──────────────────────────────────────────
  const wsRef = useRef<WebSocket | null>(null);
  const wsPointIdRef = useRef<string | null>(null);
  const shouldReconnectRef = useRef(false);

  const connectLive = useCallback(async (pointId: string) => {
    // Ne pas recréer si déjà connecté sur ce point
    if (wsRef.current?.readyState === WebSocket.OPEN && wsPointIdRef.current === pointId) return;
    wsRef.current?.close();
    wsRef.current = null;

    const token = await storage.get('spotu_token');
    if (!token) return;

    const ws = new WebSocket(`${BASE_WS}/api/ws/spot-you/${pointId}`);
    wsRef.current = ws;
    wsPointIdRef.current = pointId;

    ws.onopen = () => ws.send(JSON.stringify({ token }));

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'spotyou_update') {
          // Feedback immédiat sur les compteurs
          if (data.participants_count !== undefined) setParticipantsCount(data.participants_count);
          if (data.going_count !== undefined) setGoingCount(data.going_count);
          if (data.is_full !== undefined) setIsFull(data.is_full);
          // Un seul refresh debounced pour les listes (pas de fetch concurrent)
          refreshAllRef.current();
        }
      } catch {}
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      wsRef.current = null;
      wsPointIdRef.current = null;
      // Auto-reconnect si l'écran est encore visible
      if (shouldReconnectRef.current) {
        setTimeout(() => {
          if (shouldReconnectRef.current) connectLive(pointId);
        }, 2000);
      }
    };
  }, []);

  // useFocusEffect unique : WS + refresh au focus, cleanup au blur
  useFocusEffect(
    useCallback(() => {
      shouldReconnectRef.current = true;
      if (id) {
        connectLive(id);
        refreshAllRef.current(); // données fraîches au retour sur l'écran
      }
      return () => {
        shouldReconnectRef.current = false;
        if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
        wsRef.current?.close();
        wsRef.current = null;
        wsPointIdRef.current = null;
      };
    }, [id, connectLive])
  );

  // Chargement initial (premier montage uniquement)
  useEffect(() => {
    if (id) { loadPoint(); loadVotes(); loadParticipants(); loadPendingRequests(); loadGoingList(); if (user) loadMyVote(); }
  }, [id, user]);

  const loadPoint = async (isRefresh = false) => {
    const userId = user?.user_id;
    const cacheKey = buildCacheKey({ path: `/tag-points/${id}`, userId, schemaVersion: SCHEMA_VERSION });
    const ttl = getTtl(`/tag-points/${id}`) ?? 5 * 60_000;

    // Helper local pour appliquer les données du point
    const applyData = (data: any) => {
      setPoint(data);
      setCurrentRating(data.rating || 0);
      setCurrentVotes(data.votes || 0);
      setRatingDist(data.rating_distribution || {});
      setIsParticipant(data.is_participant || data.is_member || false);
      setIsMember(data.is_member || data.is_participant || false);
      setCanParticipate(data.can_participate ?? false);
      setJoinStatus(data.join_status || null);
      setIsGoing(data.is_going || false);
      setGoingCount(data.going_count ?? 0);
      setMaxParticipants(data.maximum_participants ?? null);
      setIsFull(data.is_full || false);
      setParticipantsCount(data.participants_count || 0);
      setIsSaved(data.is_saved || false);
    };

    // Étape 1 : lecture cache sur le premier chargement
    if (!isRefresh) {
      const cached = await cacheGet<any>(cacheKey);
      if (cached?.data) {
        applyData(cached.data);
        setLoading(false);
        const fresh = isFresh(cached);
        setScreenState(fresh ? 'ready_fresh' : 'ready_cached');
        setStaleMinutes(fresh ? null : cacheAgeMinutes(cached));
        if (fresh) return;
        // Stale : continuer le fetch en arrière-plan
      }
    }

    // Étape 2 : fetch réseau
    try {
      const data = await api.get(`/tag-points/${id}`);
      applyData(data);
      setScreenState('ready_fresh');
      setStaleMinutes(null);
      setNetworkFailed(false);
      await cacheSet(cacheKey, data, ttl);
      const member = data.is_member || data.is_participant;
      if (member) loadActivity();
    } catch (e: any) {
      // Détection 404 / contenu supprimé — pas d'écran d'erreur réseau, état "non disponible" propre
      const status = e?.statusCode ?? e?.status ?? (typeof e === 'object' && e?.message?.includes('404') ? 404 : 0);
      if (status === 404 || status === 410) {
        setContentNotFound(true);
        setLoading(false);
        return;
      }
      // Données supprimées (active=false) détectées côté API et renvoyées avec 404
      setNetworkFailed(true);
      setPoint(prev => {
        if (prev !== null) setScreenState('ready_cached');
        else setScreenState('error_no_data');
        return prev;
      });
    } finally {
      setLoading(false);
    }
  };

  // ─── Helpers de date relative ─────────────────────────────────────────────
  const relativeTime = (iso: string): string => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)     return 'à l\'instant';
    if (diff < 3600)   return `il y a ${Math.floor(diff / 60)} min`;
    if (diff < 86400)  return `il y a ${Math.floor(diff / 3600)}h`;
    if (diff < 172800) return 'hier';
    if (diff < 604800) return `il y a ${Math.floor(diff / 86400)} j`;
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  };

  // ─── Chargement du fil d'activité ─────────────────────────────────────────
  const loadActivity = async () => {
    setActivityLoading(true);
    try {
      const data = await api.get(`/spot-you/${id}/activity`);
      setActivityFeed(data.activities || []);
    } catch {
      // Silencieux : le fil d'activité n'est pas critique
    } finally {
      setActivityLoading(false);
    }
  };

  const handleDelete = () => {
    const memberCount = participants.filter(p => !p.is_creator).length;
    const msg = memberCount > 0
      ? `Les ${memberCount} membre${memberCount > 1 ? 's' : ''} du SpotYou seront notifiés. Le SpotYou sera masqué publiquement. Vos médias sont conservés 90 jours.`
      : 'Le SpotYou sera masqué publiquement. Vos médias sont conservés 90 jours — vous pouvez le réactiver depuis votre profil.';
    Alert.alert('Désactiver ce SpotYou ?', msg, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Désactiver', style: 'destructive',
        onPress: () => {
          setOwnerActionLoading(true);
          api.delete(`/tag-points/${id}`)
            .then(() => {
              triggerProfileRefresh();
              setTimeout(() => router.replace('/(tabs)/map' as any), 100);
            })
            .catch((e: any) => Alert.alert('Erreur', e.message))
            .finally(() => setOwnerActionLoading(false));
        },
      },
    ]);
  };

  const handleReactivate = () => {
    Alert.alert(
      'Réactiver ce SpotYou ?',
      point?.media_purge_scheduled_at
        ? `"${point.title}" redeviendra visible publiquement.`
        : `"${point?.title}" redeviendra visible publiquement.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Réactiver', style: 'default',
          onPress: () => {
            setOwnerActionLoading(true);
            api.post(`/tag-points/${id}/reactivate`, {})
              .then(() => {
                triggerProfileRefresh();
                loadPoint(true);
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
    // Utiliser uniquement images[] — image_url sera supprimé
    const parsedImages: string[] = (() => {
      try { return Array.isArray(point.images) ? point.images : JSON.parse(point.images || '[]'); } catch { return []; }
    })();
    const allImages = parsedImages;
    router.replace({
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
        minParticipants: String(point.minimum_participants ?? ''),
        maxParticipants: String(point.maximum_participants ?? ''),
        address: point.original_address || point.address || '',
        visibilityType: point.visibility_type || 'public',
        joinMode: point.join_mode || 'open',
        invitePermissions: point.invite_permissions || 'admin_and_members',
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

  const loadParticipants = async () => {
    setParticipantsLoading(true);
    try {
      const data = await api.get(`/tag-points/${id}/participants`);
      setParticipants(data);
      setParticipantsCount(data.length);
    } catch {}
    finally { setParticipantsLoading(false); }
  };

  const loadGoingList = async () => {
    setGoingListLoading(true);
    try {
      const data = await api.get(`/spot-you/${id}/going`);
      const list = data.going || [];
      setGoingList(list);
      setGoingCount(list.length); // sync le compteur affiché avec la liste réelle
    } catch {}
    finally { setGoingListLoading(false); }
  };

  const loadPendingRequests = async () => {
    if (!user) return;
    setPendingLoading(true);
    try {
      const data = await api.get(`/tag-points/${id}/join-requests`);
      setPendingRequests(Array.isArray(data) ? data : []);
    } catch {
      // 403 = pas de permission, ignorer silencieusement
      setPendingRequests([]);
    } finally {
      setPendingLoading(false);
    }
  };

  const handleApproveRequest = async (memberId: string) => {
    try {
      await api.post(`/tag-points/${id}/members/${memberId}/approve`, {});
      setPendingRequests(prev => prev.filter(r => r.user_id !== memberId));
      setParticipantsCount(prev => prev + 1);
      loadParticipants();
    } catch (e: any) {
      if (e.statusCode === 409) {
        // Alert.alert est un no-op sur web — bannière inline
        setConflictBanner(e.message || 'Cette demande a déjà été acceptée par un autre membre.');
        setTimeout(() => setConflictBanner(null), 5000);
        loadPendingRequests();
        loadParticipants();
      } else {
        Alert.alert('Erreur', e.message || 'Impossible d\'accepter la demande');
      }
    }
  };

  const handleRejectRequest = async (memberId: string) => {
    try {
      await api.post(`/tag-points/${id}/members/${memberId}/reject`, {});
      setPendingRequests(prev => prev.filter(r => r.user_id !== memberId));
    } catch (e: any) {
      if (e.statusCode === 409) {
        // Alert.alert est un no-op sur web — bannière inline
        setConflictBanner(e.message || 'Cette demande a déjà été traitée par un autre membre.');
        setTimeout(() => setConflictBanner(null), 5000);
        loadPendingRequests();
        loadParticipants();
      } else {
        Alert.alert('Erreur', e.message || 'Impossible de refuser la demande');
      }
    }
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
      loadVotes(); loadPoint(true);
      setTimeout(() => { setVoteSuccess(false); setShowVoteModal(false); }, 1500);
    } catch (e: any) { Alert.alert('Erreur', e.message || "Impossible d'envoyer"); }
    finally { setSubmitting(false); }
  };

  const showConfirm = (action: ConfirmAction, cb: () => void) => {
    setConfirmAction(action);
    setPendingCallback(() => cb);
    setConfirmVisible(true);
  };

  const doRSVP = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour participer.'); return; }
    // Bloquer une deuxième demande si déjà en attente
    if (joinStatus === 'pending') {
      Alert.alert('Demande en attente', 'Votre demande est déjà en cours de validation. Utilisez le bouton "Annuler" pour la retirer.');
      return;
    }
    setRsvpLoading(true);
    try {
      if (isMember) {
        // Quitter
        const res = await api.delete(`/tag-points/${id}/leave`);
        setIsMember(false);
        setIsParticipant(false);
        setCanParticipate(false);
        setIsGoing(false);
      } else {
        // Rejoindre — utilise la route Phase 1 avec logique d'approbation
        const res = await api.post(`/tag-points/${id}/join`, {});

        if (res.status === 'pending') {
          // Demande en attente de validation
          setJoinStatus('pending');
          Alert.alert(
            'Demande envoyée',
            res.message || 'Votre demande est en attente de validation par les membres.'
          );
          return; // Pas de refresh complet nécessaire
        }

        if (res.status === 'accepted') {
          setIsMember(true);
          setIsParticipant(res.is_participant ?? true);
          setCanParticipate(res.is_participant ?? true);
          refreshAllRef.current();
          loadActivity();
          await cacheInvalidate([`/tag-points/${id}`, '/tag-points', '/planning', '/conversations']);
        }
        return;
      }
      refreshAllRef.current();
      await cacheInvalidate([`/tag-points/${id}`, '/tag-points', '/planning', '/conversations']);
    } catch (e: any) { onActionError(e); }
    finally { setRsvpLoading(false); }
  };

  // Annuler sa propre demande d'adhésion en attente
  const handleCancelRequest = async () => {
    if (!user) return;
    setRsvpLoading(true);
    try {
      await api.delete(`/tag-points/${id}/cancel-request`);
      setJoinStatus(null);
      setIsMember(false);
      setIsParticipant(false);
      // Rafraîchir le badge de l'admin (sa demande disparaît de la liste)
      loadPendingRequests();
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible d\'annuler la demande');
    } finally {
      setRsvpLoading(false);
    }
  };

  const confirmCancelRequest = () => {
    showConfirm({
      title: 'Annuler votre demande ?',
      description: `Vous êtes sur le point d'annuler votre demande pour rejoindre «${point?.title ?? 'ce SpotYou'}».`,
      icon: 'time-outline',
      iconColor: '#F59E0B',
      iconBg: '#FEF3C7',
      confirmLabel: 'Annuler la demande',
      confirmStyle: 'danger',
      cancelLabel: 'Garder',
      bullets: [
        'Votre demande sera définitivement retirée',
        'Vous pourrez soumettre une nouvelle demande à tout moment',
        'L\'administrateur ne recevra aucune notification',
      ],
    }, handleCancelRequest);
  };

  // Handler d'erreur centralisé pour les actions utilisateur.
  // Si le SpotYou a été désactivé entre-temps → alerte + refresh de la page.
  const onActionError = (e: any) => {
    const msg: string = e?.message || '';
    const isGone =
      (e?.status === 404 || e?.status === 410) &&
      (msg.toLowerCase().includes('disponible') ||
       msg.toLowerCase().includes('introuvable') ||
       msg.toLowerCase().includes('désactivé'));
    if (isGone) {
      Alert.alert(
        'SpotYou non disponible',
        'Ce SpotYou a été désactivé. La page va se mettre à jour.',
        [{ text: 'OK', onPress: () => loadPoint(true) }]
      );
    } else {
      Alert.alert('Erreur', msg || 'Une erreur est survenue');
    }
  };

  const toggleRSVP = () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour participer.'); return; }
    if (!isOnline) {
      Alert.alert('Hors ligne', 'Impossible de rejoindre ou quitter un SpotYou sans connexion. Vérifiez votre réseau et réessayez.');
      return;
    }
    playClickSound();
    if (isMember) {
      showConfirm({
        title: 'Quitter le SpotYou ?',
        description: 'Vous êtes sur le point de quitter cette communauté.',
        icon: 'person-remove-outline',
        iconColor: '#EF4444',
        iconBg: '#FEF2F2',
        confirmLabel: 'Quitter',
        confirmStyle: 'danger',
        cancelLabel: 'Rester',
        bullets: [
          'Votre accès au chat de groupe sera suspendu',
          'Vous ne recevrez plus de notifications de ce SpotYou',
          'Vous pouvez rejoindre à nouveau à tout moment',
        ],
      }, doRSVP);
    } else {
      showConfirm({
        title: 'Rejoindre ce SpotYou ?',
        description: `Devenez membre de la communauté «${point?.title ?? 'ce SpotYou'}».`,
        icon: 'people-outline',
        iconColor: Colors.primary,
        iconBg: Colors.primaryLight,
        confirmLabel: 'Rejoindre',
        confirmStyle: 'primary',
        bullets: [
          'Accès au chat de groupe',
          'Notifications pour chaque nouvelle séance',
          'Votre profil visible dans la liste des membres',
        ],
      }, doRSVP);
    }
  };

  const doGoing = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour vous inscrire.'); return; }
    setGoingLoading(true);
    try {
      const res = isGoing
        ? await api.delete(`/spot-you/${id}/going`)
        : await api.post(`/spot-you/${id}/going`, {});
      // Optimistic : feedback immédiat
      setIsGoing(res.is_going);
      if (res.is_full !== undefined) setIsFull(res.is_full);
      // Refresh complet — source de vérité unique
      refreshAllRef.current();
      loadActivity();
      await cacheInvalidate([`/tag-points/${id}`, '/planning', '/tag-points/mine']);
    } catch (e: any) { onActionError(e); }
    finally { setGoingLoading(false); }
  };

  const toggleGoing = () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour vous inscrire à la séance.'); return; }
    if (!isOnline) {
      Alert.alert('Hors ligne', 'Impossible de s\'inscrire ou se désinscrire d\'une séance sans connexion. Vérifiez votre réseau et réessayez.');
      return;
    }
    playClickSound();
    if (isGoing) {
      showConfirm({
        title: 'Annuler votre participation ?',
        description: 'Vous vous désinscrivez de la prochaine séance.',
        icon: 'close-circle-outline',
        iconColor: '#F59E0B',
        iconBg: '#FFFBEB',
        confirmLabel: 'Annuler ma participation',
        confirmStyle: 'danger',
        cancelLabel: 'Garder ma place',
        bullets: [
          'Vous restez membre de la communauté',
          'Le coach sera informé de votre désistement',
        ],
      }, doGoing);
    } else {
      showConfirm({
        title: 'Confirmer votre présence ?',
        description: 'Vous vous inscrivez à la prochaine séance.',
        icon: 'calendar-number-outline',
        iconColor: Colors.primary,
        iconBg: Colors.primaryLight,
        confirmLabel: 'Je participe',
        confirmStyle: 'primary',
        bullets: [
          'Le coach et les membres seront notifiés',
          'Vous recevrez un rappel avant la séance',
        ],
      }, doGoing);
    }
  };

  const openSimilar = async () => {
    setShowSimilar(true);
    if (similar.length > 0) return;
    setLoadingSimilar(true);
    try { 
      const data = await api.get(`/tag-points/${id}/similar`);
      setSimilar(Array.isArray(data) ? data : []);
    } catch {}
    setLoadingSimilar(false);
  };

  const toggleSave = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour sauvegarder.'); return; }
    setSaveLoading(true);
    try {
      const res = isSaved
        ? await api.delete(`/tag-points/${id}/unsave`)
        : await api.post(`/tag-points/${id}/save`, {});
      setIsSaved(res.is_saved);
    } catch (e: any) { onActionError(e); }
    finally { setSaveLoading(false); }
  };

  const toggleNewDateComing = async () => {
    if (!user) return;
    try {
      const res = await api.patch(`/tag-points/${id}/new-date`, {});
      setPoint((prev: any) => ({ ...prev, new_date_coming: res.new_date_coming }));
    } catch (e: any) { Alert.alert('Erreur', e.message); }
  };

  const [chatLoading, setChatLoading] = useState(false);
  // État du modal de confirmation
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null);
  const openPrivateChat = async () => {
    if (!user) { Alert.alert('', 'Connectez-vous pour envoyer un message'); return; }
    setChatLoading(true);
    try {
      const conv = await getOrCreateConversation('tagpoint_private', id as string);
      router.push(`/chat/${conv.conversation_id}` as any);
    } catch (e: any) { onActionError(e); }
    finally { setChatLoading(false); }
  };

  const openGroupChat = async () => {
    if (!user) { Alert.alert('', 'Connectez-vous pour accéder au groupe'); return; }
    setChatLoading(true);
    try {
      const conv = await getOrCreateConversation('tagpoint_group', id as string);
      router.push(`/chat/${conv.conversation_id}` as any);
    } catch (e: any) { onActionError(e); }
    finally { setChatLoading(false); }
  };

  if (loading) return (
    <View style={st.screen}><Stack.Screen options={{ headerShown: false }} /><SpotYouSkeleton /></View>
  );
  if (!point) return (
    <View style={st.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      {contentNotFound ? (
        <ContentDeletedState
          onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map' as any)}
          testID="spotyou-deleted-state"
        />
      ) : (
        <ErrorNoData
          onRetry={() => loadPoint(true)}
          onBack={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map' as any)}
          testID="spotyou-not-found"
        />
      )}
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
  // isAdmin = isOwner pour l'instant (évolutif : plusieurs admins à venir)
  const isAdmin = isOwner;
  const canManageRequests = isAdmin || (isMember && point?.join_mode === 'members_approval');
  // Participants autres que le créateur
  const hasOtherParticipants = participants.some(p => !p.is_creator);

  return (
    <View style={st.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Bannière données périmées — uniquement si le refresh réseau a échoué */}
      {screenState === 'ready_cached' && networkFailed && <StaleBanner staleMinutes={staleMinutes} />}

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
          <TouchableOpacity style={st.ownerBarBtn} onPress={() => setShowInviteModal(true)} testID="invite-btn" disabled={!point?.active}>
            <Ionicons name="person-add-outline" size={18} color={Colors.primary} />
            <Text style={st.ownerBarBtnText}>Inviter</Text>
          </TouchableOpacity>
          {point?.active === false ? (
            <>
              <View style={st.ownerBarDivider} />
              <TouchableOpacity style={st.ownerBarBtn} onPress={handleReactivate} testID="reactivate-btn" disabled={ownerActionLoading}>
                <Ionicons name="refresh-circle-outline" size={18} color={Colors.primary} />
                <Text style={[st.ownerBarBtnText, { color: Colors.primary }]}>Réactiver</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={st.ownerBarDivider} />
              <TouchableOpacity style={[st.ownerBarBtn, { gap: 4 }]} onPress={handleDelete} testID="delete-btn" disabled={ownerActionLoading}>
                <Ionicons name="pause-circle-outline" size={18} color="#F59E0B" />
                <Text style={[st.ownerBarBtnText, { color: '#F59E0B' }]}>Désactiver</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Bouton Inviter pour membres autorisés non-owner */}
      {!isOwner && isMember && point?.invite_permissions === 'admin_and_members' && point?.active !== false && (
        <TouchableOpacity
          style={st.memberInviteBar}
          onPress={() => setShowInviteModal(true)}
          testID="member-invite-btn"
          activeOpacity={0.75}
        >
          <Ionicons name="person-add-outline" size={16} color={Colors.primary} />
          <Text style={st.memberInviteBarText}>Inviter un ami dans ce SpotYou</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
        </TouchableOpacity>
      )}

      {/* Banner SpotYou désactivé — visible uniquement par l'owner */}
      {isOwner && point?.active === false && (
        <View style={st.deactivatedBanner} testID="deactivated-banner">
          <View style={st.deactivatedBannerLeft}>
            <Ionicons name="pause-circle" size={16} color="#F59E0B" />
            <Text style={st.deactivatedBannerTxt}>SpotYou désactivé — non visible du public</Text>
          </View>
          {point.media_purge_scheduled_at ? (() => {
            const days = Math.max(0, Math.ceil((new Date(point.media_purge_scheduled_at).getTime() - Date.now()) / 86400000));
            return days <= 30 ? (
              <Text style={st.deactivatedBannerDays}>Médias dans {days}j</Text>
            ) : null;
          })() : null}
        </View>
      )}

      {/* Banner SpotYou privé — visible pour les non-membres */}
      {point?.visibility_type === 'private' && !isMember && !isOwner && (
        <View style={st.privateBanner} testID="private-banner">
          <Ionicons name="lock-closed" size={14} color="#6366F1" />
          <Text style={st.privateBannerTxt}>SpotYou privé — accès sur invitation uniquement</Text>
        </View>
      )}

      <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >

        {/* 1. Image Carousel */}
        <View style={{ marginHorizontal: Spacing.md, marginTop: Spacing.md }}>
          <ImageCarousel images={images} domainId={point?.domain_id} />
          {/* Owner avatar overlay */}
          {point.owner && (
            <TouchableOpacity
              style={st.ownerBadge}
              onPress={() => router.push(`/user/${point.owner.user_id}` as any)}
              activeOpacity={0.7}
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
            {/* Distance */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="location-outline" size={15} color={Colors.primary} />
              <Text style={st.distText} testID="spotyou-distance">{distanceStr}</Text>
            </View>

            <View style={{ flex: 1 }} />

            {/* Chip membres pour le propriétaire — toujours visible */}
            {isOwner && (
              <View style={{ position: 'relative' }}>
                <TouchableOpacity
                  onPress={() => { setShowParticipants(true); loadPendingRequests(); }}
                  testID="owner-members-count"
                  style={st.membersChipInline}
                >
                  <Ionicons name="people-outline" size={12} color={Colors.muted} />
                  <Text style={st.membersChipInlineText}>
                    {Math.max(participantsCount, 1)} membre{Math.max(participantsCount, 1) > 1 ? 's' : ''}
                  </Text>
                  <Ionicons name="chevron-forward" size={10} color={Colors.muted} />
                </TouchableOpacity>
                {pendingRequests.length > 0 && (
                  <View style={st.pendingBadge} testID="pending-badge-owner">
                    <Text style={st.pendingBadgeText}>{pendingRequests.length}</Text>
                  </View>
                )}
              </View>
            )}

            {/* Rejoindre + membres — récurrents ET date unique (passés ou futurs) */}
            {!isOwner && (!!point.event_schedule || !!point.event_date) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                {(participantsCount > 0 || canManageRequests) && (
                  <View style={{ position: 'relative' }}>
                    <TouchableOpacity
                      onPress={() => { setShowParticipants(true); loadPendingRequests(); }}
                      testID="members-count-inline"
                      style={st.membersChipInline}
                    >
                      <Ionicons name="people-outline" size={12} color={Colors.muted} />
                      <Text style={st.membersChipInlineText}>
                        {Math.max(participantsCount, 1)}
                      </Text>
                    </TouchableOpacity>
                    {canManageRequests && pendingRequests.length > 0 && (
                      <View style={st.pendingBadge} testID="pending-badge-member">
                        <Text style={st.pendingBadgeText}>{pendingRequests.length}</Text>
                      </View>
                    )}
                  </View>
                )}
                {point?.visibility_type === 'private' && !isMember ? (
                  /* SpotYou privé — accès sur invitation uniquement */
                  <View
                    style={[st.joinBtnCompact, st.joinBtnInviteOnly]}
                    testID="invitation-only-btn"
                  >
                    <Ionicons name="lock-closed-outline" size={14} color="#6366F1" />
                    <Text style={[st.joinBtnCompactText, { color: '#6366F1' }]}>Accès sur invitation</Text>
                  </View>
                ) : (
                <TouchableOpacity
                  style={[
                    st.joinBtnCompact,
                    isMember && st.joinBtnCompactActive,
                    joinStatus === 'pending' && st.joinBtnCompactPending,
                  ]}
                  onPress={joinStatus === 'pending' ? confirmCancelRequest : toggleRSVP}
                  disabled={rsvpLoading}
                  testID={joinStatus === 'pending' ? 'cancel-request-button' : 'rsvp-button'}
                >
                  {rsvpLoading
                    ? <ActivityIndicator color={joinStatus === 'pending' ? '#F59E0B' : (isMember ? Colors.muted : Colors.background)} size="small" />
                    : joinStatus === 'pending'
                      ? <>
                          <Ionicons name="time-outline" size={14} color="#F59E0B" />
                          <Text style={[st.joinBtnCompactText, { color: '#F59E0B' }]}>Annuler</Text>
                        </>
                      : <>
                          <Ionicons
                            name={isMember ? 'exit-outline' : 'people-outline'}
                            size={14}
                            color={isMember ? Colors.muted : Colors.background}
                          />
                          <Text style={[st.joinBtnCompactText, isMember && st.joinBtnCompactLeaveText]}>
                            {isMember ? 'Quitter' : 'Rejoindre'}
                          </Text>
                        </>
                  }
                </TouchableOpacity>
                )}
              </View>
            )}
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
                <View>
                  <View style={st.dateRow}>
                    <View style={[st.dateIconBox, isPast && st.dateIconBoxPast]}>
                      <Ionicons name={isPast ? 'time-outline' : 'calendar'} size={20} color={isPast ? Colors.muted : Colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      {isPast ? (
                        <>
                          <View style={st.pastHeaderRow}>
                            <Text style={st.pastMainText}>Événement passé</Text>
                            <View style={st.pastBadge}>
                              <Text style={st.pastBadgeText}>Passé</Text>
                            </View>
                          </View>
                          <Text style={st.pastEndedDate}>
                            {formatEventDateFull(point.event_date)}
                            {formatTimeOnly(point.event_date) ? ` ${formatTimeOnly(point.event_date)}` : ''}
                            {formatTimeOnly(point.event_end_date) ? ` → ${formatTimeOnly(point.event_end_date)}` : ''}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={st.dateLabel}>Prochain événement</Text>
                          <Text style={st.dateValue}>
                            {formatEventDate(point.event_date)}
                            {point.event_end_date && (
                              ` → ${new Date(point.event_end_date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                            )}
                          </Text>
                          <Text style={st.dateSub}>{formatEventDateFull(point.event_date)}</Text>
                        </>
                      )}
                    </View>
                  </View>
                  {/* Barre d'action Je participe pour date unique */}
                  {!isPast ? (
                    canParticipate ? (
                      <View style={st.eventActionBar}>
                        <TouchableOpacity
                          style={st.eventParticipantChip}
                          onPress={() => setShowGoingList(true)}
                          testID="event-participant-count"
                        >
                          <Ionicons name="people-outline" size={14} color={Colors.primary} />
                          <Text style={st.eventParticipantChipText}>
                            {goingCount} {goingCount > 1 ? 'participants' : 'participant'}
                            {maxParticipants ? ` / ${maxParticipants}` : ''}
                          </Text>
                          <Ionicons name="chevron-forward" size={12} color={Colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            st.goingBtnInline,
                            isGoing && st.goingBtnInlineActive,
                            (isFull && !isGoing) && st.goingBtnInlineDisabled,
                          ]}
                          onPress={(isFull && !isGoing) ? undefined : toggleGoing}
                          disabled={goingLoading || (isFull && !isGoing)}
                          testID="going-button"
                        >
                          {goingLoading
                            ? <ActivityIndicator color={isGoing ? Colors.primary : Colors.background} size="small" />
                            : (isFull && !isGoing)
                              ? <>
                                  <Ionicons name="flash" size={12} color="#F59E0B" />
                                  <Text style={[st.goingBtnInlineText, { color: '#F59E0B' }]}>Complet</Text>
                                </>
                              : <>
                                  <Ionicons
                                    name={isGoing ? 'close-circle-outline' : 'add-circle-outline'}
                                    size={13}
                                    color={isGoing ? Colors.muted : Colors.background}
                                  />
                                  <Text style={[st.goingBtnInlineText, isGoing && st.goingBtnInlineCancelText]}>
                                    {isGoing ? 'Annuler' : 'Je participe'}
                                  </Text>
                                </>
                          }
                        </TouchableOpacity>
                      </View>
                    ) : null
                  ) : null}
                </View>
              )}
              {showRecurring && (() => {
                const rec = formatRecurring(point.event_schedule);
                const next = getNextOccurrence(point.event_schedule);
                const backendNext = point.next_session_date
                  ? new Date(`${point.next_session_date}T00:00:00`)
                  : null;
                const fallbackStart = rec.perDay?.[0]?.times?.[0];
                const nextLabel = next
                  ? `${formatDayLabel(next.date)} · ${next.startTime}${next.endTime ? ` → ${next.endTime}` : ''}`
                  : backendNext
                    ? `${formatDayLabel(backendNext)}${fallbackStart ? ` · ${fallbackStart}` : ''}`
                  : rec.summary;
                return (
                  <View>
                    <View style={st.dateRow}>
                      <View style={[st.dateIconBox, st.dateIconBoxRecurring]}>
                        <Ionicons name="repeat" size={20} color={Colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <Text style={st.dateLabel}>Prochain événement</Text>
                          <View style={st.recurringBadge}>
                            <Text style={st.recurringBadgeText}>Récurrent</Text>
                          </View>
                        </View>
                        <Text style={st.dateValue}>{nextLabel}</Text>
                      </View>
                    </View>
                    {/* Barre d'action : participants séance (cliquable) + Je participe */}
                    {canParticipate && (
                    <View style={st.eventActionBar}>
                      <TouchableOpacity
                        style={st.eventParticipantChip}
                        onPress={() => setShowGoingList(true)}
                        testID="event-participant-count"
                      >
                        <Ionicons name="people-outline" size={14} color={Colors.primary} />
                        <Text style={st.eventParticipantChipText}>
                          {goingCount} {goingCount > 1 ? 'participants' : 'participant'}
                          {maxParticipants ? ` / ${maxParticipants}` : ''}
                        </Text>
                        <Ionicons name="chevron-forward" size={12} color={Colors.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          st.goingBtnInline,
                          isGoing && st.goingBtnInlineActive,
                          (isFull && !isGoing) && st.goingBtnInlineDisabled,
                        ]}
                        onPress={(isFull && !isGoing) ? undefined : toggleGoing}
                        disabled={goingLoading || (isFull && !isGoing)}
                        testID="going-button"
                      >
                        {goingLoading
                          ? <ActivityIndicator color={isGoing ? Colors.primary : Colors.background} size="small" />
                          : (isFull && !isGoing)
                            ? <>
                                <Ionicons name="flash" size={12} color="#F59E0B" />
                                <Text style={[st.goingBtnInlineText, { color: '#F59E0B' }]}>Complet</Text>
                              </>
                            : <>
                                <Ionicons
                                  name={isGoing ? 'close-circle-outline' : 'add-circle-outline'}
                                  size={13}
                                  color={isGoing ? Colors.muted : Colors.background}
                                />
                                <Text style={[st.goingBtnInlineText, isGoing && st.goingBtnInlineCancelText]}>
                                  {isGoing ? 'Annuler' : 'Je participe'}
                                </Text>
                              </>
                        }
                      </TouchableOpacity>
                    </View>
                    )}
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
              {/* Banner: bientôt une nouvelle date — masqué pour les récurrents */}
              {point.new_date_coming && !showRecurring && (
                <View style={st.newDateBanner}>
                  <Ionicons name="time-outline" size={15} color={Colors.primary} />
                  <Text style={st.newDateBannerText}>Bientôt une nouvelle date</Text>
                </View>
              )}
              {/* Creator toggle — masqué pour les récurrents (toujours une prochaine date) */}
              {isPast && isCreator && !showRecurring && (
                <TouchableOpacity style={st.newDateToggle} onPress={toggleNewDateComing} testID="new-date-toggle">
                  <Ionicons
                    name={point.new_date_coming ? 'checkmark-circle' : 'add-circle-outline'}
                    size={16} color={Colors.primary}
                  />
                  <Text style={st.newDateToggleText}>
                    {point.new_date_coming ? 'Retirer' : 'Annoncer que prochainement il y aura une nouvelle date'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {/* 4. Boutons de communication */}
        {!isOwner && (
        <View style={st.chatRow}>
          <TouchableOpacity
            style={[st.chatCard, !isMember && { flex: 1 }]}
            onPress={openPrivateChat}
            disabled={chatLoading}
            activeOpacity={0.75}
            testID="message-button"
          >
            <View style={st.chatCardInner}>
              <View style={st.chatCardIconOuter}>
                <View style={st.chatCardIconWrap}>
                  {chatLoading
                    ? <ActivityIndicator size="small" color={Colors.background} />
                    : point.owner?.picture
                      ? <Image source={{ uri: point.owner.picture }} style={{ width: '100%', height: '100%' }} />
                      : <Text style={st.chatCardAvatarInitial}>{point.owner?.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                  }
                </View>
                {!chatLoading && (
                  <View style={st.chatCardBadge}>
                    <Ionicons name="chatbubble" size={7} color="#fff" />
                  </View>
                )}
              </View>
              <View style={st.chatCardTexts}>
                <Text style={st.chatCardTitle}>Propriétaire</Text>
                <Text style={st.chatCardSub} numberOfLines={1}>
                  {point.owner?.name ? `Message à ${point.owner.name.split(' ')[0]}` : 'Message privé'}
                </Text>
              </View>
              {!chatLoading && (
                <Ionicons name="paper-plane-outline" size={15} color={Colors.muted} style={st.chatCardSendIcon} />
              )}
            </View>
          </TouchableOpacity>

          {isMember && (
            <TouchableOpacity
              style={[st.chatCard, st.chatCardGroup]}
              onPress={openGroupChat}
              disabled={chatLoading}
              activeOpacity={0.75}
              testID="group-chat-button"
            >
              <View style={st.chatCardInner}>
                <View style={st.chatCardIconOuter}>
                  <View style={[st.chatCardIconWrap, st.chatCardIconWrapGroup]}>
                    {chatLoading
                      ? <ActivityIndicator size="small" color={Colors.primary} />
                      : images[0]
                        ? <Image source={{ uri: images[0] }} style={{ width: '100%', height: '100%' }} />
                        : <Ionicons name="people" size={16} color={Colors.primary} />
                    }
                  </View>
                  {!chatLoading && images[0] && (
                    <View style={[st.chatCardBadge, st.chatCardBadgeGroup]}>
                      <Ionicons name="people" size={7} color="#fff" />
                    </View>
                  )}
                </View>
                <View style={st.chatCardTexts}>
                  <Text style={[st.chatCardTitle, { color: Colors.primary }]}>Communauté</Text>
                  <Text style={[st.chatCardSub, { color: Colors.primary + '99' }]} numberOfLines={1}>
                    {participantsCount > 0
                      ? `${participantsCount} membre${participantsCount > 1 ? 's' : ''}`
                      : 'Discussion collective'}
                  </Text>
                </View>
                {!chatLoading && (
                  <Ionicons name="paper-plane-outline" size={15} color={Colors.primary} style={st.chatCardSendIcon} />
                )}
              </View>
            </TouchableOpacity>
          )}
        </View>
        )}

        {/* Bouton communauté — propriétaire uniquement */}
        {isOwner && (
          <View style={st.chatRow}>
            <TouchableOpacity
              style={[st.chatCard, st.chatCardGroup, { flex: 1 }]}
              onPress={openGroupChat}
              disabled={chatLoading}
              activeOpacity={0.75}
              testID="owner-group-chat-btn"
            >
              <View style={st.chatCardInner}>
                <View style={st.chatCardIconOuter}>
                  <View style={[st.chatCardIconWrap, st.chatCardIconWrapGroup]}>
                    {chatLoading
                      ? <ActivityIndicator size="small" color={Colors.primary} />
                      : images[0]
                        ? <Image source={{ uri: images[0] }} style={{ width: '100%', height: '100%' }} />
                        : <Ionicons name="people" size={16} color={Colors.primary} />
                    }
                  </View>
                  {!chatLoading && images[0] && (
                    <View style={[st.chatCardBadge, st.chatCardBadgeGroup]}>
                      <Ionicons name="people" size={7} color="#fff" />
                    </View>
                  )}
                </View>
                <View style={st.chatCardTexts}>
                  <Text style={[st.chatCardTitle, { color: Colors.primary }]}>Communauté</Text>
                  <Text style={[st.chatCardSub, { color: Colors.primary + '99' }]} numberOfLines={1}>
                    {participantsCount > 0
                      ? `Voir le groupe · ${participantsCount} membre${participantsCount > 1 ? 's' : ''}`
                      : 'Voir la discussion collective'}
                  </Text>
                </View>
                {!chatLoading && (
                  <Ionicons name="paper-plane-outline" size={15} color={Colors.primary} style={st.chatCardSendIcon} />
                )}
              </View>
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
            onPress={async () => { try { await Share.share({ message: `"${point.title}" sur SpotU !` }); } catch {} }}
            activeOpacity={0.7}
            testID="share-btn"
          >
            <View style={st.actionIcon}>
              <Ionicons name="share-social-outline" size={26} color={Colors.foreground} />
            </View>
            <Text style={st.actionLabel}>Partager</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={st.actionBtn}
            onPress={() => {
              const tagIdList = (point.tags || []).map((t: any) => t.tag_id).join(',');
              router.push({
                pathname: '/marketplace/[spotYouId]' as any,
                params: {
                  spotYouId: id,
                  tagIds: tagIdList,
                  userLat: location?.lat?.toString() ?? '',
                  userLng: location?.lng?.toString() ?? '',
                },
              });
            }}
            activeOpacity={0.7}
            testID="marketplace-btn"
          >
            {/* Halo pulsant en arrière-plan */}
            <View style={{ position: 'relative', alignItems: 'center', justifyContent: 'center' }}>
              <Animated.View style={{
                position: 'absolute',
                width: 52, height: 52, borderRadius: 26,
                backgroundColor: 'rgba(59,130,246,0.18)',
                transform: [{ scale: marketplacePulse }],
                opacity: marketplaceGlow,
              }} />
              <View style={[st.actionIcon, { backgroundColor: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.4)', borderWidth: 1.5 }]}>
                <Ionicons name="storefront" size={26} color="#3B82F6" />
              </View>
              {/* Badge point rouge */}
              <Animated.View style={{
                position: 'absolute', top: 0, right: 0,
                width: 10, height: 10, borderRadius: 5,
                backgroundColor: '#EF4444',
                borderWidth: 1.5, borderColor: Colors.background,
                transform: [{ scale: marketplacePulse }],
              }} />
            </View>
            <Text style={[st.actionLabel, { color: '#3B82F6', fontWeight: '700' }]}>Boutique</Text>
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
          <View style={{ marginHorizontal: Spacing.md, marginBottom: Spacing.md }}>
            <MapPreview
              lat={lat}
              lng={lng}
              precision={point.precision || 'exact'}
              title={point.title || ''}
              accentColor={Colors.primary}
              height={180}
            />

            {/* Address display */}
            {point.address && (
              <View style={st.addressRow} testID="spotyou-address">
                <Ionicons name="location" size={14} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={st.addressText}>
                    {isOwner && showExactAddress && point.original_address
                      ? point.original_address
                      : point.address}
                  </Text>
                  {point.precision && point.precision !== 'exact' && (
                    <Text style={st.addressPrecision}>
                      {point.precision === '100m' ? 'Zone approximative' : 'Quartier'}
                    </Text>
                  )}
                </View>
              </View>
            )}

            {/* Owner privacy toggle */}
            {isOwner && point.original_address && (
              <TouchableOpacity
                style={st.ownerPrivacyToggle}
                onPress={() => setShowExactAddress(prev => !prev)}
                activeOpacity={0.7}
                testID="owner-address-toggle"
              >
                <Ionicons
                  name={showExactAddress ? 'eye' : 'eye-off'}
                  size={14}
                  color={showExactAddress ? Colors.primary : Colors.muted}
                />
                <Text style={[st.ownerPrivacyText, showExactAddress && { color: Colors.primary }]}>
                  {showExactAddress ? 'Adresse exacte (vous seul)' : 'Vue visiteur (adresse masquée)'}
                </Text>
                <View style={[st.ownerPrivacySwitch, showExactAddress && st.ownerPrivacySwitchActive]}>
                  <View style={[st.ownerPrivacyKnob, showExactAddress && st.ownerPrivacyKnobActive]} />
                </View>
              </TouchableOpacity>
            )}
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
              <TouchableOpacity
                style={st.reviewsBig}
                onPress={!isOwner ? openVoteModal : undefined}
                disabled={isOwner}
                testID="reviews-header-rating-tap"
              >
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
              </TouchableOpacity>
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
              <Text style={ms.title}>SpotYou similaires</Text>
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
                            onPress={() => { setShowSimilar(false); router.replace(`/spot-you/${item.point_id}` as any); }}
                            testID={`similar-card-${item.point_id}`}>
                            <View style={ms.simImg}>
                              {item.images?.[0]
                                ? <TagImage uri={item.images[0]} domainId={item.domain_id} style={{ width: '100%', height: '100%', borderRadius: Radius.md }} iconSize={24} />
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

      {/* Modal Invite */}
      {point && (
        <InviteModal
          visible={showInviteModal}
          onClose={() => setShowInviteModal(false)}
          pointId={point.point_id}
          pointTitle={point.title}
          existingMemberIds={participants.map(p => p.user_id)}
        />
      )}

      {/* Modal Participants */}
      <Modal visible={showParticipants} animationType="slide" transparent onRequestClose={() => setShowParticipants(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowParticipants(false)} />
          <View style={[ms.sheet, { maxHeight: '80%' }]}>
            <View style={ms.header}>
              <View>
                <Text style={ms.title}>
                  {participants.length} membre{participants.length > 1 ? 's' : ''}
                </Text>
                {canManageRequests && pendingRequests.length > 0 && (
                  <Text style={{ fontSize: 12, color: '#EF4444', fontWeight: '600', marginTop: 2 }}>
                    {pendingRequests.length} demande{pendingRequests.length > 1 ? 's' : ''} en attente
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowParticipants(false)} testID="close-participants-modal">
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>

            {/* Bannière conflit 409 — disparaît après 5s */}
            {conflictBanner && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: '#FEF3C7', borderRadius: 8,
                paddingHorizontal: 14, paddingVertical: 10,
                marginHorizontal: 16, marginBottom: 8,
              }} testID="conflict-banner">
                <Ionicons name="alert-circle-outline" size={16} color="#F59E0B" />
                <Text style={{ flex: 1, fontSize: 13, color: '#92400E', lineHeight: 18 }}>
                  {conflictBanner}
                </Text>
              </View>
            )}
            <ScrollView showsVerticalScrollIndicator={false}>

              {/* Section demandes en attente */}
              {canManageRequests && pendingRequests.length > 0 && (
                <View>
                  <View style={ps.sectionHeader}>
                    <Ionicons name="time-outline" size={14} color="#EF4444" />
                    <Text style={ps.sectionHeaderText}>Demandes en attente</Text>
                    <View style={ps.pendingCountBadge}>
                      <Text style={ps.pendingCountBadgeText}>{pendingRequests.length}</Text>
                    </View>
                  </View>
                  {pendingLoading ? (
                    <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 12 }} />
                  ) : (
                    pendingRequests.map(req => (
                      <View key={req.user_id} style={ps.requestRow} testID={`pending-request-${req.user_id}`}>
                        <View style={ps.avatar}>
                          {req.picture
                            ? <Image source={{ uri: req.picture }} style={{ width: '100%', height: '100%' }} />
                            : <Text style={ps.avatarLetter}>{req.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                          }
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={ps.name} numberOfLines={1}>{req.name}</Text>
                          {req.requested_at && (
                            <Text style={ps.requestedAt}>
                              {new Date(req.requested_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                            </Text>
                          )}
                        </View>
                        <View style={ps.requestActions}>
                          <TouchableOpacity
                            style={ps.approveBtn}
                            onPress={() => handleApproveRequest(req.user_id)}
                            testID={`approve-request-${req.user_id}`}
                          >
                            <Ionicons name="checkmark" size={12} color="#fff" />
                            <Text style={ps.approveBtnText}>Accepter</Text>
                          </TouchableOpacity>
                          {isAdmin && (
                            <TouchableOpacity
                              style={ps.rejectBtn}
                              onPress={() => handleRejectRequest(req.user_id)}
                              testID={`reject-request-${req.user_id}`}
                            >
                              <Ionicons name="close" size={12} color="#EF4444" />
                              <Text style={ps.rejectBtnText}>Refuser</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                  <View style={ps.sectionDivider} />
                  {participants.length > 0 && (
                    <Text style={ps.membresTitle}>Membres acceptés</Text>
                  )}
                </View>
              )}

              {participantsLoading
                ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
                : participants.map((p) => {
                    const isMe = !!(user && user.user_id === p.user_id);
                    return (
                      <TouchableOpacity
                        key={p.user_id}
                        style={ps.row}
                        activeOpacity={0.75}
                        onPress={() => { setShowParticipants(false); router.push(`/user/${p.user_id}` as any); }}
                        testID={`participant-modal-${p.user_id}`}
                      >
                        <View style={ps.avatar}>
                          {p.picture
                            ? <Image source={{ uri: p.picture }} style={{ width: '100%', height: '100%' }} />
                            : <Text style={ps.avatarLetter}>{p.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                          }
                        </View>
                        <Text style={ps.name} numberOfLines={1}>{p.name}</Text>
                        <View style={ps.badges}>
                          {isMe && (
                            <View style={ps.badgeYou}>
                              <Text style={ps.badgeYouTxt}>Vous</Text>
                            </View>
                          )}
                          {p.is_creator && (
                            <View style={ps.badgeOrganizer}>
                              <Ionicons name="shield-checkmark" size={10} color="#F59E0B" />
                              <Text style={ps.badgeOrganizerTxt}>Organisateur</Text>
                            </View>
                          )}
                          {p.role === 'coach' && (
                            <View style={ps.badgeCoach}>
                              <Text style={ps.badgeCoachTxt}>Coach</Text>
                            </View>
                          )}
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
                      </TouchableOpacity>
                    );
                  })
              }
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal — Liste inscrits prochaine séance */}
      <Modal visible={showGoingList} animationType="slide" transparent onRequestClose={() => setShowGoingList(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowGoingList(false)} />
          <View style={[ms.sheet, { maxHeight: '75%' }]}>
            <View style={ms.header}>
              <View>
                <Text style={ms.title}>
                  {goingList.length} participant{goingList.length > 1 ? 's' : ''}
                </Text>
                <Text style={{ fontSize: 11, color: Colors.muted, marginTop: 1 }}>Inscrits à la prochaine séance</Text>
              </View>
              <TouchableOpacity onPress={() => setShowGoingList(false)} testID="close-going-modal">
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {goingListLoading
                ? <ActivityIndicator size="small" color={Colors.primary} style={{ marginVertical: 24 }} />
                : goingList.length === 0
                  ? <Text style={{ textAlign: 'center', color: Colors.muted, paddingVertical: 32, fontSize: 14 }}>
                      Aucun inscrit pour l'instant
                    </Text>
                  : goingList.map((p) => {
                      const isMe = !!(user && user.user_id === p.user_id);
                      return (
                        <TouchableOpacity
                          key={p.user_id}
                          style={ps.row}
                          activeOpacity={0.75}
                          onPress={() => { setShowGoingList(false); router.push(`/user/${p.user_id}` as any); }}
                          testID={`going-modal-${p.user_id}`}
                        >
                          <View style={ps.avatar}>
                            {p.picture
                              ? <Image source={{ uri: p.picture }} style={{ width: '100%', height: '100%' }} />
                              : <Text style={ps.avatarLetter}>{p.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                            }
                          </View>
                          <Text style={ps.name} numberOfLines={1}>{p.name}</Text>
                          <View style={ps.badges}>
                            {isMe && (
                              <View style={ps.badgeYou}>
                                <Text style={ps.badgeYouTxt}>Vous</Text>
                              </View>
                            )}
                            {p.role === 'coach' && (
                              <View style={ps.badgeCoach}>
                                <Text style={ps.badgeCoachTxt}>Coach</Text>
                              </View>
                            )}
                          </View>
                          <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
                        </TouchableOpacity>
                      );
                    })
              }
              <View style={{ height: 24 }} />
            </ScrollView>
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

      {/* Modal de confirmation (rejoindre/quitter/participer) */}
      <ConfirmActionModal
        visible={confirmVisible}
        action={confirmAction}
        onConfirm={() => {
          setConfirmVisible(false);
          if (pendingCallback) pendingCallback();
        }}
        onCancel={() => setConfirmVisible(false)}
      />

    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.header },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerBtn: { padding: 4 },
  deactivatedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: 8, backgroundColor: '#2D1F00',
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: '#F59E0B50',
    borderLeftWidth: 3, borderLeftColor: '#F59E0B',
  },
  deactivatedBannerLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  deactivatedBannerTxt: { flex: 1, fontSize: 12, fontWeight: '600', color: '#F59E0B' },
  deactivatedBannerDays: { fontSize: 11, color: '#F59E0B', fontWeight: '700' },
  ownerBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.header, borderBottomWidth: 1, borderBottomColor: Colors.border },
  ownerBarBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  ownerBarBtnText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  ownerBarDivider: { width: 1, height: 20, backgroundColor: Colors.border },
  memberInviteBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 10, backgroundColor: Colors.card, borderBottomWidth: 1, borderBottomColor: Colors.border },
  memberInviteBarText: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.primary },
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
  dateIconBoxRecurring: { backgroundColor: Colors.primary + '33', borderColor: Colors.primary + '88' },
  recurringBadge: { backgroundColor: Colors.primary + '22', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: Colors.primary + '55' },
  recurringBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.8 },
  dateLabel: { fontSize: 11, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  dateValue: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  dateSub: { fontSize: 12, color: Colors.muted, marginTop: 2, textTransform: 'capitalize' },
  pastHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  pastMainText: { fontSize: 15, fontWeight: '800', color: Colors.foreground },
  pastEndedText: { fontSize: 12, color: Colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 },
  pastEndedDate: { fontSize: 13, color: Colors.foreground, fontWeight: '600', marginTop: 2, textTransform: 'capitalize', lineHeight: 18 },
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

  // Fil d'activité
  activitySection: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  activityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.primary },
  activityTitle: { fontSize: 13, fontWeight: '800', color: Colors.foreground, flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  activityItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border + '60' },
  activityAvatarWrap: { position: 'relative', width: 36, height: 36 },
  activityAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.border },
  activityAvatarFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '20' },
  activityAvatarInitial: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  activityTypeIcon: { position: 'absolute', bottom: -2, right: -2, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.card },
  activityTypeIconGoing: { backgroundColor: Colors.primary },
  activityTypeIconJoined: { backgroundColor: '#10B981' },
  activityContent: { flex: 1, gap: 2 },
  activityText: { fontSize: 13, color: Colors.foreground, lineHeight: 18 },
  activityName: { fontWeight: '700' },
  activityTime: { fontSize: 11, color: Colors.muted },

  rsvpSection: { paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  rsvpRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: 8 },
  rsvpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full },
  rsvpBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  rsvpText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  rsvpTextActive: { color: Colors.primary },
  rsvpCount: { fontSize: 13, color: Colors.muted },
  goingBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.foreground, paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full },
  goingBtnActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.primary },
  goingBtnDisabled: { backgroundColor: '#F59E0B22', borderWidth: 1.5, borderColor: '#F59E0B' },
  goingText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  goingTextActive: { color: Colors.primary },
  // Bouton "Je participe" inline dans la date card
  goingBtnInline: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 11, paddingVertical: 6, borderRadius: Radius.full, flexShrink: 0, marginLeft: 8 },
  goingBtnInlineActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.border },
  goingBtnInlineDisabled: { backgroundColor: '#F59E0B22', borderWidth: 1.5, borderColor: '#F59E0B' },
  goingBtnInlineText: { fontSize: 12, fontWeight: '700', color: Colors.background },
  goingBtnInlineCancelText: { color: Colors.muted },
  goingCountInline: { fontSize: 11, color: Colors.primary, fontWeight: '600', marginTop: 3 },
  // Bouton Rejoindre compact (dans la ligne rating)
  joinBtnCompact: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary, paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full },
  joinBtnCompactPending: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#F59E0B' },
  joinBtnCompactActive: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: Colors.border },
  joinBtnCompactText: { fontSize: 12, fontWeight: '700', color: Colors.background },
  joinBtnCompactLeaveText: { color: Colors.muted },
  // Bouton invitation uniquement (SpotYou privé, non-membre)
  joinBtnInviteOnly: { backgroundColor: '#6366F110', borderWidth: 1.5, borderColor: '#6366F140' },
  // Banner SpotYou privé
  privateBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 9, backgroundColor: '#6366F118', borderBottomWidth: 1, borderBottomColor: '#6366F130' },
  privateBannerTxt: { fontSize: 13, color: '#6366F1', fontWeight: '600', flex: 1 },
  // Chip membres inline
  membersChipInline: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.card, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border },
  membersChipInlineText: { fontSize: 11, color: Colors.muted, fontWeight: '600' },
  // Badge rouge — demandes en attente
  pendingBadge: {
    position: 'absolute', top: -5, right: -5,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5, borderColor: Colors.background,
  },
  pendingBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },
  // Boutons de communication (propriétaire + communauté)
  chatRow: { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  chatCard: { flex: 1, backgroundColor: Colors.card, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border, paddingVertical: 8, paddingHorizontal: 10 },
  chatCardGroup: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary + '40' },
  chatCardInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatCardIconOuter: { width: 30, height: 30, position: 'relative' },
  chatCardIconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: Colors.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  chatCardIconWrapGroup: { backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary + '55', overflow: 'hidden' },
  chatCardBadge: { position: 'absolute', bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.primaryDark, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.card },
  chatCardBadgeGroup: { backgroundColor: Colors.primary },
  chatCardAvatarInitial: { fontSize: 12, fontWeight: '700', color: Colors.background },
  chatCardTexts: { flex: 1, minWidth: 0 },
  chatCardTitle: { fontSize: 12, fontWeight: '700', color: Colors.foreground },
  chatCardSub: { fontSize: 10, color: Colors.muted, marginTop: 1 },
  chatCardSendIcon: { flexShrink: 0, marginLeft: 2, opacity: 0.75 },
  eventActionBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 76, paddingRight: Spacing.md, paddingBottom: 4, paddingTop: 0, marginTop: -10 },
  eventParticipantChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.primary + '15', borderRadius: Radius.full, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: Colors.primary + '40' },
  eventParticipantChipText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  countersRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  counterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.card, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  counterChipText: { fontSize: 12, color: Colors.muted, fontWeight: '500' },
  msgBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },

  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.header, marginHorizontal: Spacing.md, paddingVertical: 10, borderRadius: Radius.full, gap: Spacing.sm, marginBottom: Spacing.sm },
  messageBtnText: { fontSize: 14, fontWeight: '600', color: Colors.foreground },

  ownerRsvpRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  ownerRsvpToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border },
  ownerRsvpToggleActive: { borderColor: Colors.primary + '55', backgroundColor: Colors.primary + '11' },
  ownerRsvpToggleTxt: { fontSize: 12, fontWeight: '600', color: Colors.muted },

  actionsRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.lg, borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: Spacing.md, justifyContent: 'space-around' },
  actionBtn: { flex: 1, alignItems: 'center', gap: 8 },
  actionIcon: { width: 54, height: 54, borderRadius: Radius.lg, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  actionIconSaved: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  actionLabel: { fontSize: 12, color: Colors.muted, fontWeight: '500' },

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

  // Address display
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 10, paddingHorizontal: 2 },
  addressText: { fontSize: 14, fontWeight: '600', color: Colors.foreground, lineHeight: 20 },
  addressPrecision: { fontSize: 12, color: Colors.muted, marginTop: 2 },

  // Owner privacy toggle
  ownerPrivacyToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 10, marginTop: 8, borderWidth: 1, borderColor: Colors.border },
  ownerPrivacyText: { fontSize: 12, fontWeight: '600', color: Colors.muted, flex: 1 },
  ownerPrivacySwitch: { width: 36, height: 20, borderRadius: 10, backgroundColor: Colors.border, justifyContent: 'center', paddingHorizontal: 2 },
  ownerPrivacySwitchActive: { backgroundColor: Colors.primary },
  ownerPrivacyKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.foreground },
  ownerPrivacyKnobActive: { alignSelf: 'flex-end', backgroundColor: Colors.background },
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

const ps = StyleSheet.create({
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
  title: { fontSize: 15, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.sm },
  countBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: Spacing.md, paddingVertical: 8, marginBottom: Spacing.sm },
  countBtnTxt: { fontSize: 13, fontWeight: '600', color: Colors.primary, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  avatarLetter: { fontSize: 15, fontWeight: '700', color: Colors.background },
  name: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground },
  badges: { flexDirection: 'row', gap: 4, alignItems: 'center', flexShrink: 0 },
  badgeYou: { backgroundColor: Colors.primary + '22', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: Colors.primary + '55' },
  badgeYouTxt: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  badgeOrganizer: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  badgeOrganizerTxt: { fontSize: 10, fontWeight: '700', color: '#F59E0B' },
  badgeCoach: { backgroundColor: Colors.primary + '22', borderRadius: Radius.full, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: Colors.primary + '44' },
  badgeCoachTxt: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  // Demandes en attente
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10 },
  sectionHeaderText: { fontSize: 12, fontWeight: '800', color: '#EF4444', flex: 1, textTransform: 'uppercase', letterSpacing: 0.4 },
  pendingCountBadge: { backgroundColor: '#EF4444', borderRadius: 8, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  pendingCountBadgeText: { fontSize: 10, fontWeight: '800', color: '#fff' },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border + '60' },
  requestedAt: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  requestActions: { flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 },
  approveBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#10B981', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5 },
  approveBtnText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  rejectBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: '#EF4444' },
  rejectBtnText: { fontSize: 11, fontWeight: '700', color: '#EF4444' },
  sectionDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 12 },
  membresTitle: { fontSize: 11, fontWeight: '800', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
});
