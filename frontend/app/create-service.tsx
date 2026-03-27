import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  Modal, Dimensions, Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

const { height: SH } = Dimensions.get('window');
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LocationPicker } from '../components/LocationPicker';
import { StepLocalisation } from '../components/StepLocalisation';
import { WeekCalendar } from '../components/WeekCalendar';
import type { DaySlot } from '../components/WeekCalendar';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { useBookingConfig } from '../lib/useBookingConfig';
import { useGuardedRouter } from '../hooks/useGuardedRouter';
import { TagPickerField } from '../components/TagPickerField';

// ─── Hook pour charger la commission dynamique ────────────────────────────────
let _commissionCache: { receiverPct: number; payerPct: number; hasRule: boolean } | null = null;
function useCommission() {
  const [receiverPct, setReceiverPct] = useState(_commissionCache?.receiverPct ?? 0);
  const [payerPct, setPayerPct] = useState(_commissionCache?.payerPct ?? 0);
  const [hasRule, setHasRule] = useState(_commissionCache?.hasRule ?? false);
  useEffect(() => {
    if (_commissionCache) { setReceiverPct(_commissionCache.receiverPct); setPayerPct(_commissionCache.payerPct); setHasRule(_commissionCache.hasRule); return; }
    api.get('/config/commission').then((d: any) => {
      _commissionCache = { receiverPct: d.receiver_percent_fee ?? 0, payerPct: d.payer_percent_fee ?? 0, hasRule: !!d.has_rule };
      setReceiverPct(d.receiver_percent_fee ?? 0);
      setPayerPct(d.payer_percent_fee ?? 0);
      setHasRule(!!d.has_rule);
    }).catch(() => {});
  }, []);
  return { receiverPct, payerPct, hasCommissionRule: hasRule };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';
const GREEN = '#1DBF73';
const BLUE = '#0A84FF';
const BLUE_LIGHT = 'rgba(10,132,255,0.10)';
const AMBER = '#FF9F0A';
const AMBER_LIGHT = 'rgba(255,159,10,0.12)';

const STEP_LABELS = ['Infos', 'Lieu', 'Domaine', 'Config', 'Réservations', 'Résumé'];
const DURATIONS = [30, 45, 60, 90, 120];
const EXPIRY_OPTIONS = [
  { label: '30 min', value: 30 },
  { label: '1h', value: 60 },
  { label: '2h', value: 120 },
  { label: '4h', value: 240 },
  { label: '1 jour', value: 1440 },
];

// ── Impact text selon le combo booking_mode × pay_later ──────────────────────
function getImpactInfo(mode: string, payLater: boolean, expiryMin: number) {
  const expiryLabel = EXPIRY_OPTIONS.find(o => o.value === expiryMin)?.label ?? `${expiryMin} min`;
  if (mode === 'instant_booking' && !payLater) {
    return {
      badge: 'Réservation directe · Paiement immédiat',
      icon: 'flash' as const,
      color: GREEN,
      text: "Les utilisateurs réservent immédiatement un créneau disponible.\nLe paiement est effectué au moment de la réservation.\nLe créneau est confirmé et n'est plus disponible pour les autres.",
    };
  }
  if (mode === 'instant_booking' && payLater) {
    return {
      badge: `Réservation directe · Paiement différé · Créneau bloqué ${expiryLabel}`,
      icon: 'timer-outline' as const,
      color: BLUE,
      text: `Le créneau est réservé immédiatement, le paiement peut être effectué plus tard.\n\nPendant le délai de ${expiryLabel} :\n· Le créneau est bloqué pour les autres\n· Aucun autre utilisateur ne peut le réserver\n\nSi le paiement n'est pas reçu, le créneau redevient disponible.`,
    };
  }
  if (mode === 'manual_approval' && !payLater) {
    return {
      badge: 'Validation manuelle · Paiement immédiat',
      icon: 'hand-left-outline' as const,
      color: ORANGE,
      text: "Les utilisateurs envoient une demande de réservation.\nVous pouvez accepter ou refuser avant toute confirmation.\nLe paiement est demandé après votre accord.",
    };
  }
  return {
    badge: `Validation manuelle · Paiement différé · Créneau bloqué ${expiryLabel}`,
    icon: 'shield-checkmark-outline' as const,
    color: AMBER,
    text: `Les utilisateurs envoient une demande de réservation.\nSi vous acceptez, le créneau est temporairement bloqué.\n\nPendant le délai de ${expiryLabel} après votre acceptation :\n· Le créneau est réservé et bloqué\n· Il n'est plus visible pour les autres\n\nSi le paiement n'est pas reçu dans ce délai, la réservation expire et le créneau redevient disponible.`,
  };
}

const CATEGORY_COLORS: Record<string, string> = {
  cat_running: '#00BFA5', cat_football: '#4CAF50', cat_basketball: '#FF9800',
  cat_tennis: '#E91E63', cat_yoga: '#9C27B0', cat_cycling: '#2196F3',
  cat_fitness: '#F44336', cat_swimming: '#00BCD4', cat_boxing: '#FF5722',
  cat_hiking: '#8BC34A', cat_volleyball: '#FF9500', cat_martial: '#FF5722',
};
const tagColor = (cat?: string) => (cat && CATEGORY_COLORS[cat]) ? CATEGORY_COLORS[cat] : Colors.primary;

// ─── Score computation ────────────────────────────────────────────────────────
function computeScore(
  title: string, coachDesc: string, address: string,
  tagIds: string[], price: string, slots: DaySlot[], images: string[]
) {
  const criteria = [
    { label: 'Photos ajoutées', ok: images.length > 0, pts: 30 },
    { label: 'Créneaux configurés', ok: slots.length > 0, pts: 20 },
    { label: 'Titre renseigné (5+ car.)', ok: title.trim().length >= 5, pts: 15 },
    { label: 'Description du coach (50+ car.)', ok: coachDesc.trim().length >= 50, pts: 15 },
    { label: 'Tags sélectionnés', ok: tagIds.length > 0, pts: 10 },
    { label: 'Prix défini', ok: parseFloat(price) > 0, pts: 5 },
    { label: 'Adresse renseignée', ok: address.trim().length > 0, pts: 5 },
  ];
  const score = criteria.filter(c => c.ok).reduce((acc, c) => acc + c.pts, 0);
  return { score, criteria };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CreateServiceScreen() {
  const router = useGuardedRouter();
  const { user, token } = useAuth();
  const { lang } = useLang();
  const scrollRef = useRef<ScrollView>(null);
  const { serviceId } = useLocalSearchParams<{ serviceId?: string }>();
  const isEditMode = !!serviceId;
  const bookingCfg = useBookingConfig();
  const { receiverPct, payerPct, hasCommissionRule } = useCommission();
  // Flags globaux MVP
  const enableManualApproval = bookingCfg.enable_manual_approval_for_services;
  const enablePayLater       = bookingCfg.enable_pay_later_for_services;
  // Quand les deux sont désactivés, on saute complètement l'étape 4
  const skipStep4 = !enableManualApproval && !enablePayLater;

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);

  // Step 1
  const [title, setTitle] = useState('');
  const [coachDesc, setCoachDesc] = useState('');
  const [address, setAddress] = useState('');
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);
  const [precision, setPrecision] = useState('exact');
  const precisionRadius = precision === '1000m' ? 1000 : precision === '100m' ? 100 : 0;
  const [showLocPicker, setShowLocPicker] = useState(false);
  // Photos
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImages, setUploadingImages] = useState(false);

  // ─── Upload image helper (platform-aware) ────────────────────────────────────
  const uploadImage = async (uri: string): Promise<string> => {
    const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    const filename = uri.split('/').pop() || 'photo.jpg';
    const ext = filename.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heic',
    };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    if (Platform.OS === 'web') {
      // Web: fetch blob URI → real Blob/File → FormData
      const blobRes = await fetch(uri);
      const blob = await blobRes.blob();
      const file = new File([blob], `photo.${ext}`, { type: blob.type || mimeType });
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/api/upload-image?category=services`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(`Upload failed ${res.status}`);
      return (await res.json()).url;
    }

    // Native iOS/Android: pattern RN FormData officiel
    const form = new FormData();
    form.append('file', { uri, name: `photo.${ext}`, type: mimeType } as any);
    const res = await fetch(`${BASE_URL}/api/upload-image?category=services`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Upload failed ${res.status}`);
    const data = await res.json();
    return data.url;
  };

  const pickImages = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', 'Accès à la galerie nécessaire'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true,
      quality: 0.9, selectionLimit: 5 - images.length,
    });
    if (result.canceled || !result.assets?.length) return;
    const MAX_SIZE = 5 * 1024 * 1024;
    const oversized = result.assets.filter(a => a.fileSize && a.fileSize > MAX_SIZE);
    if (oversized.length > 0) {
      Alert.alert('Fichier trop volumineux', `${oversized.length} image(s) dépassent 5 Mo et ont été ignorées.`);
    }
    const valid = result.assets.filter(a => !a.fileSize || a.fileSize <= MAX_SIZE);
    if (!valid.length) return;
    // Stocker les URI locales — l'upload R2 se fera au clic "Sauvegarder"
    const localUris = valid.map(a => a.uri);
    setImages(prev => [...prev, ...localUris].slice(0, 5));
  };

  // Step 2 - Tags
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [allTagsMap, setAllTagsMap] = useState<Record<string, { label_fr: string; label_en?: string; category_id: string }>>({});
  const selectedTagLabels = selectedTagIds.map(id => allTagsMap[id]?.label_fr).filter(Boolean);

  // Step 3 - Configuration
  const [price, setPrice] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [maxParticipants, setMaxParticipants] = useState(1);
  const [slots, setSlots] = useState<DaySlot[]>([]);

  // Booking workflow configuration
  const [bookingApprovalMode, setBookingApprovalMode] = useState<'manual_approval' | 'instant_booking'>(
    enableManualApproval ? 'manual_approval' : 'instant_booking'
  );
  const [allowPayLater, setAllowPayLater] = useState(enablePayLater);
  const [payLaterExpirationMinutes, setPayLaterExpirationMinutes] = useState(60);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'coach' && user.role !== 'admin') {
      Alert.alert('', 'Rôle Coach requis pour créer un service');
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/profile' as any);
      }, 100);
    }
  }, [user]);

  // ─── Load existing service for edit mode ───────────────────────────────────
  useEffect(() => {
    if (isEditMode && serviceId) loadServiceForEdit();
  }, [serviceId]);

  const loadServiceForEdit = async () => {
    try {
      const data = await api.get(`/services/${serviceId}`);
      // ─── Vérification de la propriété ─────────────────────────────────────
      if (data.coach_id && user?.user_id && data.coach_id !== user.user_id && (user as any)?.role !== 'admin') {
        Alert.alert('Accès refusé', 'Vous ne pouvez modifier que vos propres services.');
        setTimeout(() => {
          if (router.canGoBack()) router.back();
          else router.replace('/(tabs)/profile' as any);
        }, 100);
        return;
      }
      setTitle(data.title || '');
      setCoachDesc(data.description || '');
      setPrice(String(data.price || ''));
      setDurationMin(data.duration_min || 60);
      setMaxParticipants(data.max_participants || 1);
      // Photos existantes
      const rawImages = data.images;
      setImages(
        Array.isArray(rawImages) ? rawImages
          : typeof rawImages === 'string' ? (() => { try { return JSON.parse(rawImages); } catch { return []; } })()
          : []
      );
      const parsedTags = Array.isArray(data.tag_ids) ? data.tag_ids
        : typeof data.tag_ids === 'string' ? (() => { try { return JSON.parse(data.tag_ids); } catch { return []; } })()
        : [];
      setSelectedTagIds(parsedTags);
      // Address from first location (use original_description for edit to avoid overwriting with masked value)
      const firstLoc = (data.locations || [])[0];
      if (firstLoc) {
        setAddress(firstLoc.original_description || firstLoc.description || '');
        setAddressLat(firstLoc.latitude ?? null);
        setAddressLng(firstLoc.longitude ?? null);
        if (firstLoc.precision) setPrecision(firstLoc.precision);
      }
      // Slots → DaySlot format
      const apiSlots: any[] = data.slots || [];
      const daySlots: DaySlot[] = apiSlots
        .filter((s: any) => s.slot_date && s.start_time)
        .map((s: any) => ({
          id: s.slot_id || `slot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          date: s.slot_date,
          startTime: s.start_time,
          endTime: s.end_time || null,
        }));
      setSlots(daySlots);
      // Booking workflow config
      if (data.booking_approval_mode != null) setBookingApprovalMode(data.booking_approval_mode);
      if (typeof data.allow_pay_later === 'boolean') setAllowPayLater(data.allow_pay_later);
      if (data.pay_later_expiration_minutes != null) setPayLaterExpirationMinutes(data.pay_later_expiration_minutes);
    } catch (err: any) {
      Alert.alert('Erreur', 'Impossible de charger le service');
      router.back();
    } finally {
      setLoadingEdit(false);
    }
  };

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });

  const goNext = () => {
    if (step === 1) {
      if (title.trim().length < 5) { Alert.alert('', 'Le titre doit avoir au moins 5 caractères'); return; }
      if (!coachDesc.trim()) { Alert.alert('', 'La description du coach est requise'); return; }
    }
    if (step === 2) {
      if (!address.trim()) { Alert.alert('Adresse requise', 'Veuillez renseigner l\'adresse de votre service'); return; }
    }
    if (step === 3) {
      if (selectedTagIds.length === 0) { Alert.alert('Tags requis', 'Veuillez sélectionner au moins un tag pour catégoriser votre service.'); return; }
    }
    if (step === 4) {
      const p = parseFloat(price);
      if (!price || isNaN(p) || p <= 0) { Alert.alert('Prix manquant', 'Renseignez le prix par séance'); return; }
    }
    // MVP : sauter l'étape 5 (réservations) si les deux fonctionnalités sont désactivées
    if (step === 4 && skipStep4) {
      setStep(6);
    } else {
      setStep(s => Math.min(s + 1, 6));
    }
    scrollTop();
  };

  const goPrev = () => {
    // MVP : sauter l'étape 5 en retour également
    if (step === 6 && skipStep4) {
      setStep(4);
    } else {
      setStep(s => Math.max(s - 1, 1));
    }
    scrollTop();
  };

  // ─── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      // Upload des images locales (pas encore sur R2) → se fait uniquement au "Sauvegarder"
      const isLocalUri = (uri: string) => !uri.startsWith('http') && !uri.startsWith('data:');
      const finalImages: string[] = [];
      for (const img of images) {
        if (isLocalUri(img)) {
          const r2Url = await uploadImage(img);
          finalImages.push(r2Url);
        } else {
          finalImages.push(img); // URL R2/CDN déjà valide
        }
      }

      const priceNum = parseFloat(price) || 0;
      const payload = {
        title: title.trim(),
        description: coachDesc.trim() || null,
        address: address.trim() || null,
        price: priceNum,
        duration_min: durationMin,
        max_participants: maxParticipants,
        tag_ids: selectedTagIds,
        images: finalImages,
        booking_approval_mode: bookingApprovalMode,
        allow_pay_later: allowPayLater,
        pay_later_expiration_minutes: allowPayLater ? payLaterExpirationMinutes : null,
        packages: [{
          type_id: 'main',
          type_label: 'Service principal',
          duration_min: durationMin,
          max_participants: maxParticipants,
          price: priceNum,
          slots: slots.map(s => ({
            slot_date: s.date,
            start_time: s.startTime,
            end_time: s.endTime,
          })),
        }],
        locations: addressLat !== null && addressLng !== null ? [{
          latitude: addressLat, longitude: addressLng,
          precision: precision, description: address || null,
        }] : [],
        slots: [],
      };
      if (isEditMode) {
        const editSlots = slots.map(s => ({
          slot_type: 'single',
          slot_date: s.date,
          start_time: s.startTime,
          end_time: s.endTime || '00:00',
          location_index: 0,
        }));
        const editPayload = { ...payload, slots: editSlots };
        await api.put(`/services/${serviceId}`, editPayload);
        router.replace(`/service/${serviceId}` as any);
      } else {
        const created = await api.post('/services', payload);
        router.replace(`/service/${created.service_id ?? created.id}` as any);
      }
    } catch (err: any) {
      Alert.alert('Erreur', err.message || (isEditMode ? 'Impossible de mettre à jour le service' : 'Impossible de créer le service'));
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Step Header ─────────────────────────────────────────────────────────────
  const renderStepHeader = () => {
    // En mode MVP (skipStep4), n'afficher que 4 étapes : Infos, Domaine, Config, Résumé
    const visibleLabels = skipStep4
      ? STEP_LABELS.filter((_, idx) => idx !== 4)  // retirer 'Réservations'
      : STEP_LABELS;
    // Mapper l'étape interne vers la position visuelle
    const visualStep = skipStep4 && step >= 6 ? step - 1 : step;

    return (
      <View style={s.stepHeader}>
        {visibleLabels.map((label, idx) => {
          const num = idx + 1;
          const done = visualStep > num;
          const active = visualStep === num;
          return (
            <React.Fragment key={num}>
              {idx > 0 && <View style={[s.stepLine, done && s.stepLineDone]} />}
              <View style={s.stepItem}>
                <View style={[s.stepCircle, active && s.stepCircleActive, done && s.stepCircleDone]}>
                  {done
                    ? <Ionicons name="checkmark" size={13} color={Colors.background} />
                    : <Text style={[s.stepNum, active && s.stepNumActive]}>{num}</Text>}
                </View>
                <Text style={[s.stepLabel, active && s.stepLabelActive]}>{label}</Text>
              </View>
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  // ─── Step 1: Informations générales ──────────────────────────────────────────
  const renderStep1 = () => (
    <View style={s.stepContent}>
      <View style={s.motiveBanner}>
        <Ionicons name="trophy" size={18} color={ORANGE} />
        <Text style={s.motiveText}>
          Les services avec une belle description reçoivent <Text style={{ fontWeight: '800' }}>3× plus</Text> de réservations !
        </Text>
      </View>

      <View style={s.field}>
        <Text style={s.fieldLabel}>Titre du service *</Text>
        <TextInput
          style={s.input} value={title} onChangeText={setTitle}
          placeholder="Ex : Coaching football — Du débutant au joueur confirmé"
          placeholderTextColor={Colors.muted}
          testID="service-title-input"
        />
      </View>

      <View style={s.field}>
        <Text style={s.fieldLabel}>Votre description de coach *</Text>
        <TextInput
          style={[s.input, s.inputMulti]}
          value={coachDesc} onChangeText={setCoachDesc}
          placeholder="Parlez de votre parcours, vos certifications, votre méthode d'entraînement…"
          placeholderTextColor={Colors.muted}
          multiline numberOfLines={5}
          textAlignVertical="top"
          testID="service-desc-input"
        />
        {coachDesc.length > 0 && (
          <Text style={[s.charCount, coachDesc.length >= 50 ? s.charCountGood : s.charCountWarn]}>
            {coachDesc.length} car.{coachDesc.length >= 50 ? '  ✓ Très bien !' : '  (50+ recommandé)'}
          </Text>
        )}
      </View>

      {/* ── Photos du service (même design que SpotYou) ── */}
      <View style={s.field}>
        <View style={s.rowBetween}>
          <Text style={s.fieldLabel}>Photos du service</Text>
          <Text style={s.fieldHint}>{images.length}/5</Text>
        </View>
        <View style={s.photoGrid}>
          {images.map((uri, i) => (
            <View key={i} style={s.photoThumb}>
              <Image source={{ uri }} style={s.photoThumbImg} />
              <TouchableOpacity
                style={s.photoRemoveBtn}
                onPress={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                testID={`remove-photo-${i}`}
              >
                <Ionicons name="close-circle" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {images.length < 5 && (
            <TouchableOpacity
              style={[s.photoAddBtn, uploadingImages && { opacity: 0.6 }]}
              onPress={pickImages}
              disabled={uploadingImages}
              testID="add-photos-btn"
            >
              {uploadingImages
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <>
                    <Ionicons name="camera-outline" size={24} color={Colors.primary} />
                    <Text style={s.photoAddBtnText}>Ajouter</Text>
                  </>
              }
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );

  // ─── Step 2: Domaine & Tags ───────────────────────────────────────────────────
  const renderStep2 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Domaine & Tags</Text>
      <Text style={s.stepHint}>Catégorisez votre service pour être trouvé par les bons clients</Text>

      <TagPickerField
        entityType="service"
        showDomains
        selectedTagIds={selectedTagIds}
        onChangeTagIds={setSelectedTagIds}
        onTagsLoaded={(tags) => setAllTagsMap(prev => ({ ...prev, ...Object.fromEntries(tags.map(t => [t.tag_id, t])) }))}
        accentColor={ORANGE}
        label="Tags"
        hint="Les tags permettent à votre service d'apparaître dans les recherches filtrées"
      />
    </View>
  );

  // ─── Step 3: Configuration ────────────────────────────────────────────────────
  const renderStep3 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Configuration</Text>
      <Text style={s.stepHint}>Définissez les modalités pratiques de votre service</Text>

      <View style={s.configCard}>
        {/* Prix */}
        <View style={s.field}>
          <Text style={s.fieldLabel}>Prix (€) par séance *</Text>
          <TextInput
            style={s.input}
            value={price}
            onChangeText={setPrice}
            placeholder="Ex: 60"
            placeholderTextColor={Colors.muted}
            keyboardType="decimal-pad"
            testID="service-price-input"
          />
          {price && !isNaN(parseFloat(price)) && parseFloat(price) > 0 && hasCommissionRule && receiverPct > 0 && (
            <Text style={s.netEarning}>
              Commission {receiverPct} % · Gain net : <Text style={{ fontWeight: '700', color: GREEN }}>{(parseFloat(price) * (1 - receiverPct / 100)).toFixed(2)} €</Text>
            </Text>
          )}
        </View>

        {/* Durée */}
        <View style={s.field}>
          <Text style={s.fieldLabel}>Durée par séance</Text>
          <View style={s.chips}>
            {DURATIONS.map(d => (
              <TouchableOpacity
                key={d}
                style={[s.chip, durationMin === d && s.chipActive]}
                onPress={() => setDurationMin(d)}
                testID={`duration-${d}`}
              >
                <Text style={[s.chipText, durationMin === d && s.chipTextActive]}>{d} min</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Participants max */}
        <View style={s.field}>
          <Text style={s.fieldLabel}>Participants maximum</Text>
          <View style={s.stepperRow}>
            <TouchableOpacity
              style={s.stepperBtn}
              onPress={() => setMaxParticipants(p => Math.max(1, p - 1))}
              testID="max-dec"
            >
              <Ionicons name="remove" size={18} color={Colors.foreground} />
            </TouchableOpacity>
            <Text style={s.stepperVal}>{maxParticipants}</Text>
            <TouchableOpacity
              style={s.stepperBtn}
              onPress={() => setMaxParticipants(p => Math.min(100, p + 1))}
              testID="max-inc"
            >
              <Ionicons name="add" size={18} color={Colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Calendrier */}
        <View style={s.field}>
          <Text style={s.fieldLabel}>Créneaux horaires</Text>
          <WeekCalendar
            slots={slots}
            durationMin={durationMin}
            onSlotsChange={setSlots}
          />
        </View>
      </View>
    </View>
  );

  // ─── Step 4: Réservations ─────────────────────────────────────────────────────
  const renderStep4 = () => {
    const impact = getImpactInfo(bookingApprovalMode, allowPayLater, payLaterExpirationMinutes);
    return (
      <View style={s.stepContent}>
        <Text style={s.stepTitle}>Réservations</Text>
        <Text style={s.stepHint}>Configurez le comportement des réservations de votre service</Text>

        <View style={s.bookingSection}>
          <View style={s.bookingSectionHeader}>
            <Ionicons name="settings-outline" size={18} color={Colors.foreground} />
            <Text style={s.bookingSectionTitle}>Configuration des réservations</Text>
          </View>

          {/* 1. Mode de réservation — masqué si validation manuelle désactivée */}
          {enableManualApproval && (
            <View style={s.field}>
              <Text style={s.fieldLabel}>Mode de réservation</Text>
              <View style={s.bookingOptionRow}>
                <TouchableOpacity
                  style={[s.bookingOptionCard, bookingApprovalMode === 'instant_booking' && s.bookingOptionCardActive]}
                  onPress={() => setBookingApprovalMode('instant_booking')}
                  testID="booking-mode-instant"
                >
                  <View style={s.bookingOptionTop}>
                    <View style={[s.bookingRadio, bookingApprovalMode === 'instant_booking' && s.bookingRadioActive]}>
                      {bookingApprovalMode === 'instant_booking' && <View style={s.bookingRadioDot} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.bookingOptionLabel, bookingApprovalMode === 'instant_booking' && s.bookingOptionLabelActive]}>
                        Réservation directe
                      </Text>
                      <Text style={s.bookingOptionDesc}>
                        Le créneau est bloqué dès la réservation
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.bookingOptionCard, bookingApprovalMode === 'manual_approval' && s.bookingOptionCardActive]}
                  onPress={() => setBookingApprovalMode('manual_approval')}
                  testID="booking-mode-manual"
                >
                  <View style={s.bookingOptionTop}>
                    <View style={[s.bookingRadio, bookingApprovalMode === 'manual_approval' && s.bookingRadioActive]}>
                      {bookingApprovalMode === 'manual_approval' && <View style={s.bookingRadioDot} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.bookingOptionLabel, bookingApprovalMode === 'manual_approval' && s.bookingOptionLabelActive]}>
                        Validation manuelle
                      </Text>
                      <Text style={s.bookingOptionDesc}>
                        Vous acceptez ou refusez chaque demande
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 2. Paiement différé — masqué si désactivé globalement */}
          {enablePayLater && (
            <View style={s.field}>
              <Text style={s.fieldLabel}>Paiement</Text>
              <View style={s.bookingOptionRow}>
                <TouchableOpacity
                  style={[s.bookingOptionCard, !allowPayLater && s.bookingOptionCardActive]}
                  onPress={() => setAllowPayLater(false)}
                  testID="pay-mode-now"
                >
                  <View style={s.bookingOptionTop}>
                    <View style={[s.bookingRadio, !allowPayLater && s.bookingRadioActive]}>
                      {!allowPayLater && <View style={s.bookingRadioDot} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.bookingOptionLabel, !allowPayLater && s.bookingOptionLabelActive]}>
                        Paiement immédiat
                      </Text>
                      <Text style={s.bookingOptionDesc}>
                        L'utilisateur paie pour confirmer
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[s.bookingOptionCard, allowPayLater && s.bookingOptionCardActive]}
                  onPress={() => setAllowPayLater(true)}
                  testID="pay-mode-later"
                >
                  <View style={s.bookingOptionTop}>
                    <View style={[s.bookingRadio, allowPayLater && s.bookingRadioActive]}>
                      {allowPayLater && <View style={s.bookingRadioDot} />}
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[s.bookingOptionLabel, allowPayLater && s.bookingOptionLabelActive]}>
                        Payer plus tard autorisé
                      </Text>
                      <Text style={s.bookingOptionDesc}>
                        Le créneau est bloqué sans paiement immédiat
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* 3. Délai d'expiration (seulement si pay_later activé) */}
          {enablePayLater && allowPayLater && (
            <View style={s.field}>
              <Text style={s.fieldLabel}>Délai de paiement</Text>
              <View style={s.chips}>
                {EXPIRY_OPTIONS.map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[s.chip, payLaterExpirationMinutes === opt.value && s.chipActive]}
                    onPress={() => setPayLaterExpirationMinutes(opt.value)}
                    testID={`expiry-${opt.value}`}
                  >
                    <Text style={[s.chipText, payLaterExpirationMinutes === opt.value && s.chipTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.warningBox}>
                <Ionicons name="warning-outline" size={15} color={AMBER} style={{ marginTop: 1 }} />
                <Text style={s.warningText}>
                  Pendant ce délai, le créneau sera indisponible pour les autres utilisateurs jusqu'au paiement ou à l'expiration.
                </Text>
              </View>
            </View>
          )}

          {/* 4. Impact dynamique */}
          <View style={[s.impactBox, { borderColor: impact.color + '40', backgroundColor: impact.color + '0D' }]}>
            <View style={s.impactHeader}>
              <Ionicons name={impact.icon} size={16} color={impact.color} />
              <Text style={[s.impactTitle, { color: impact.color }]}>Impact de votre configuration</Text>
            </View>
            <View style={[s.impactBadge, { backgroundColor: impact.color + '18', borderColor: impact.color + '50' }]}>
              <Text style={[s.impactBadgeText, { color: impact.color }]}>{impact.badge}</Text>
            </View>
            <Text style={s.impactText}>{impact.text}</Text>
          </View>
        </View>
      </View>
    );
  };

  // ─── Step 5: Résumé & Score ───────────────────────────────────────────────────
  const { score, criteria } = useMemo(
    () => computeScore(title, coachDesc, address, selectedTagIds, price, slots, images),
    [title, coachDesc, address, selectedTagIds, price, slots, images]
  );
  const scoreColor = score >= 80 ? GREEN : score >= 50 ? ORANGE : Colors.destructive;

  const renderStep5 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Résumé & Publication</Text>

      {/* Score */}
      <View style={[s.scoreCard, { borderColor: scoreColor + '40' }]}>
        <View style={s.scoreHeader}>
          <View style={[s.scoreBadge, { backgroundColor: scoreColor }]}>
            <Text style={s.scoreBadgeText}>{score}</Text>
            <Text style={s.scoreBadgeSub}>/100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.scoreTitle, { color: scoreColor }]}>
              {score === 100 ? 'Service parfait !' : score >= 80 ? 'Très bon service !' : score >= 50 ? 'Service correct' : 'Complétez votre service'}
            </Text>
            <Text style={s.scoreSubtitle}>Score de complétude</Text>
          </View>
        </View>
        {criteria.map((c, i) => (
          <View key={i} style={s.criterionRow}>
            <Ionicons name={c.ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={c.ok ? GREEN : Colors.muted} />
            <Text style={[s.criterionText, !c.ok && { color: Colors.muted }]}>{c.label}</Text>
            <Text style={[s.criterionPts, c.ok && { color: GREEN }]}>+{c.pts}pts</Text>
          </View>
        ))}
      </View>

      {/* Service summary */}
      <View style={s.summaryCard}>
        <Text style={s.summaryTitle}>{title}</Text>
        {coachDesc.length > 0 && <Text style={s.summaryDesc} numberOfLines={3}>{coachDesc}</Text>}
        {address.length > 0 && (
          <View style={s.summaryRow}>
            <Ionicons name="location-outline" size={14} color={ORANGE} />
            <Text style={s.summaryMeta}>{address}</Text>
          </View>
        )}
        {selectedTagIds.length > 0 && (
          <View style={s.summaryRow}>
            <Ionicons name="pricetag-outline" size={14} color={ORANGE} />
            <Text style={s.summaryMeta}>
              {selectedTagLabels.slice(0, 3).join(', ')}{selectedTagIds.length > 3 ? ` +${selectedTagIds.length - 3}` : ''}
            </Text>
          </View>
        )}
        <View style={s.summaryStatsRow}>
          {price ? <View style={s.statChip}><Text style={s.statChipText}>{price} €/séance</Text></View> : null}
          <View style={s.statChip}><Text style={s.statChipText}>{durationMin} min</Text></View>
          <View style={s.statChip}><Text style={s.statChipText}>{maxParticipants} pers. max</Text></View>
          <View style={s.statChip}><Text style={s.statChipText}>{slots.length} créneau{slots.length !== 1 ? 'x' : ''}</Text></View>
        </View>

        {/* Workflow résumé — seulement si au moins une option avancée est configurable */}
        {(enableManualApproval || enablePayLater) && (() => {
          const info = getImpactInfo(bookingApprovalMode, allowPayLater, payLaterExpirationMinutes);
          return (
            <View style={[s.summaryWorkflow, { borderColor: info.color + '40', backgroundColor: info.color + '0D' }]}>
              <View style={s.summaryWorkflowRow}>
                <Ionicons name={info.icon} size={14} color={info.color} />
                <Text style={[s.summaryWorkflowText, { color: info.color }]}>{info.badge}</Text>
              </View>
            </View>
          );
        })()}
      </View>
    </View>
  );

  // ─── Tag Modal ────────────────────────────────────────────────────────────────
  // ─── Main Render ──────────────────────────────────────────────────────────────
  if (loadingEdit) {
    return (
      <SafeAreaView style={[s.safe, { alignItems: 'center', justifyContent: 'center' }]} edges={['top', 'bottom']}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ color: Colors.muted, marginTop: 12, fontSize: 14 }}>Chargement du service...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBackBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>{isEditMode ? 'Modifier le service' : 'Créer un service'}</Text>
        <View style={{ width: 40 }} />
      </View>

      {renderStepHeader()}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 1 && renderStep1()}
          {step === 2 && (
            <View style={{ paddingHorizontal: 16 }}>
              <StepLocalisation
                selectedLat={addressLat || 48.8566}
                selectedLng={addressLng || 2.3522}
                locationAddress={address || 'Appuyez pour choisir une adresse'}
                precision={precision}
                setPrecision={setPrecision}
                precisionRadius={precisionRadius}
                onOpenLocation={() => setShowLocPicker(true)}
                accentColor={ORANGE}
                showPrecision={true}
              />
            </View>
          )}
          {step === 3 && renderStep2()}
          {step === 4 && renderStep3()}
          {step === 5 && renderStep4()}
          {step === 6 && renderStep5()}
        </ScrollView>

        {/* Bottom navigation */}
        <View style={s.bottomNav}>
          {step > 1 ? (
            <TouchableOpacity style={s.prevBtn} onPress={goPrev} testID="prev-step-btn">
              <Ionicons name="chevron-back" size={18} color={Colors.foreground} />
              <Text style={s.prevBtnText}>Précédent</Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}

          {step < 6 ? (
            <TouchableOpacity style={s.nextBtn} onPress={goNext} testID="next-step-btn">
              <Text style={s.nextBtnText}>{step === 5 ? 'Voir le résumé' : 'Suivant'}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.background} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.nextBtn, s.publishBtn, submitting && s.disabledBtn]}
              onPress={handleSubmit}
              disabled={submitting}
              testID="create-service-submit-btn"
            >
              {submitting
                ? <ActivityIndicator color={Colors.background} />
                : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name={isEditMode ? 'save-outline' : 'rocket-outline'} size={18} color={Colors.background} />
                    <Text style={s.nextBtnText}>{isEditMode ? 'Sauvegarder' : 'Publier mon service'}</Text>
                  </View>
                )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Location picker */}
      <LocationPicker
        visible={showLocPicker}
        onClose={() => setShowLocPicker(false)}
        onSelect={(lat, lng, addr) => {
          setAddressLat(lat);
          setAddressLng(lng);
          setAddress(addr);
          setShowLocPicker(false);
        }}
      />
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
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  // Photo grid (même design que SpotYou)
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  photoThumb: { width: 80, height: 80, borderRadius: Radius.md, overflow: 'hidden', position: 'relative' },
  photoThumbImg: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoRemoveBtn: { position: 'absolute', top: 3, right: 3 },
  photoAddBtn: {
    width: 80, height: 80, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.primary, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: Colors.card,
  },
  photoAddBtnText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  fieldHint: { fontSize: 12, color: Colors.muted },
  // Stepper
  stepHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: Spacing.xs,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepLine: { width: 24, height: 2, backgroundColor: Colors.border, marginBottom: 16 },
  stepLineDone: { backgroundColor: ORANGE },
  stepCircle: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  stepCircleActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  stepCircleDone: { borderColor: ORANGE, backgroundColor: ORANGE },
  stepNum: { fontSize: 12, fontWeight: '700', color: Colors.muted },
  stepNumActive: { color: ORANGE },
  stepLabel: { fontSize: 9, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  stepLabelActive: { color: ORANGE },
  // Layout
  scrollContent: { paddingBottom: 20 },
  stepContent: { padding: Spacing.md, gap: 16 },
  stepTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  stepHint: { fontSize: 13, color: Colors.muted, marginTop: -8 },
  field: { gap: 6 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: Colors.foreground,
  },
  inputMulti: { minHeight: 120 },
  charCount: { fontSize: 11, textAlign: 'right', marginTop: 2 },
  charCountGood: { color: GREEN },
  charCountWarn: { color: Colors.muted },
  motiveBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: ORANGE_LIGHT, borderRadius: Radius.lg, padding: 14,
    borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  motiveText: { fontSize: 13, color: Colors.foreground, flex: 1, lineHeight: 19 },
  // Address
  addressBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: Radius.md, padding: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  addressBtnFilled: { borderColor: Colors.primary + '60' },
  addressBtnText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  // Domain + Tags
  domainPill: {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: Radius.full,
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border,
  },
  domainPillText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  tagTrigger: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card,
    borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  tagPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1,
  },
  tagPillText: { fontSize: 12, fontWeight: '600' },
  fieldTip: { fontSize: 12, color: Colors.muted, fontStyle: 'italic', marginTop: 2 },
  // Config card
  configCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, gap: 16,
  },
  chips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  chipTextActive: { color: ORANGE },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 20, paddingTop: 4 },
  stepperBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.background,
    borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  stepperVal: { fontSize: 22, fontWeight: '800', color: Colors.foreground, minWidth: 36, textAlign: 'center' },
  netEarning: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  // Step 4 - score
  scoreCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, gap: 10,
  },
  scoreHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 6 },
  scoreBadge: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  scoreBadgeText: { fontSize: 22, fontWeight: '800', color: '#fff' },
  scoreBadgeSub: { fontSize: 9, color: 'rgba(255,255,255,0.75)', fontWeight: '700' },
  scoreTitle: { fontSize: 16, fontWeight: '800' },
  scoreSubtitle: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  criterionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  criterionText: { flex: 1, fontSize: 13, color: Colors.foreground },
  criterionPts: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  summaryCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: ORANGE_BORDER, gap: 10,
  },
  summaryTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  summaryDesc: { fontSize: 13, color: Colors.muted, lineHeight: 19 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryMeta: { fontSize: 13, color: Colors.muted },
  summaryStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  statChip: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  statChipText: { fontSize: 12, fontWeight: '600', color: Colors.foreground },
  // Bottom nav
  bottomNav: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  prevBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  prevBtnText: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  nextBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: Radius.full, backgroundColor: ORANGE,
  },
  publishBtn: { backgroundColor: GREEN },
  disabledBtn: { opacity: 0.4 },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  // Tag modal
  tagModalOverlay: { flex: 1, justifyContent: 'flex-end' },
  tagModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  tagModalSheet: {
    backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    height: SH * 0.82, overflow: 'hidden',
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 8 },
  tagModalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tagModalTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  modalCancel: { fontSize: 15, color: Colors.muted },
  selectedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 8,
    backgroundColor: Colors.primary + '15', borderBottomWidth: 1, borderBottomColor: Colors.primary + '30',
  },
  selectedBannerText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  clearText: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },
  catGroup: { marginBottom: 16 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 0.5 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full,
    backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border,
  },
  tagChipText: { fontSize: 13, fontWeight: '500', color: Colors.muted },
  // ── Booking workflow config ──────────────────────────────────────────────────
  bookingSection: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, gap: 18,
  },
  bookingSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  bookingSectionTitle: {
    fontSize: 15, fontWeight: '800', color: Colors.foreground,
  },
  bookingOptionRow: { flexDirection: 'row', gap: 10 },
  bookingOptionCard: {
    flex: 1, borderRadius: Radius.lg, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.background, padding: 12,
  },
  bookingOptionCardActive: {
    borderColor: ORANGE, backgroundColor: ORANGE_LIGHT,
  },
  bookingOptionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bookingRadio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
    marginTop: 1, flexShrink: 0,
  },
  bookingRadioActive: { borderColor: ORANGE },
  bookingRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ORANGE },
  bookingOptionLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground, lineHeight: 18 },
  bookingOptionLabelActive: { color: ORANGE },
  bookingOptionDesc: { fontSize: 11, color: Colors.muted, lineHeight: 16 },
  // Warning box
  warningBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: AMBER_LIGHT, borderRadius: Radius.md,
    borderWidth: 1, borderColor: AMBER + '50',
    padding: 10, marginTop: 6,
  },
  warningText: { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },
  // Impact box
  impactBox: {
    borderRadius: Radius.lg, borderWidth: 1, padding: 14, gap: 10,
  },
  impactHeader: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  impactTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  impactBadge: {
    alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1,
  },
  impactBadgeText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
  impactText: { fontSize: 13, color: Colors.foreground, lineHeight: 20 },
  // Summary workflow
  summaryWorkflow: {
    borderRadius: Radius.md, borderWidth: 1, padding: 10, marginTop: 2,
  },
  summaryWorkflowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  summaryWorkflowText: { fontSize: 12, fontWeight: '700', flex: 1, lineHeight: 17 },
});
