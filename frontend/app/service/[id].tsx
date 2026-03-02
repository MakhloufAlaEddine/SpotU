import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, Modal, Image,
  KeyboardAvoidingView, Platform, FlatList, Dimensions,
} from 'react-native';

const { width: SW } = Dimensions.get('window');
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import type { MapPin } from '../../components/MapViewComponent';
import { api } from '../../lib/api';
import { getOrCreateConversation } from '../../lib/chat';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ─── Constants ─────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_LONG = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const PRECISION_LABEL: Record<string, string> = { exact: 'Précis', '100m': '± 100m', '1000m': '± 1km' };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNextOccurrence(slot: any): string {
  if (slot.slot_type === 'single' && slot.slot_date) {
    const d = new Date(slot.slot_date + 'T' + slot.start_time);
    return `${formatFullDate(slot.slot_date)} · ${slot.start_time}${slot.end_time ? ` → ${slot.end_time}` : ''}`;
  }
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
  if (slot.slot_type === 'single' && slot.slot_date) {
    return new Date(slot.slot_date + 'T' + slot.start_time);
  }
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

function formatFullDate(dateStr: string): string {
  // dateStr = "2026-02-28" → "Vendredi 28 février 2026"
  const d = new Date(dateStr + 'T00:00:00');
  const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
  return `${DAYS_FULL[dow]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
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
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set());
  const [visibleCount, setVisibleCount] = useState(4);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [isSaved, setIsSaved] = useState(false);
  const [savingInProgress, setSavingInProgress] = useState(false);
  const photoListRef = useRef<FlatList>(null);

  // ── Demandes / réservations ─────────────────────────────────────────────────
  const [serviceBookings, setServiceBookings] = useState<any[]>([]);
  const [showRequests, setShowRequests]       = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(false);

  const toggleDate = (key: string) => {
    setCollapsedDates(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // Ouvrir seulement le 1er accordéon par défaut après chargement des données
  useEffect(() => {
    if (!service?.slots?.length) return;
    const dateKeys = new Set<string>();
    for (const slot of (service.slots ?? [])) {
      const isDateSlot = slot.slot_type === 'single' || slot.slot_type === 'specific';
      const key = isDateSlot && slot.slot_date
        ? slot.slot_date
        : String(slot.day_of_week ?? 'x');
      dateKeys.add(key);
    }
    const sorted = [...dateKeys].sort((a, b) => {
      const aIsDate = /^\d{4}-\d{2}-\d{2}$/.test(a);
      const bIsDate = /^\d{4}-\d{2}-\d{2}$/.test(b);
      if (aIsDate && bIsDate) return a.localeCompare(b);
      return (isNaN(Number(a)) ? 99 : Number(a)) - (isNaN(Number(b)) ? 99 : Number(b));
    });
    // Fermer tout sauf le premier
    setCollapsedDates(new Set(sorted.slice(1)));
  }, [service]);

  useEffect(() => { if (id) loadService(); }, [id]);

  const loadService = async () => {
    try {
      const data = await api.get(`/services/${id}`);
      setService(data);
      if (data.locations?.length > 0) setSelectedLocationId(data.locations[0].location_id);
      if (user) {
        try {
          const saved = await api.get('/services/saved');
          setIsSaved((saved || []).some((s: any) => s.service_id === id));
        } catch {}
        try {
          const bookings = await api.get<any[]>(`/bookings/service/${id}`);
          setServiceBookings(bookings || []);
        } catch {}
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Service introuvable');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSave = async () => {
    if (!user) { router.push('/(auth)/login' as any); return; }
    setSavingInProgress(true);
    try {
      if (isSaved) {
        await api.delete(`/services/${id}/unsave`);
        setIsSaved(false);
      } else {
        await api.post(`/services/${id}/save`, {});
        setIsSaved(true);
      }
    } catch {}
    finally { setSavingInProgress(false); }
  };

  const handleBook = () => {
    if (!user) {
      Alert.alert('', 'Connectez-vous pour réserver');
      router.push('/(auth)/login' as any);
      return;
    }
    if (!selectedSlotId) return;
    const selectedSlot = service.slots?.find((s: any) => s.slot_id === selectedSlotId);
    const scheduledAt = selectedSlot ? getNextDate(selectedSlot).toISOString() : null;
    router.push({
      pathname: '/booking/confirm',
      params: {
        serviceId: service.service_id,
        slotId: selectedSlotId,
        locationId: selectedLocationId || '',
        scheduledAt: scheduledAt || '',
      },
    } as any);
  };

  const [chatLoading, setChatLoading] = React.useState(false);
  const handleContact = async () => {
    if (!user) { Alert.alert('', 'Connectez-vous pour contacter le coach'); return; }
    setChatLoading(true);
    try {
      const conv = await getOrCreateConversation('service', service.service_id);
      router.push(`/chat/${conv.conversation_id}` as any);
    } catch { Alert.alert('Erreur', 'Impossible d\'ouvrir la conversation'); }
    finally { setChatLoading(false); }
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
        {/* Bouton favoris */}
        {/* Bouton demandes (coach) / ma demande (user) + favoris */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {isOwnService && serviceBookings.length > 0 && (
            <TouchableOpacity
              style={s.headerBackBtn}
              onPress={() => setShowRequests(true)}
              testID="requests-btn"
            >
              <View>
                <Ionicons name="people-outline" size={22} color={Colors.primary} />
                <View style={rb.badge}>
                  <Text style={rb.badgeTxt}>{serviceBookings.length > 9 ? '9+' : serviceBookings.length}</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
          {!isOwnService && serviceBookings.length > 0 && (
            <TouchableOpacity
              style={s.headerBackBtn}
              onPress={() => setShowRequests(true)}
              testID="my-booking-btn"
            >
              <Ionicons name="calendar-outline" size={22} color={Colors.primary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.headerBackBtn}
            onPress={handleToggleSave}
            disabled={savingInProgress}
            testID="save-service-btn"
          >
            <Ionicons
              name={isSaved ? 'bookmark' : 'bookmark-outline'}
              size={22}
              color={isSaved ? Colors.primary : Colors.foreground}
            />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Carrousel photos ─────────────────────────────────────────────── */}
        {Array.isArray(service.images) && service.images.length > 0 && (() => {
          const imgs: string[] = service.images;
          return (
            <View style={s.carousel} testID="photo-carousel">
              <FlatList
                ref={photoListRef}
                data={imgs}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                keyExtractor={(_, i) => String(i)}
                onMomentumScrollEnd={e => {
                  const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
                  setPhotoIdx(idx);
                }}
                renderItem={({ item }) => (
                  <Image
                    source={{ uri: item }}
                    style={s.carouselImg}
                    resizeMode="cover"
                    testID="carousel-photo"
                  />
                )}
              />
              {/* Dots */}
              {imgs.length > 1 && (
                <View style={s.carouselDots}>
                  {imgs.map((_, i) => (
                    <View key={i} style={[s.carouselDot, i === photoIdx && s.carouselDotActive]} />
                  ))}
                </View>
              )}
              {/* Compteur */}
              <View style={s.carouselCounter}>
                <Text style={s.carouselCounterText}>{photoIdx + 1} / {imgs.length}</Text>
              </View>
            </View>
          );
        })()}

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

        {/* ── Lieux & Créneaux groupés par lieu ────────────────────────── */}
        {locations.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Lieux & Disponibilités</Text>

            {/* Map */}
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

            {/* Per-location mini-calendar cards */}
            {locations.map((loc: any, locIdx: number) => {
              const locSlots: any[] = slots.filter((s: any) =>
                s.location_id === loc.location_id ||
                (!s.location_id && locIdx === 0)
              );
              // Active days for recurring/availability
              const activeDays = [...new Set(
                locSlots
                  .filter((s: any) => s.slot_type !== 'single' && s.day_of_week !== null && s.day_of_week !== undefined)
                  .map((s: any) => s.day_of_week as number)
              )].sort((a, b) => a - b);

              const singleSlots = locSlots.filter((s: any) => s.slot_type === 'single');
              const hasRecurring = locSlots.some((s: any) => s.slot_type !== 'single');
              const schedTypeLabel = locSlots.length === 0 ? null
                : locSlots[0].slot_type === 'availability' ? 'Disponibilité sur RDV'
                : locSlots[0].slot_type === 'single' ? 'Événement ponctuel'
                : 'Récurrent';

              return (
                <View key={loc.location_id} style={[s.locSectionCard, activeLocIdx === locIdx && s.locSectionCardActive]}>
                  {/* Location header */}
                  <TouchableOpacity
                    style={s.locSectionHeader}
                    onPress={() => setActiveLocIdx(locIdx)}
                    testID={`location-item-${loc.location_id}`}
                    activeOpacity={0.7}
                  >
                    <View style={[s.locSectionIcon, activeLocIdx === locIdx && s.locSectionIconActive]}>
                      <Ionicons name="location" size={14} color={activeLocIdx === locIdx ? Colors.background : ORANGE} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.locSectionTitle}>{loc.description || `Lieu ${locIdx + 1}`}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <Text style={s.locSectionMeta}>{PRECISION_LABEL[loc.precision] ?? loc.precision}</Text>
                        {schedTypeLabel && (
                          <>
                            <View style={s.metaDot} />
                            <Text style={s.locSectionMeta}>{schedTypeLabel}</Text>
                          </>
                        )}
                      </View>
                    </View>
                    {activeLocIdx === locIdx
                      ? <Ionicons name="checkmark-circle" size={18} color={ORANGE} />
                      : <Ionicons name="chevron-down" size={16} color={Colors.muted} />
                    }
                  </TouchableOpacity>

                  {/* Mini week-calendar (for recurring/availability) */}
                  {hasRecurring && activeDays.length > 0 && (
                    <View style={s.weekGrid}>
                      {[0,1,2,3,4,5,6].map(d => {
                        const active = activeDays.includes(d);
                        return (
                          <View key={d} style={s.weekGridItem}>
                            <View style={[s.weekDayCell, active && s.weekDayCellActive]}>
                              <Text style={[s.weekDayText, active && s.weekDayTextActive]}>
                                {DAYS_SHORT[d]}
                              </Text>
                            </View>
                            {active && <View style={s.weekDayDot} />}
                          </View>
                        );
                      })}
                    </View>
                  )}

                  {/* Slot accordéon — groupé par date, trié par date croissante */}
                  {locSlots.length > 0 ? (() => {
                    // Grouper : single → par slot_date ; recurring → par day_of_week
                    const dayMap: Record<string, any[]> = {};
                    for (const slot of locSlots) {
                      const isDateSlot = slot.slot_type === 'single' || slot.slot_type === 'specific';
                      const key = isDateSlot
                        ? (slot.slot_date ?? 'unknown')
                        : String(slot.day_of_week ?? 'x');
                      if (!dayMap[key]) dayMap[key] = [];
                      dayMap[key].push(slot);
                    }
                    // Trier : dates ISO croissantes, puis day_of_week numérique
                    const sortedKeys = Object.keys(dayMap).sort((a, b) => {
                      const aIsDate = /^\d{4}-\d{2}-\d{2}$/.test(a);
                      const bIsDate = /^\d{4}-\d{2}-\d{2}$/.test(b);
                      if (aIsDate && bIsDate) return a.localeCompare(b);
                      return (isNaN(Number(a)) ? 99 : Number(a)) - (isNaN(Number(b)) ? 99 : Number(b));
                    });

                    return (
                      <View style={s.accordionList}>
                        {(sortedKeys.slice(0, visibleCount)).map(key => {
                          const group = dayMap[key];
                          const firstSlot = group[0];
                          const isSingle = firstSlot.slot_type === 'single' || firstSlot.slot_type === 'specific';
                          const dateLabel = isSingle
                            ? formatFullDate(key)
                            : (firstSlot.day_of_week != null ? DAYS_FULL[firstSlot.day_of_week] : '?');
                          const isExpanded = !collapsedDates.has(key);
                          const isGroupSelected = group.some((sl: any) => sl.slot_id === selectedSlotId);

                          return (
                            <View key={key} style={s.accordionGroup}>
                              {/* Header date */}
                              <TouchableOpacity
                                style={[s.accordionHeader, isGroupSelected && s.accordionHeaderSelected]}
                                onPress={() => toggleDate(key)}
                                testID={`date-group-${key}`}
                                activeOpacity={0.7}
                              >
                                <Text style={[s.accordionDateLabel, isGroupSelected && s.accordionDateLabelSelected]}>
                                  {dateLabel}
                                </Text>
                                <Ionicons
                                  name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                  size={16}
                                  color={isGroupSelected ? ORANGE : Colors.muted}
                                />
                              </TouchableOpacity>

                              {/* Chips horaires */}
                              {isExpanded && (
                                <View style={s.accordionBody}>
                                  {group.map((slot: any) => {
                                    const isSelected = slot.slot_id === selectedSlotId;
                                    const label = slot.end_time
                                      ? `${slot.start_time} → ${slot.end_time}`
                                      : slot.start_time;
                                    return (
                                      <TouchableOpacity
                                        key={slot.slot_id}
                                        style={[s.slotChip, isSelected && s.slotChipActive]}
                                        onPress={() => {
                                          setSelectedSlotId(slot.slot_id);
                                          setSelectedLocationId(loc.location_id);
                                          setActiveLocIdx(locIdx);
                                        }}
                                        testID={`slot-chip-${slot.slot_id}`}
                                        activeOpacity={0.7}
                                      >
                                        <Text style={[s.slotChipText, isSelected && s.slotChipTextActive]}>
                                          {label}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </View>
                              )}
                            </View>
                          );
                        })}

                        {/* Bouton "Voir plus" */}
                        {sortedKeys.length > visibleCount && (
                          <TouchableOpacity
                            style={s.showMoreBtn}
                            onPress={() => setVisibleCount(c => c + 3)}
                            testID="show-more-dates-btn"
                          >
                            <Text style={s.showMoreBtnText}>
                              VOIR PLUS DE DATES ({Math.min(3, sortedKeys.length - visibleCount)} DE PLUS)
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })() : (
                    <View style={s.noSlotsNote}>
                      <Ionicons name="calendar-outline" size={14} color={Colors.muted} />
                      <Text style={s.noSlotsText}>Aucun créneau configuré pour ce lieu</Text>
                    </View>
                  )}
                </View>
              );
            })}
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
          <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <Text style={s.bookBarPrice} numberOfLines={1}>{service.price}€/séance</Text>
            <Text style={s.bookBarMeta} numberOfLines={1}>
              {selectedSlotId
                ? (() => {
                    const sl = service.slots?.find((sl: any) => sl.slot_id === selectedSlotId);
                    if (!sl) return 'Sélectionné';
                    const isDate = sl.slot_type === 'single' || sl.slot_type === 'specific';
                    return isDate && sl.slot_date
                      ? `${formatFullDate(sl.slot_date)} · ${sl.start_time}`
                      : `${DAYS_FULL[sl.day_of_week] ?? ''} · ${sl.start_time}`;
                  })()
                : 'Choisir un créneau'
              }
            </Text>
          </View>
          <TouchableOpacity
            style={[s.bookBtn, !selectedSlotId && s.bookBtnDisabled]}
            onPress={handleBook}
            disabled={!selectedSlotId}
            testID="book-btn"
          >
            <Ionicons name="calendar" size={18} color={selectedSlotId ? Colors.background : Colors.muted} />
            <Text style={[s.bookBtnText, !selectedSlotId && { color: Colors.muted }]}>Réserver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.bookBtn, { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border }]}
            onPress={handleContact}
            disabled={chatLoading}
            testID="contact-btn"
          >
            {chatLoading
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Ionicons name="chatbubble-ellipses-outline" size={18} color={Colors.primary} />
            }
            <Text style={[s.bookBtnText, { color: Colors.primary }]}>Contacter</Text>
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

      {/* ── Modal Demandes / Ma demande ────────────────────────────────────── */}
      <Modal visible={showRequests} animationType="slide" transparent onRequestClose={() => setShowRequests(false)}>
        <View style={rb.overlay}>
          <TouchableOpacity style={rb.backdrop} activeOpacity={1} onPress={() => setShowRequests(false)} />
          <View style={[rb.sheet, { maxHeight: '80%' }]}>
            {/* Header modal */}
            <View style={rb.header}>
              <Text style={rb.title}>
                {isOwnService
                  ? `Demandes reçues (${serviceBookings.length})`
                  : 'Ma demande'}
              </Text>
              <TouchableOpacity onPress={() => setShowRequests(false)} testID="close-requests-modal">
                <Ionicons name="close" size={22} color={Colors.foreground} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {serviceBookings.length === 0 ? (
                <View style={rb.empty}>
                  <Ionicons name="calendar-outline" size={40} color={Colors.muted} />
                  <Text style={rb.emptyTxt}>Aucune demande pour l'instant</Text>
                </View>
              ) : (
                serviceBookings.map((b) => {
                  const STATUS: Record<string, { label: string; color: string }> = {
                    pending:  { label: 'En attente', color: '#F59E0B' },
                    accepted: { label: 'Acceptée',   color: Colors.primary },
                    refused:  { label: 'Refusée',    color: '#EF4444' },
                  };
                  const st = STATUS[b.status] ?? STATUS.pending;
                  const person = isOwnService ? b.user : b.coach;
                  return (
                    <TouchableOpacity
                      key={b.booking_id}
                      style={rb.row}
                      activeOpacity={0.75}
                      onPress={() => { setShowRequests(false); router.push(`/booking/${b.booking_id}` as any); }}
                      testID={`booking-row-${b.booking_id}`}
                    >
                      {/* Avatar */}
                      <View style={rb.avatar}>
                        {person?.picture
                          ? <Image source={{ uri: person.picture }} style={{ width: '100%', height: '100%' }} />
                          : <Text style={rb.avatarLetter}>{person?.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                        }
                      </View>
                      <View style={rb.rowContent}>
                        <Text style={rb.rowName} numberOfLines={1}>{person?.name || '—'}</Text>
                        {b.slot && (
                          <Text style={rb.rowSub} numberOfLines={1}>
                            {b.slot.slot_date ?? `Jour ${b.slot.day_of_week}`}
                            {b.slot.start_time ? `  ${b.slot.start_time}→${b.slot.end_time}` : ''}
                          </Text>
                        )}
                        {b.notes ? <Text style={rb.rowNote} numberOfLines={1}>{b.notes}</Text> : null}
                      </View>
                      <View style={[rb.statusBadge, { backgroundColor: st.color + '22', borderColor: st.color + '55' }]}>
                        <Text style={[rb.statusTxt, { color: st.color }]}>{st.label}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
                    </TouchableOpacity>
                  );
                })
              )}
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
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
  // Carrousel photos
  carousel: { height: 240, backgroundColor: Colors.backgroundSecondary, overflow: 'hidden' },
  carouselImg: { width: SW, height: 240 },
  carouselDots: {
    position: 'absolute', bottom: 10, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 6,
  },
  carouselDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  carouselDotActive: { backgroundColor: '#fff', width: 18 },
  carouselCounter: {
    position: 'absolute', top: 10, right: 12,
    backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 12,
    paddingHorizontal: 9, paddingVertical: 3,
  },
  carouselCounterText: { color: '#fff', fontSize: 12, fontWeight: '600' },

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

  // Per-location section cards
  locSectionCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 12, overflow: 'hidden',
  },
  locSectionCardActive: { borderColor: ORANGE },
  locSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14,
  },
  locSectionIcon: {
    width: 30, height: 30, borderRadius: 9, backgroundColor: ORANGE_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  locSectionIconActive: { backgroundColor: ORANGE },
  locSectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 20 },
  locSectionMeta: { fontSize: 11, color: Colors.muted },

  // Mini week grid
  weekGrid: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingBottom: 12, gap: 4,
  },
  weekGridItem: { alignItems: 'center', gap: 4, flex: 1 },
  weekDayCell: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  weekDayCellActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  weekDayText: { fontSize: 10, fontWeight: '700', color: Colors.muted },
  weekDayTextActive: { color: Colors.background },
  weekDayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: ORANGE },

  // Per-location slot list → Accordion
  accordionList: { borderTopWidth: 1, borderTopColor: Colors.border },
  accordionGroup: { borderTopWidth: 1, borderTopColor: Colors.border },
  accordionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 14,
    backgroundColor: Colors.card,
  },
  accordionHeaderSelected: { backgroundColor: ORANGE_LIGHT },
  accordionDateLabel: { fontSize: 15, fontWeight: '700', color: Colors.foreground, flex: 1 },
  accordionDateLabelSelected: { color: ORANGE },
  accordionBody: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 10,
    paddingHorizontal: 14, paddingBottom: 14, paddingTop: 4,
    backgroundColor: Colors.card,
  },
  // Slot chips (style Doctolib)
  slotChip: {
    paddingHorizontal: 18, paddingVertical: 10,
    borderRadius: 8, minWidth: 72, alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1, borderColor: Colors.border,
  },
  slotChipActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  slotChipText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  slotChipTextActive: { color: Colors.background },
  // Bouton "Voir plus de dates"
  showMoreBtn: {
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  showMoreBtnText: {
    fontSize: 13, fontWeight: '700', color: ORANGE, letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  // (kept for booking modal compatibility)
  locSlotList: { borderTopWidth: 1, borderTopColor: Colors.border },
  locSlotRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 14, backgroundColor: Colors.card,
  },
  locSlotRowBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  locSlotRowActive: { backgroundColor: ORANGE_LIGHT },
  noSlotsNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 14, borderTopWidth: 1, borderTopColor: Colors.border,
  },
  noSlotsText: { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },

  // Slot elements
  slotDayBadge: {
    width: 40, height: 40, borderRadius: 10, backgroundColor: ORANGE_LIGHT,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  slotDayBadgeActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  slotDayText: { fontSize: 11, fontWeight: '800', color: ORANGE },
  slotDayTextActive: { color: Colors.background },
  slotTime: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  slotNext: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  // Time chips (multiple per day row)
  timeChip: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radius.md,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  timeChipActive: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE_BORDER },
  timeChipText: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  timeChipTextActive: { color: ORANGE },
  durationChip: {
    backgroundColor: Colors.background, borderRadius: Radius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: Colors.border,
  },
  durationChipActive: { borderColor: ORANGE_BORDER, backgroundColor: ORANGE_LIGHT },
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
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  bookBarPrice: { fontSize: 16, fontWeight: '900', color: ORANGE },
  bookBarMeta: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  bookBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: ORANGE, borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 12,
    flexShrink: 0,
  },
  bookBtnDisabled: {
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  bookBtnText: { fontSize: 13, fontWeight: '800', color: Colors.background },
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

const rb = StyleSheet.create({
  badge:        { position: 'absolute', top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeTxt:     { fontSize: 9, fontWeight: '800', color: Colors.background },
  overlay:      { flex: 1, justifyContent: 'flex-end' },
  backdrop:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet:        { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, paddingBottom: 40 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  title:        { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  avatar:       { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  avatarLetter: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  rowContent:   { flex: 1, gap: 2 },
  rowName:      { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  rowSub:       { fontSize: 12, color: Colors.muted },
  rowNote:      { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },
  statusBadge:  { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1 },
  statusTxt:    { fontSize: 11, fontWeight: '700' },
  empty:        { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyTxt:     { fontSize: 14, color: Colors.muted },
});

