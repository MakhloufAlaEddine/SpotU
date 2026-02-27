import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, Modal, Image,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import type { MapPin } from '../../components/MapViewComponent';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ─── Constants ─────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const PRECISION_LABEL: Record<string, string> = { exact: 'Précis', '100m': '± 100m', '1000m': '± 1km' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNextOccurrence(slot: any): string {
  const now = new Date();
  const todayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const [h, m] = slot.start_time.split(':').map(Number);
  let daysUntil = (slot.day_of_week - todayIdx + 7) % 7;
  if (daysUntil === 0 && (h * 60 + m) <= (now.getHours() * 60 + now.getMinutes())) daysUntil = 7;
  const d = new Date(now);
  d.setDate(now.getDate() + daysUntil);
  d.setHours(h, m, 0, 0);
  const dayStr = daysUntil === 0 ? "Aujourd'hui" : daysUntil === 1 ? 'Demain' : DAYS_FULL[slot.day_of_week];
  return `${dayStr} · ${slot.start_time}${slot.end_time ? ` → ${slot.end_time}` : ''}`;
}

function getNextDate(slot: any): Date {
  const now = new Date();
  const todayIdx = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const [h, m] = slot.start_time.split(':').map(Number);
  let daysUntil = (slot.day_of_week - todayIdx + 7) % 7;
  if (daysUntil === 0 && (h * 60 + m) <= (now.getHours() * 60 + now.getMinutes())) daysUntil = 7;
  const d = new Date(now);
  d.setDate(now.getDate() + daysUntil);
  d.setHours(h, m, 0, 0);
  return d;
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ServiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [service, setService] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showBooking, setShowBooking] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeLocIdx, setActiveLocIdx] = useState(0);

  useEffect(() => { if (id) loadService(); }, [id]);

  const loadService = async () => {
    try {
      const data = await api.get(`/services/${id}`);
      setService(data);
      if (data.locations?.length > 0) setSelectedLocationId(data.locations[0].location_id);
      if (data.slots?.length > 0) setSelectedSlotId(data.slots[0].slot_id);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Service introuvable');
    } finally {
      setLoading(false);
    }
  };

  const handleBook = async () => {
    if (!user) {
      Alert.alert('', 'Connectez-vous pour réserver');
      router.push('/(auth)/login' as any);
      return;
    }
    if (!selectedSlotId && service.slots?.length > 0) {
      Alert.alert('', 'Sélectionnez un créneau');
      return;
    }
    setSubmitting(true);
    try {
      const selectedSlot = service.slots?.find((s: any) => s.slot_id === selectedSlotId);
      const scheduledAt = selectedSlot ? getNextDate(selectedSlot).toISOString() : null;
      await api.post('/bookings', {
        service_id: service.service_id,
        slot_id: selectedSlotId || null,
        location_id: selectedLocationId || null,
        scheduled_at: scheduledAt,
        notes: notes.trim() || null,
      });
      setShowBooking(false);
      setNotes('');
      Alert.alert(
        'Demande envoyée !',
        'Le coach va examiner votre demande. Vous serez notifié de sa réponse.',
        [
          { text: 'Mes réservations', onPress: () => router.push('/(tabs)/bookings' as any) },
          { text: 'OK', style: 'cancel' },
        ]
      );
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer la réservation');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={ORANGE} />
      </View>
    );
  }

  if (!service) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.muted} />
        <Text style={{ color: Colors.muted, marginTop: 8 }}>Service introuvable</Text>
      </View>
    );
  }

  const { locations = [], slots = [], coach, tags: svcTags = [] } = service;
  const isOwnService = user?.user_id === service.coach_id;

  const pins: MapPin[] = locations.map((loc: any) => ({
    id: loc.location_id,
    lat: loc.latitude,
    lng: loc.longitude,
    title: loc.description || 'Lieu',
    color: ORANGE,
  }));
  const centerLoc = locations[activeLocIdx] ?? locations[0];

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBackBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>Détail du service</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <View style={s.hero}>
          <View style={s.heroPriceRow}>
            <View style={s.priceBadge}>
              <Text style={s.priceAmount}>{service.price}€</Text>
              <Text style={s.priceLabel}>/séance</Text>
            </View>
            <View style={s.serviceBadge}>
              <Ionicons name="briefcase-outline" size={12} color={ORANGE} />
              <Text style={s.serviceBadgeText}>Service</Text>
            </View>
          </View>
          <Text style={s.heroTitle} testID="service-title">{service.title}</Text>
          {service.description ? (
            <Text style={s.heroDesc}>{service.description}</Text>
          ) : null}
          <View style={s.metaRow}>
            <View style={s.metaItem}>
              <Ionicons name="time-outline" size={13} color={Colors.muted} />
              <Text style={s.metaText}>{service.duration_min} min</Text>
            </View>
            <View style={s.metaDot} />
            <View style={s.metaItem}>
              <Ionicons name="people-outline" size={13} color={Colors.muted} />
              <Text style={s.metaText}>{service.max_participants} pers.</Text>
            </View>
            {locations.length > 0 && (
              <>
                <View style={s.metaDot} />
                <View style={s.metaItem}>
                  <Ionicons name="location-outline" size={13} color={Colors.muted} />
                  <Text style={s.metaText}>{locations.length} lieu{locations.length > 1 ? 'x' : ''}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ── Coach Card ────────────────────────────────────────────────────── */}
        {coach && (
          <TouchableOpacity
            style={s.coachCard}
            onPress={() => router.push(`/user/${coach.user_id}` as any)}
            testID="coach-card"
            activeOpacity={0.75}
          >
            <View style={s.coachAvatar}>
              {coach.picture
                ? <Image source={{ uri: coach.picture }} style={{ width: '100%', height: '100%' }} />
                : <Text style={s.coachAvatarText}>{coach.name?.[0]?.toUpperCase() || '?'}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={s.coachName}>{coach.name}</Text>
                {coach.is_coach_verified && (
                  <View style={s.verifiedBadge}>
                    <Text style={s.verifiedText}>Certifié</Text>
                  </View>
                )}
              </View>
              {service.avg_rating != null && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 }}>
                  {[1, 2, 3, 4, 5].map(i => (
                    <Ionicons key={i}
                      name={i <= Math.round(service.avg_rating) ? 'star' : 'star-outline'}
                      size={11} color={i <= Math.round(service.avg_rating) ? Colors.star : Colors.muted} />
                  ))}
                  <Text style={{ fontSize: 11, color: Colors.muted, marginLeft: 3 }}>
                    {service.avg_rating.toFixed(1)} ({service.review_count} avis)
                  </Text>
                </View>
              )}
            </View>
            <Ionicons name="chevron-forward" size={17} color={Colors.muted} />
          </TouchableOpacity>
        )}

        {/* ── Tags ──────────────────────────────────────────────────────────── */}
        {svcTags.length > 0 && (
          <View style={s.tagsSection}>
            {svcTags.map((tag: any) => (
              <View key={tag.tag_id} style={s.tagChip}>
                <Text style={s.tagText}>{tag.label_fr}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ── Lieux ─────────────────────────────────────────────────────────── */}
        {locations.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Lieux d'intervention</Text>

            {/* Map — shows all pins, centers on selected */}
            <View style={s.mapWrap} testID="service-map">
              <MapViewComponent
                pins={pins}
                centerLat={centerLoc?.latitude ?? 48.8566}
                centerLng={centerLoc?.longitude ?? 2.3522}
                zoom={locations.length === 1 ? 15 : 12}
                style={{ flex: 1 }}
                onPinPress={locId => {
                  const idx = locations.findIndex((l: any) => l.location_id === locId);
                  if (idx >= 0) setActiveLocIdx(idx);
                }}
              />
            </View>

            {/* Location list */}
            {locations.map((loc: any, i: number) => (
              <TouchableOpacity
                key={loc.location_id}
                style={[s.locCard, activeLocIdx === i && s.locCardActive]}
                onPress={() => setActiveLocIdx(i)}
                testID={`location-item-${loc.location_id}`}
                activeOpacity={0.7}
              >
                <View style={[s.locIconBox, activeLocIdx === i && s.locIconBoxActive]}>
                  <Ionicons name="location" size={13} color={activeLocIdx === i ? Colors.background : ORANGE} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.locTitle}>{loc.description || `Lieu ${i + 1}`}</Text>
                  <Text style={s.locPrecision}>{PRECISION_LABEL[loc.precision] ?? loc.precision}</Text>
                </View>
                {activeLocIdx === i && (
                  <Ionicons name="checkmark-circle" size={16} color={ORANGE} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Créneaux ──────────────────────────────────────────────────────── */}
        {slots.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Créneaux disponibles</Text>
            <View style={s.slotsTable}>
              {slots.map((slot: any, i: number) => (
                <View key={slot.slot_id}
                  style={[s.slotRow, i > 0 && s.slotRowBorder]}
                  testID={`slot-row-${slot.slot_id}`}
                >
                  <View style={s.slotDayBadge}>
                    <Text style={s.slotDayText}>{DAYS_SHORT[slot.day_of_week]}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.slotTime}>
                      {slot.start_time}{slot.end_time ? ` → ${slot.end_time}` : ''}
                    </Text>
                    <Text style={s.slotNext}>{getNextOccurrence(slot)}</Text>
                  </View>
                  <View style={s.durationChip}>
                    <Text style={s.durationChipText}>{service.duration_min}min</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Commission info ────────────────────────────────────────────────── */}
        <View style={s.commNote}>
          <Ionicons name="shield-checkmark-outline" size={14} color={Colors.muted} />
          <Text style={s.commText}>
            Paiement sécurisé · Commission 15% · Net coach : {(service.price * 0.85).toFixed(2)}€
          </Text>
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* ── Fixed Book Button ─────────────────────────────────────────────── */}
      {!isOwnService && (
        <View style={s.bookBar}>
          <View style={{ flex: 1 }}>
            <Text style={s.bookBarPrice}>{service.price}€ / séance</Text>
            <Text style={s.bookBarMeta}>{service.duration_min} min · {service.max_participants} pers. max</Text>
          </View>
          <TouchableOpacity style={s.bookBtn} onPress={() => setShowBooking(true)} testID="book-btn">
            <Ionicons name="calendar" size={18} color={Colors.background} />
            <Text style={s.bookBtnText}>Réserver</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Owner action bar ─────────────────────────────────────────────── */}
      {isOwnService && (
        <View style={s.bookBar}>
          <TouchableOpacity
            style={[s.bookBtn, { flex: 1, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]}
            onPress={() => Alert.alert('Options du service', '', [
              { text: 'Modifier', onPress: () => router.push(`/edit-service/${service.service_id}` as any) },
              { text: service.active ? 'Désactiver' : 'Réactiver', onPress: async () => {
                try { await api.put(`/services/${service.service_id}`, { active: !service.active }); loadService(); } catch {}
              }},
              { text: 'Annuler', style: 'cancel' },
            ])}
            testID="owner-options-btn"
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={Colors.foreground} />
            <Text style={[s.bookBtnText, { color: Colors.foreground }]}>Options</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.bookBtn}
            onPress={() => router.push(`/edit-service/${service.service_id}` as any)}
            testID="edit-service-btn"
          >
            <Ionicons name="create-outline" size={18} color={Colors.background} />
            <Text style={s.bookBtnText}>Modifier</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Booking Modal ─────────────────────────────────────────────────── */}
      <Modal visible={showBooking} animationType="slide" transparent onRequestClose={() => setShowBooking(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={ms.overlay}>
            <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowBooking(false)} />
            <View style={ms.sheet}>
              <View style={ms.sheetHeader}>
                <Text style={ms.sheetTitle}>Réserver une séance</Text>
                <TouchableOpacity onPress={() => setShowBooking(false)} testID="close-booking-btn">
                  <Ionicons name="close" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Location picker (only if multiple) */}
                {locations.length > 1 && (
                  <View style={ms.group}>
                    <Text style={ms.groupLabel}>Lieu</Text>
                    {locations.map((loc: any) => (
                      <TouchableOpacity
                        key={loc.location_id}
                        style={[ms.optCard, selectedLocationId === loc.location_id && ms.optCardActive]}
                        onPress={() => setSelectedLocationId(loc.location_id)}
                        testID={`book-loc-${loc.location_id}`}
                      >
                        <Ionicons name="location-outline" size={16}
                          color={selectedLocationId === loc.location_id ? ORANGE : Colors.muted} />
                        <Text style={[ms.optText, selectedLocationId === loc.location_id && ms.optTextActive]}>
                          {loc.description || 'Lieu'}
                        </Text>
                        {selectedLocationId === loc.location_id && (
                          <Ionicons name="checkmark-circle" size={18} color={ORANGE} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Slot picker */}
                {slots.length > 0 && (
                  <View style={ms.group}>
                    <Text style={ms.groupLabel}>Créneau</Text>
                    {slots.map((slot: any) => (
                      <TouchableOpacity
                        key={slot.slot_id}
                        style={[ms.optCard, selectedSlotId === slot.slot_id && ms.optCardActive]}
                        onPress={() => setSelectedSlotId(slot.slot_id)}
                        testID={`book-slot-${slot.slot_id}`}
                      >
                        <Ionicons name="time-outline" size={16}
                          color={selectedSlotId === slot.slot_id ? ORANGE : Colors.muted} />
                        <View style={{ flex: 1 }}>
                          <Text style={[ms.optText, selectedSlotId === slot.slot_id && ms.optTextActive]}>
                            {DAYS_FULL[slot.day_of_week]} · {slot.start_time}{slot.end_time ? ` → ${slot.end_time}` : ''}
                          </Text>
                          <Text style={ms.optSub}>{getNextOccurrence(slot)}</Text>
                        </View>
                        {selectedSlotId === slot.slot_id && (
                          <Ionicons name="checkmark-circle" size={18} color={ORANGE} />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {/* Notes */}
                <View style={ms.group}>
                  <Text style={ms.groupLabel}>Message au coach (optionnel)</Text>
                  <TextInput
                    style={ms.notesInput}
                    value={notes}
                    onChangeText={setNotes}
                    placeholder="Niveau actuel, objectifs, questions…"
                    placeholderTextColor={Colors.muted}
                    multiline numberOfLines={3}
                    textAlignVertical="top"
                    testID="booking-notes-input"
                  />
                </View>

                {/* Price summary */}
                <View style={ms.priceSummary}>
                  <View style={ms.priceRow}>
                    <Text style={ms.priceRowLabel}>Prix par séance</Text>
                    <Text style={ms.priceRowValue}>{service.price}€</Text>
                  </View>
                  <View style={ms.priceRow}>
                    <Text style={[ms.priceRowLabel, { color: Colors.muted }]}>Commission (15%)</Text>
                    <Text style={[ms.priceRowValue, { color: Colors.muted }]}>
                      inclus
                    </Text>
                  </View>
                  <View style={[ms.priceRow, ms.priceTotalRow]}>
                    <Text style={ms.priceTotalLabel}>Total</Text>
                    <Text style={ms.priceTotalValue}>{service.price}€</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={[ms.confirmBtn, submitting && ms.confirmBtnDisabled]}
                  onPress={handleBook}
                  disabled={submitting}
                  testID="confirm-booking-btn"
                >
                  {submitting
                    ? <ActivityIndicator color={Colors.background} />
                    : <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={Colors.background} />
                      <Text style={ms.confirmBtnText}>Confirmer la réservation</Text>
                    </>
                  }
                </TouchableOpacity>

                <View style={{ height: 24 }} />
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground, flex: 1, textAlign: 'center' },

  scrollContent: { paddingBottom: 20 },

  // Hero
  hero: {
    padding: Spacing.md, paddingBottom: Spacing.lg,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  heroPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  priceBadge: {
    flexDirection: 'row', alignItems: 'baseline', gap: 2,
    backgroundColor: ORANGE_LIGHT, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  priceAmount: { fontSize: 20, fontWeight: '900', color: ORANGE },
  priceLabel: { fontSize: 12, fontWeight: '600', color: ORANGE },
  serviceBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border,
  },
  serviceBadgeText: { fontSize: 11, fontWeight: '700', color: ORANGE },
  heroTitle: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: 6 },
  heroDesc: { fontSize: 14, color: Colors.muted, lineHeight: 20, marginBottom: 10 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, color: Colors.muted, fontWeight: '500' },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: Colors.border },

  // Coach
  coachCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    margin: Spacing.md, padding: Spacing.md,
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border,
  },
  coachAvatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.primary, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  coachAvatarText: { fontSize: 20, fontWeight: '800', color: Colors.background },
  coachName: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  verifiedBadge: {
    backgroundColor: Colors.primaryLight, borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  verifiedText: { fontSize: 10, fontWeight: '700', color: Colors.primary },

  // Tags
  tagsSection: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  tagChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full,
    backgroundColor: ORANGE_LIGHT, borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  tagText: { fontSize: 12, fontWeight: '600', color: ORANGE },

  // Sections
  section: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, marginBottom: 12 },

  // Map
  mapWrap: {
    height: 200, borderRadius: Radius.lg, overflow: 'hidden',
    marginBottom: 12, borderWidth: 1, borderColor: Colors.border,
  },

  // Locations list
  locCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Radius.lg, marginBottom: 8,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  locCardActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  locIconBox: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: ORANGE_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  locIconBoxActive: { backgroundColor: ORANGE },
  locTitle: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  locPrecision: { fontSize: 11, color: Colors.muted, marginTop: 1 },

  // Slots table
  slotsTable: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  slotRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  slotDayBadge: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: ORANGE_LIGHT,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  slotDayText: { fontSize: 11, fontWeight: '800', color: ORANGE },
  slotTime: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  slotNext: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  durationChip: {
    backgroundColor: Colors.background, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border,
  },
  durationChipText: { fontSize: 11, fontWeight: '600', color: Colors.muted },

  // Commission note
  commNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    marginHorizontal: Spacing.md, marginTop: -4, marginBottom: Spacing.md,
    padding: 10, backgroundColor: Colors.card, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
  },
  commText: { fontSize: 11, color: Colors.muted, flex: 1, lineHeight: 16 },

  // Book bar
  bookBar: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
    paddingHorizontal: Spacing.md, paddingVertical: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  bookBarPrice: { fontSize: 18, fontWeight: '900', color: ORANGE },
  bookBarMeta: { fontSize: 12, color: Colors.muted, marginTop: 1 },
  bookBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE, borderRadius: Radius.full,
    paddingHorizontal: 24, paddingVertical: 13,
  },
  bookBtnText: { fontSize: 15, fontWeight: '800', color: Colors.background },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: Spacing.lg, paddingBottom: 36,
    maxHeight: '90%',
  },
  sheetHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: Spacing.lg,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },

  // Groups
  group: { marginBottom: Spacing.md },
  groupLabel: {
    fontSize: 11, fontWeight: '700', color: Colors.muted,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },

  // Option cards (location / slot)
  optCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 12, borderRadius: Radius.lg, marginBottom: 8,
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border,
  },
  optCardActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  optText: { fontSize: 14, fontWeight: '600', color: Colors.muted, flex: 1 },
  optTextActive: { color: Colors.foreground },
  optSub: { fontSize: 11, color: Colors.muted, marginTop: 2 },

  // Notes
  notesInput: {
    backgroundColor: Colors.card, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border,
    padding: Spacing.md, fontSize: 14, color: Colors.foreground,
    minHeight: 80, textAlignVertical: 'top',
  },

  // Price summary
  priceSummary: {
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.md, marginBottom: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, gap: 6,
  },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceRowLabel: { fontSize: 13, color: Colors.foreground },
  priceRowValue: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  priceTotalRow: {
    marginTop: 6, paddingTop: 8,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  priceTotalLabel: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  priceTotalValue: { fontSize: 18, fontWeight: '900', color: ORANGE },

  // Confirm button
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: ORANGE, borderRadius: Radius.full, paddingVertical: 15,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});
