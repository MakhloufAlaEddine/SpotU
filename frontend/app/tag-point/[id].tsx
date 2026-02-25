import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Alert, Image, Share, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLocation } from '../../context/LocationContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { haversineDistance, formatDistance } from '../../utils/distance';

// ─── Interactive Stars ────────────────────────────────────────────────────────
function InteractiveStars({ value, onChange, size = 30 }: { value: number; onChange: (v: number) => void; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <TouchableOpacity
          key={i}
          onPress={() => onChange(i)}
          activeOpacity={0.6}
          hitSlop={{ top: 12, bottom: 12, left: 6, right: 6 }}
          testID={`star-${i}`}
        >
          <Ionicons
            name={i <= value ? 'star' : 'star-outline'}
            size={size}
            color={i <= value ? Colors.star : Colors.muted}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Display Stars (read-only) ────────────────────────────────────────────────
function StarDisplay({ rating = 0, votes = 0 }: { rating?: number; votes?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons key={i} name={i <= Math.round(rating) ? 'star' : 'star-outline'} size={14}
          color={i <= Math.round(rating) ? Colors.star : Colors.muted} />
      ))}
      {votes > 0 && (
        <Text style={{ fontSize: 12, color: Colors.muted, marginLeft: 4 }}>
          {rating.toFixed(1)} ({votes})
        </Text>
      )}
    </View>
  );
}

// ─── Vote Modal ───────────────────────────────────────────────────────────────
function VoteModal({ visible, pointId, onClose, onSuccess }:
  { visible: boolean; pointId: string; onClose: () => void; onSuccess: (rating: number, votes: number) => void }) {
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (stars === 0) { Alert.alert('Note requise', 'Veuillez sélectionner une note.'); return; }
    setSubmitting(true);
    try {
      const res = await api.post(`/tag-points/${pointId}/vote`, { rating: stars, comment: comment.trim() || null });
      onSuccess(res.avg_rating, res.vote_count);
      setStars(0);
      setComment('');
      onClose();
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible d\'envoyer le vote');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={modalSt.overlay}>
        <View style={modalSt.sheet}>
          <View style={modalSt.header}>
            <Text style={modalSt.title}>Votre avis</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={Colors.foreground} />
            </TouchableOpacity>
          </View>

          <View style={modalSt.starsRow}>
            <InteractiveStars value={stars} onChange={setStars} />
          </View>
          {stars > 0 && (
            <Text style={modalSt.starsLabel}>
              {['', 'Mauvais', 'Moyen', 'Bien', 'Très bien', 'Excellent'][stars]}
            </Text>
          )}

          <TextInput
            style={modalSt.commentInput}
            placeholder="Ajouter un commentaire (optionnel)…"
            placeholderTextColor={Colors.muted}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={3}
            testID="vote-comment-input"
          />

          <TouchableOpacity
            style={[modalSt.submitBtn, stars === 0 && modalSt.submitDisabled]}
            onPress={handleSubmit}
            disabled={submitting || stars === 0}
            testID="vote-submit-btn"
          >
            {submitting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={modalSt.submitText}>Envoyer</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const modalSt = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: Spacing.lg, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  title: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  starsRow: { alignItems: 'center', marginBottom: Spacing.sm },
  starsLabel: { textAlign: 'center', fontSize: 14, color: Colors.primary, fontWeight: '600', marginBottom: Spacing.md },
  commentInput: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, color: Colors.foreground, fontSize: 14, minHeight: 80, textAlignVertical: 'top', marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  submitBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: Spacing.md, alignItems: 'center' },
  submitDisabled: { opacity: 0.4 },
  submitText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});

// ─── Action Button ────────────────────────────────────────────────────────────
function ActionButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={{ alignItems: 'center', gap: 4, flex: 1 }} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={24} color={Colors.foreground} />
      <Text style={{ fontSize: 13, color: Colors.foreground }}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function TagPointDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { location } = useLocation();
  const { lang } = useLang();

  const [point, setPoint] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [votes, setVotes] = useState<any[]>([]);
  const [currentRating, setCurrentRating] = useState(0);
  const [currentVotes, setCurrentVotes] = useState(0);

  // Vote inline state
  const [pendingStar, setPendingStar] = useState(0);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [voteSuccess, setVoteSuccess] = useState(false);

  useEffect(() => {
    if (id) { loadPoint(); loadVotes(); }
  }, [id]);

  const loadPoint = async () => {
    try {
      const data = await api.get(`/tag-points/${id}`);
      setPoint(data);
      setCurrentRating(data.rating || 0);
      setCurrentVotes(data.votes || 0);
    } catch (err: any) {
      Alert.alert('Erreur', err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadVotes = async () => {
    try {
      const data = await api.get(`/tag-points/${id}/votes`);
      setVotes(data);
    } catch {}
  };

  const handleVoteSubmit = async () => {
    if (!user) { Alert.alert('Connexion requise', 'Connectez-vous pour voter.'); return; }
    if (pendingStar === 0) return;
    setSubmitting(true);
    try {
      const res = await api.post(`/tag-points/${id}/vote`, { rating: pendingStar, comment: comment.trim() || null });
      setCurrentRating(res.avg_rating);
      setCurrentVotes(res.vote_count);
      setVoteSuccess(true);
      setComment('');
      setTimeout(() => setVoteSuccess(false), 3000);
      loadVotes();
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible d\'envoyer le vote');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 86400000);
    if (diff < 1) return "Aujourd'hui";
    if (diff === 1) return 'Hier';
    if (diff < 7) return `Il y a ${diff} jours`;
    if (diff < 30) return `Il y a ${Math.floor(diff / 7)} semaines`;
    return `Il y a ${Math.floor(diff / 30)} mois`;
  };

  const getPrecisionRadius = (p: string) => p === '100m' ? 100 : p === '1000m' ? 1000 : 0;

  if (loading) return (
    <View style={st.fullScreen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={st.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
    </View>
  );

  if (!point) return (
    <View style={st.fullScreen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={st.center}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.muted} />
        <Text style={{ fontSize: 16, color: Colors.muted }}>TagPoint introuvable</Text>
      </View>
    </View>
  );

  const lat = point.latitude || point.location?.coordinates?.[1];
  const lng = point.longitude || point.location?.coordinates?.[0];
  const tags: any[] = point.tags || [];
  const precisionRadius = getPrecisionRadius(point.precision);

  // Distance from user to tagpoint
  const distanceStr = (lat != null && lng != null)
    ? formatDistance(haversineDistance(location.lat, location.lng, lat, lng))
    : '---';

  return (
    <View style={st.fullScreen}>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={st.header}>
          <TouchableOpacity onPress={() => router.back()} style={st.headerBtn}>
            <Ionicons name="chevron-back" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={st.headerTitle}>Détails</Text>
          <View style={{ flexDirection: 'row', gap: Spacing.md }}>
            <TouchableOpacity style={st.headerBtn} onPress={() => router.push('/set-location' as any)}>
              <Ionicons name="location" size={24} color={Colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity style={st.headerBtn} onPress={() => router.push('/(tabs)/search' as any)}>
              <Ionicons name="search" size={24} color={Colors.primary} />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      <ScrollView style={st.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Image + Owner Avatar */}
        <View style={{ position: 'relative', marginHorizontal: Spacing.md, marginTop: Spacing.md, marginBottom: Spacing.md }}>
          <View style={st.imgBox}>
            {point.image_url
              ? <Image source={{ uri: point.image_url }} style={{ width: '100%', height: '100%' }} />
              : <View style={st.imgPlaceholder}><Ionicons name="football-outline" size={64} color={Colors.muted} /></View>}
          </View>
          {point.owner && (
            <View style={st.ownerAvatar}>
              {point.owner.picture
                ? <Image source={{ uri: point.owner.picture }} style={{ width: '100%', height: '100%' }} />
                : <View style={st.avatarFallback}>
                    <Text style={{ fontSize: 20, fontWeight: '700', color: Colors.background }}>
                      {point.owner.name?.charAt(0)?.toUpperCase() || '?'}
                    </Text>
                  </View>}
            </View>
          )}
        </View>

        {/* Title */}
        <Text style={st.title}>{point.title}</Text>

        {/* Distance + Tag */}
        <View style={st.infoRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="location-outline" size={16} color={Colors.primary} />
            <Text style={st.distanceText} testID="tagpoint-distance">{distanceStr}</Text>
          </View>
          {tags.length > 0 && (
            <Text style={st.tagText}>{lang === 'fr' ? tags[0].label_fr : tags[0].label_en}</Text>
          )}
        </View>

        {/* Rating actuel */}
        <View style={st.createdRow}>
          <Text style={st.createdText}>{formatTimeAgo(point.created_at)}</Text>
          <StarDisplay rating={currentRating} votes={currentVotes} />
        </View>

        {/* Zone de vote inline */}
        <View style={st.voteWidget} testID="vote-widget">
          <Text style={st.voteWidgetTitle}>
            {voteSuccess ? '✓ Vote enregistré !' : 'Donner votre avis'}
          </Text>
          <InteractiveStars value={pendingStar} onChange={setPendingStar} size={32} />
          {pendingStar > 0 && (
            <>
              <Text style={st.starLabel}>
                {['', 'Mauvais', 'Moyen', 'Bien', 'Très bien', 'Excellent'][pendingStar]}
              </Text>
              <TextInput
                style={st.commentInput}
                placeholder="Commentaire (optionnel)…"
                placeholderTextColor={Colors.muted}
                value={comment}
                onChangeText={setComment}
                multiline
                numberOfLines={2}
                testID="vote-comment-input"
              />
              <TouchableOpacity
                style={[st.submitBtn, submitting && { opacity: 0.6 }]}
                onPress={handleVoteSubmit}
                disabled={submitting}
                testID="vote-submit-btn"
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={st.submitBtnText}>Envoyer</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Send Message */}
        <TouchableOpacity
          style={st.messageBtn}
          onPress={() => Alert.alert('Message', 'Fonctionnalité de chat bientôt disponible !')}
          activeOpacity={0.8}
        >
          <Text style={st.messageBtnText}>Envoyer un message</Text>
          <Ionicons name="send" size={20} color={Colors.background} />
        </TouchableOpacity>

        {/* Actions */}
        <View style={st.actionsRow}>
          <ActionButton icon="copy-outline" label="Similaires" onPress={() => {}} />
          <ActionButton icon="share-social-outline" label="Partager" onPress={async () => {
            try { await Share.share({ message: `Découvrez "${point.title}" sur WINEK!` }); } catch {}
          }} />
          <ActionButton icon="bookmark-outline" label="Sauvegarder" onPress={() => {}} />
        </View>

        {/* Map */}
        {lat && lng && (
          <View style={st.mapWrap}>
            <MapViewComponent
              centerLat={lat} centerLng={lng}
              zoom={precisionRadius > 500 ? 14 : 16}
              precisionRadius={precisionRadius}
              selectedLat={lat} selectedLng={lng}
            />
          </View>
        )}

        {/* Description */}
        {point.description && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>Description</Text>
            <Text style={st.descText} numberOfLines={showFullDesc ? undefined : 2}>
              {point.description}
            </Text>
            {point.description.length > 100 && (
              <TouchableOpacity onPress={() => setShowFullDesc(!showFullDesc)}>
                <Text style={st.showMore}>{showFullDesc ? 'Réduire' : 'Voir plus'}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Votes & Comments */}
        {votes.length > 0 && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>Avis ({votes.length})</Text>
            {votes.map((v) => (
              <View key={v.vote_id} style={st.voteRow} testID={`vote-item-${v.vote_id}`}>
                <View style={st.voteAvatar}>
                  {v.user_picture
                    ? <Image source={{ uri: v.user_picture }} style={{ width: '100%', height: '100%' }} />
                    : <Text style={st.voteAvatarText}>{v.user_name?.charAt(0)?.toUpperCase() || '?'}</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={st.voteName}>{v.user_name}</Text>
                    <View style={{ flexDirection: 'row', gap: 2 }}>
                      {[1,2,3,4,5].map(i => (
                        <Ionicons key={i} name={i <= v.rating ? 'star' : 'star-outline'} size={12}
                          color={i <= v.rating ? Colors.star : Colors.muted} />
                      ))}
                    </View>
                  </View>
                  {v.comment && <Text style={st.voteComment}>{v.comment}</Text>}
                  <Text style={st.voteDate}>{formatTimeAgo(v.created_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fullScreen: { flex: 1, backgroundColor: Colors.header },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  headerBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: Colors.primary },
  scroll: { flex: 1, backgroundColor: Colors.background },

  imgBox: { height: 220, borderRadius: Radius.lg, overflow: 'hidden' },
  imgPlaceholder: { width: '100%', height: '100%', backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  ownerAvatar: { position: 'absolute', top: 10, right: 10, width: 50, height: 50, borderRadius: 25, borderWidth: 2, borderColor: Colors.foreground, overflow: 'hidden' },
  avatarFallback: { width: '100%', height: '100%', backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },

  title: { fontSize: 22, fontWeight: '700', color: Colors.foreground, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  distanceText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  tagText: { fontSize: 15, fontWeight: '600', color: Colors.primary },

  createdRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, marginBottom: Spacing.md },
  createdText: { fontSize: 13, color: Colors.muted },

  rateBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: Spacing.md, marginBottom: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.primary, alignSelf: 'flex-start' },
  rateBtnText: { fontSize: 14, fontWeight: '600', color: Colors.primary },

  messageBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.header, marginHorizontal: Spacing.md, paddingVertical: Spacing.md, borderRadius: Radius.full, gap: Spacing.sm, marginBottom: Spacing.md },
  messageBtnText: { fontSize: 16, fontWeight: '600', color: Colors.foreground },

  actionsRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: Spacing.md },

  mapWrap: { height: 180, marginHorizontal: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', marginBottom: Spacing.md },

  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.lg },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: Spacing.sm },
  descText: { fontSize: 15, color: Colors.muted, lineHeight: 22 },
  showMore: { fontSize: 15, fontWeight: '600', color: Colors.primary, textAlign: 'center', marginTop: Spacing.sm },

  voteRow: { flexDirection: 'row', gap: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  voteAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  voteAvatarText: { fontSize: 16, fontWeight: '700', color: Colors.background },
  voteName: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  voteComment: { fontSize: 13, color: Colors.muted, marginTop: 2, lineHeight: 18 },
  voteDate: { fontSize: 12, color: Colors.muted, marginTop: 4 },
});
