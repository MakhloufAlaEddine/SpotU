import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, TextInput, Image, Modal,
  Animated, Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { MapViewComponent } from '../../components/MapViewComponent';
import { LocationPicker } from '../../components/LocationPicker';
import { DateTimePickerModal } from '../../components/DateTimePicker';
import { RichTextInput, MarkdownText } from '../../components/RichTextInput';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const { width: SW, height: SH } = Dimensions.get('window');

// ─── Constants ─────────────────────────────────────────────────────────────────
const PRECISION_OPTIONS = [
  { value: 'exact', label: 'Lieu exact', desc: 'Adresse précise visible', icon: 'locate' as const },
  { value: '100m', label: '~100m', desc: 'Zone approximative', icon: 'radio-button-on' as const },
  { value: '1000m', label: '~1km', desc: 'Quartier seulement', icon: 'radio-button-off' as const },
];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const CATEGORY_COLORS: Record<string, string> = {
  cat_running: '#00BFA5', cat_football: '#4CAF50', cat_basketball: '#FF9800',
  cat_tennis: '#E91E63', cat_yoga: '#9C27B0', cat_cycling: '#2196F3',
  cat_fitness: '#F44336', cat_swimming: '#00BCD4', cat_boxing: '#FF5722',
  cat_hiking: '#8BC34A', cat_volleyball: '#FF9500', cat_martial: '#FF5722',
};
const tagColor = (cat?: string) => (cat && CATEGORY_COLORS[cat]) ? CATEGORY_COLORS[cat] : Colors.primary;

const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ─── Steps config ───────────────────────────────────────────────────────────────
const STEPS = [
  {
    id: 1, title: "L'essentiel",
    subtitle: 'Photos & Titre',
    icon: 'camera-outline' as const,
    tip: 'Les tagPoints avec une belle photo et un titre accrocheur reçoivent jusqu\'à 3× plus de participations.',
    tipIcon: 'bulb-outline' as const,
  },
  {
    id: 2, title: 'Le contenu',
    subtitle: 'Description, Domaine & Tags',
    icon: 'document-text-outline' as const,
    tip: 'Une description détaillée (niveau requis, équipement, ambiance) rassure les participants et filtre les bons profils.',
    tipIcon: 'chatbubble-ellipses-outline' as const,
  },
  {
    id: 3, title: 'La localisation',
    subtitle: 'Où ça se passe ?',
    icon: 'map-outline' as const,
    tip: 'Choisissez la précision adaptée : partagez le lieu exact pour les activités publiques, ou restez discret avec une zone approximative.',
    tipIcon: 'shield-checkmark-outline' as const,
  },
  {
    id: 4, title: 'La date',
    subtitle: 'Quand ça commence ?',
    icon: 'calendar-outline' as const,
    tip: 'Les tagPoints avec une date apparaissent en priorité dans les résultats. Configurez une récurrence pour fidéliser vos participants.',
    tipIcon: 'trending-up-outline' as const,
  },
];

// ─── Quality score ──────────────────────────────────────────────────────────────
function calcQuality(form: any): { score: number; label: string; color: string } {
  let s = 0;
  if (form.images?.length >= 1) s += 20;
  if (form.images?.length >= 3) s += 10;
  if (form.title?.trim().length >= 10) s += 15;
  if (form.title?.trim().length >= 25) s += 5;
  if (form.description?.trim().length >= 30) s += 10;
  if (form.description?.trim().length >= 100) s += 5;
  if (form.selectedTagIds?.length >= 1) s += 10;
  if (form.selectedTagIds?.length >= 3) s += 5;
  if (form.scheduleType !== 'none') s += 15;
  s = Math.min(s, 100);
  if (s < 35) return { score: s, label: 'Basique', color: Colors.muted };
  if (s < 65) return { score: s, label: 'Bien', color: '#FF9800' };
  if (s < 85) return { score: s, label: 'Très bien', color: Colors.primary };
  return { score: s, label: 'Excellent !', color: '#4CAF50' };
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function CreateTagPointScreen() {
  const router = useRouter();
  const { user, token } = useAuth();
  const { lang } = useLang();

  // Step state
  const [step, setStep] = useState(0); // 0-3 = steps, 4 = preview
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [precision, setPrecision] = useState('exact');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [domainId, setDomainId] = useState('dom_sport');
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const uploadBarAnim = useRef(new Animated.Value(0)).current;

  // Location
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);
  const [locationAddress, setLocationAddress] = useState('Paris, France');
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Schedule
  const [scheduleType, setScheduleType] = useState<'none' | 'once' | 'recurring'>('none');
  const [eventDateTime, setEventDateTime] = useState<Date | null>(null);
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  // recurringSchedule: day index → array of times (per-day schedule)
  const [recurringSchedule, setRecurringSchedule] = useState<Record<number, Date[]>>({});
  const [editingDayIdx, setEditingDayIdx] = useState<number | null>(null);
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null);
  // Full preview modal (at root level to avoid ScrollView clipping)
  const [showFullPreview, setShowFullPreview] = useState(false);

  // Domain & Tag data
  const [domains, setDomains] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);

  const precisionRadius = precision === 'exact' ? 0 : precision === '100m' ? 100 : 1000;
  const quality = calcQuality({ images, title, description, selectedTagIds, scheduleType });
  const allTags = categories.flatMap(c => c.tags || []);
  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.tag_id));

  useEffect(() => { loadGPS(); loadDomains(); }, []);
  useEffect(() => { loadCategories(); setSelectedTagIds([]); }, [domainId]);

  useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: Math.min(step, 3) / 3,
      useNativeDriver: false,
      tension: 60, friction: 10,
    }).start();
  }, [step]);

  const loadDomains = async () => {
    try {
      const data: any[] = await api.get('/domains');
      // Put dom_sport first (default selection)
      data.sort((a, b) => (a.domain_id === 'dom_sport' ? -1 : b.domain_id === 'dom_sport' ? 1 : 0));
      setDomains(data);
    } catch {}
  };
  const loadCategories = async () => {
    try { setCategories(await api.get(`/tags/categories?domain_id=${domainId}`)); } catch {}
  };
  const loadGPS = async () => {
    try {
      const Loc = await import('expo-location');
      const { status } = await Loc.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Loc.getCurrentPositionAsync({ accuracy: Loc.Accuracy.Balanced });
        setSelectedLat(loc.coords.latitude); setSelectedLng(loc.coords.longitude);
        reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      }
    } catch {}
  };
  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const d = await r.json();
      const a = d.address || {};
      const parts = [a.road, a.house_number, a.postcode, a.city || a.town].filter(Boolean);
      setLocationAddress(parts.join(' ') || d.display_name?.split(',').slice(0, 2).join(',') || 'Paris, France');
    } catch {}
  };

  const pickImages = async () => {
    if (images.length >= 10) { Alert.alert('Maximum', '10 images maximum'); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission requise', 'Accès à la galerie requis'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images' as any, allowsMultipleSelection: true,
      quality: 0.8, selectionLimit: 10 - images.length,
    });
    if (!result.canceled) setImages(p => [...p, ...result.assets.map(a => a.uri)].slice(0, 10));
  };

  const resetForm = () => {
    Alert.alert(
      'Vider le formulaire',
      'Toutes les informations saisies seront perdues. Continuer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider', style: 'destructive',
          onPress: () => {
            setTitle(''); setDescription(''); setPrecision('exact');
            setSelectedTagIds([]); setImages([]); setStep(0);
            setScheduleType('none'); setEventDateTime(null);
            setRecurringSchedule({});
          },
        },
      ]
    );
  };

  const goNext = () => {
    if (step === 0 && !title.trim()) {
      Alert.alert('Titre requis', 'Ajoutez un titre pour continuer.');
      return;
    }
    if (step < 4) setStep(s => s + 1);
  };
  const goPrev = () => { if (step > 0) setStep(s => s - 1); };

  const handleSubmit = async () => {
    if (!title.trim()) { Alert.alert('Titre requis'); return; }
    if (scheduleType === 'once' && !eventDateTime) { Alert.alert('Date requise', 'Sélectionnez une date et heure.'); return; }
    if (scheduleType === 'recurring') {
      const days = Object.keys(recurringSchedule).map(Number);
      if (days.length === 0) { Alert.alert('Configuration incomplète', 'Sélectionnez au moins un jour.'); return; }
      if (days.some(d => recurringSchedule[d].length === 0)) { Alert.alert('Configuration incomplète', 'Chaque jour sélectionné doit avoir au moins un créneau.'); return; }
    }

    setSubmitting(true);
    try {
      // 1. Upload images sequentially to track progress
      const uploadedUrls: string[] = [];
      if (images.length > 0 && token) {
        setUploadProgress({ current: 0, total: images.length });
        Animated.timing(uploadBarAnim, { toValue: 0, duration: 0, useNativeDriver: false }).start();
        for (let i = 0; i < images.length; i++) {
          const url = await uploadImage(images[i], token);
          if (url) uploadedUrls.push(url);
          const progress = (i + 1) / images.length;
          setUploadProgress({ current: i + 1, total: images.length });
          Animated.timing(uploadBarAnim, { toValue: progress, duration: 250, useNativeDriver: false }).start();
        }
        setUploadProgress(null);
      }

      // 2. Build payload with real image URLs
      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        latitude: selectedLat, longitude: selectedLng,
        precision, domain_id: domainId,
        tag_ids: selectedTagIds,
        images: uploadedUrls,
      };
      if (scheduleType === 'once' && eventDateTime) payload.event_date = eventDateTime.toISOString();
      if (scheduleType === 'recurring' && Object.keys(recurringSchedule).length > 0)
        payload.event_schedule = {
          type: 'weekly',
          schedule: Object.fromEntries(
            Object.entries(recurringSchedule).map(([d, times]) => [d, times.map(fmtTime)])
          ),
        };

      const result = await api.post('/tag-points', payload);
      const newPointId = result.point_id;

      // 3. Show alert — use setTimeout to defer navigation until alert is fully dismissed
      Alert.alert('Publié !', 'Votre tagPoint est visible !', [
        { text: 'Voir', onPress: () => setTimeout(() => router.replace(`/tag-point/${newPointId}` as any), 100) },
        { text: 'Accueil', onPress: () => setTimeout(() => router.replace('/(tabs)/map' as any), 100) },
      ]);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le tagPoint');
    } finally {
      setSubmitting(false);
      setUploadProgress(null);
    }
  };

  const toggleTag = (id: string) =>
    setSelectedTagIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);

  // ─── Render steps ────────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 0: return <StepEssentiel images={images} title={title} setTitle={setTitle} onPickImages={pickImages} onRemoveImage={i => setImages(p => p.filter((_, idx) => idx !== i))} />;
      case 1: return (
        <StepContenu
          description={description} setDescription={setDescription}
          domainId={domainId} setDomainId={setDomainId} domains={domains}
          selectedTags={selectedTags} onOpenTags={() => setShowTagModal(true)}
          lang={lang}
        />
      );
      case 2: return (
        <StepLocalisation
          selectedLat={selectedLat} selectedLng={selectedLng}
          locationAddress={locationAddress}
          precision={precision} setPrecision={setPrecision}
          precisionRadius={precisionRadius}
          onOpenLocation={() => setShowLocationModal(true)}
        />
      );
      case 3: return (
        <StepDate
          scheduleType={scheduleType} setScheduleType={setScheduleType}
          eventDateTime={eventDateTime} onOpenDatePicker={() => setShowDateTimePicker(true)}
          recurringSchedule={recurringSchedule}
          toggleDay={(i: number) => setRecurringSchedule(p => {
            const next = { ...p };
            if (next[i] !== undefined) { delete next[i]; } else { next[i] = []; }
            return next;
          })}
          addTimeToDay={(dayIdx: number) => {
            setEditingDayIdx(dayIdx);
            setEditingTimeIdx(recurringSchedule[dayIdx]?.length ?? 0);
          }}
          removeTimeFromDay={(dayIdx: number, timeIdx: number) => setRecurringSchedule(p => {
            const next = { ...p };
            next[dayIdx] = next[dayIdx].filter((_, i) => i !== timeIdx);
            return next;
          })}
          editTimeForDay={(dayIdx: number, timeIdx: number) => {
            setEditingDayIdx(dayIdx);
            setEditingTimeIdx(timeIdx);
          }}
        />
      );
      case 4: return (
        <StepPreview
          title={title} description={description} images={images}
          selectedTags={selectedTags} locationAddress={locationAddress}
          precision={precision} scheduleType={scheduleType}
          eventDateTime={eventDateTime} recurringSchedule={recurringSchedule}
          quality={quality} lang={lang}
          onOpenFullPreview={() => setShowFullPreview(true)}
        />
      );
    }
  };

  const isLastStep = step === 4;
  const canProceed = step === 0 ? title.trim().length > 0 : true;

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* ── Header ─────────────────────────── */}
      <View style={st.header}>
        <TouchableOpacity onPress={step === 0 ? () => router.back() : goPrev} style={st.headerSideBtn} testID="back-btn">
          <Ionicons name={step === 0 ? 'close' : 'chevron-back'} size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={st.headerCenter}>
          <Text style={st.headerTitle}>{step < 4 ? STEPS[step].title : 'Aperçu'}</Text>
          {step < 4 && <Text style={st.headerSub}>Étape {step + 1} / 4</Text>}
        </View>
        <TouchableOpacity onPress={resetForm} style={st.headerSideBtn} testID="reset-btn">
          <Ionicons name="trash-outline" size={20} color={Colors.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Progress bar ───────────────────── */}
      <View style={st.progressBg}>
        <Animated.View
          style={[
            st.progressFill,
            {
              width: progressAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['1%', '100%'],
              }),
            },
          ]}
        />
      </View>

      {/* ── Step dots ──────────────────────── */}
      <View style={st.dots}>
        {STEPS.map((s, i) => {
          const done = i < step;
          const active = i === step;
          return (
            <TouchableOpacity
              key={i}
              style={[st.dot, done && st.dotDone, active && st.dotActive]}
              onPress={() => i <= step && setStep(i)}
            >
              {done
                ? <Ionicons name="checkmark" size={11} color={Colors.background} />
                : <Text style={[st.dotNum, active && { color: Colors.background }]}>{i + 1}</Text>
              }
            </TouchableOpacity>
          );
        })}
        {/* Preview dot */}
        <TouchableOpacity
          style={[st.dot, step === 4 && st.dotActive]}
          onPress={() => canProceed && setStep(4)}
        >
          <Ionicons name="eye-outline" size={11} color={step === 4 ? Colors.background : Colors.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Quality score ───────────────────── */}
      <View style={st.qualityBar}>
        <View style={st.qualityInner}>
          <View style={[st.qualityFill, { width: `${quality.score}%` as any, backgroundColor: quality.color }]} />
        </View>
        <Text style={[st.qualityLabel, { color: quality.color }]}>{quality.label}</Text>
      </View>

      {/* ── Tip banner ──────────────────────── */}
      {step < 4 && (
        <View style={st.tipBanner}>
          <Ionicons name={STEPS[step].tipIcon} size={16} color={Colors.primary} style={{ flexShrink: 0 }} />
          <Text style={st.tipText}>{STEPS[step].tip}</Text>
        </View>
      )}

      {/* ── Step content ───────────────────── */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={st.scroll}
          contentContainerStyle={st.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {renderStep()}
          <View style={{ height: 100 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Bottom nav ──────────────────────── */}
      <View style={st.bottomNav}>
        {!isLastStep ? (
          <TouchableOpacity
            style={[st.nextBtn, !canProceed && { opacity: 0.4 }]}
            onPress={goNext}
            disabled={!canProceed}
            testID="next-btn"
          >
            <Text style={st.nextBtnText}>{step === 3 ? 'Aperçu' : 'Suivant'}</Text>
            <Ionicons name="arrow-forward" size={18} color={Colors.background} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[st.publishBtn, submitting && { opacity: 0.85 }]}
            onPress={handleSubmit}
            disabled={submitting}
            testID="submit-btn"
          >
            {submitting ? (
              uploadProgress ? (
                <View style={st.uploadProgressContainer}>
                  <View style={st.uploadProgressHeader}>
                    <ActivityIndicator color={Colors.background} size="small" />
                    <Text style={st.publishBtnText}>
                      Envoi des photos… {uploadProgress.current}/{uploadProgress.total}
                    </Text>
                  </View>
                  <View style={st.uploadProgressTrack}>
                    <Animated.View
                      style={[
                        st.uploadProgressFill,
                        {
                          width: uploadBarAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color={Colors.background} size="small" />
                  <Text style={st.publishBtnText}>Publication…</Text>
                </View>
              )
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
                <Text style={st.publishBtnText}>Publier le TagPoint</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* ── Modals ──────────────────────────── */}
      <LocationPicker
        visible={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelect={(lat, lng, address) => { setSelectedLat(lat); setSelectedLng(lng); setLocationAddress(address); }}
        initialLat={selectedLat} initialLng={selectedLng} initialAddress={locationAddress}
      />
      <DateTimePickerModal
        visible={showDateTimePicker}
        onClose={() => setShowDateTimePicker(false)}
        onConfirm={d => { setEventDateTime(d); setShowDateTimePicker(false); }}
        initialDate={eventDateTime || undefined} mode="datetime" minDate={new Date()}
      />
      <DateTimePickerModal
        visible={editingDayIdx !== null && editingTimeIdx !== null}
        onClose={() => { setEditingDayIdx(null); setEditingTimeIdx(null); }}
        onConfirm={d => {
          if (editingDayIdx !== null && editingTimeIdx !== null) {
            setRecurringSchedule(p => {
              const next = { ...p };
              const times = [...(next[editingDayIdx] || [])];
              times[editingTimeIdx] = d;
              next[editingDayIdx] = times;
              return next;
            });
          }
          setEditingDayIdx(null); setEditingTimeIdx(null);
        }}
        initialDate={(editingDayIdx !== null && editingTimeIdx !== null && recurringSchedule[editingDayIdx]?.[editingTimeIdx]) || undefined}
        mode="time"
      />

      {/* ── Full Preview Modal (top-level to avoid ScrollView clipping) ── */}
      <FullPreviewModal
        visible={showFullPreview}
        onClose={() => setShowFullPreview(false)}
        title={title} description={description} images={images}
        selectedTags={selectedTags} locationAddress={locationAddress}
        precision={precision} scheduleType={scheduleType}
        eventDateTime={eventDateTime} recurringSchedule={recurringSchedule}
        user={user} lang={lang}
        selectedLat={selectedLat} selectedLng={selectedLng}
      />

      {/* ── Tag Modal ───────────────────────── */}
      <Modal visible={showTagModal} animationType="slide" transparent onRequestClose={() => setShowTagModal(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowTagModal(false)} />
          <View style={ms.sheet}>
            <View style={ms.handle} />
            <View style={ms.modalHeader}>
              <TouchableOpacity onPress={() => setShowTagModal(false)}>
                <Text style={ms.cancel}>Annuler</Text>
              </TouchableOpacity>
              <Text style={ms.modalTitle}>Choisir des tags</Text>
              <TouchableOpacity onPress={() => setShowTagModal(false)} testID="close-tag-modal">
                <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            {selectedTagIds.length > 0 && (
              <View style={ms.selectedBanner}>
                <Text style={ms.selectedBannerText}>{selectedTagIds.length} tag{selectedTagIds.length > 1 ? 's' : ''} sélectionné{selectedTagIds.length > 1 ? 's' : ''}</Text>
                <TouchableOpacity onPress={() => setSelectedTagIds([])}>
                  <Text style={ms.clearText}>Effacer</Text>
                </TouchableOpacity>
              </View>
            )}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ padding: Spacing.md, paddingBottom: 50 }}
              showsVerticalScrollIndicator={false}
            >
              {categories.filter(c => (c.tags || []).length > 0).map(cat => {
                const col = tagColor(cat.category_id);
                return (
                  <View key={cat.category_id} style={ms.catGroup}>
                    <View style={ms.catRow}>
                      <View style={[ms.catDot, { backgroundColor: col }]} />
                      <Text style={ms.catLabel}>{lang === 'fr' ? cat.label_fr : cat.label_en}</Text>
                    </View>
                    <View style={ms.tagsWrap}>
                      {(cat.tags || []).map((tag: any) => {
                        const sel = selectedTagIds.includes(tag.tag_id);
                        return (
                          <TouchableOpacity
                            key={tag.tag_id}
                            style={[ms.tagChip, sel && { backgroundColor: col + '22', borderColor: col }]}
                            onPress={() => toggleTag(tag.tag_id)}
                            testID={`tag-chip-${tag.tag_id}`}
                          >
                            {sel && <Ionicons name="checkmark" size={12} color={col} style={{ marginRight: 3 }} />}
                            <Text style={[ms.tagChipText, sel && { color: col, fontWeight: '700' }]}>
                              {lang === 'fr' ? tag.label_fr : tag.label_en}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Image upload helper ──────────────────────────────────────────────────────
async function uploadImage(uri: string, token: string): Promise<string | null> {
  try {
    const formData = new FormData();
    formData.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as any);
    const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    const res = await fetch(`${BASE_URL}/api/upload-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || null;
  } catch (e) {
    console.warn('Image upload failed:', e);
    return null;
  }
}

// ─── Step 1: L'essentiel ────────────────────────────────────────────────────────
function StepEssentiel({ images, title, setTitle, onPickImages, onRemoveImage }: any) {
  const IMG = Math.floor((Math.min(SW, 500) - Spacing.md * 2 - 8 * 2) / 3);
  return (
    <View style={{ gap: Spacing.lg }}>
      {/* Images */}
      <View>
        <View style={sc.rowBetween}>
          <Text style={sc.label}>Photos</Text>
          <Text style={[sc.hint, images.length > 0 && { color: Colors.primary }]}>
            {images.length}/10 · {images.length === 0 ? 'Recommandé' : images.length < 3 ? 'Ajoutez-en d\'autres !' : 'Super !'}
          </Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {/* Add button */}
          <TouchableOpacity style={[sc.imgAdd, { width: IMG, height: IMG }]} onPress={onPickImages} testID="add-image-btn">
            <View style={sc.imgAddInner}>
              <Ionicons name="add" size={32} color={Colors.primary} />
              <Text style={sc.imgAddText}>Photo</Text>
            </View>
          </TouchableOpacity>
          {images.map((uri: string, i: number) => (
            <View key={i} style={[sc.imgThumb, { width: IMG, height: IMG }]}>
              <Image source={{ uri }} style={{ width: '100%', height: '100%', borderRadius: Radius.md }} />
              {i === 0 && <View style={sc.mainBadge}><Text style={sc.mainBadgeText}>Principale</Text></View>}
              <TouchableOpacity style={sc.imgRemove} onPress={() => onRemoveImage(i)}>
                <Ionicons name="close-circle" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
        {images.length === 0 && (
          <View style={sc.noImgHint}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.muted} />
            <Text style={sc.noImgHintText}>Les tagPoints avec photos obtiennent 3× plus de vues</Text>
          </View>
        )}
      </View>

      {/* Title */}
      <View>
        <View style={sc.rowBetween}>
          <Text style={sc.label}>Titre <Text style={{ color: Colors.destructive }}>*</Text></Text>
          <Text style={[sc.hint, title.length > 15 && { color: Colors.primary }]}>
            {title.length === 0 ? 'Requis' : title.length < 10 ? 'Trop court' : title.length < 25 ? 'Bien' : 'Excellent'}
          </Text>
        </View>
        <TextInput
          style={sc.titleInput}
          placeholder="Ex : Footing matinal - Tous niveaux bienvenus"
          placeholderTextColor={Colors.muted}
          value={title}
          onChangeText={setTitle}
          maxLength={80}
          testID="title-input"
        />
        <Text style={sc.charCount}>{title.length}/80</Text>
        {title.length === 0 && (
          <View style={sc.fieldTip}>
            <Ionicons name="bulb-outline" size={13} color={Colors.muted} />
            <Text style={sc.fieldTipText}>Un bon titre : activité + lieu/ambiance + niveau</Text>
          </View>
        )}
        {title.length > 0 && title.length < 25 && (
          <View style={[sc.fieldTip, { opacity: 0.7 }]}>
            <Ionicons name="bulb-outline" size={13} color={Colors.primary} />
            <Text style={[sc.fieldTipText, { color: Colors.primary }]}>Ex : "Footing Parc Monceau · Déb. bienvenus"</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Step 2: Le contenu ─────────────────────────────────────────────────────────
function StepContenu({ description, setDescription, domainId, setDomainId, domains, selectedTags, onOpenTags, lang }: any) {
  return (
    <View style={{ gap: Spacing.lg }}>
      {/* Description */}
      <View>
        <View style={sc.rowBetween}>
          <Text style={sc.label}>Description</Text>
          <Text style={[sc.hint, description.length > 50 && { color: Colors.primary }]}>
            {description.length === 0 ? 'Recommandé' : description.length < 30 ? 'Enrichissez' : 'Bien'}
          </Text>
        </View>
        <RichTextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Décrivez l'ambiance, le niveau requis, ce qu'il faut apporter, les règles du groupe…"
          maxLength={500}
          testID="description-input"
        />
        <Text style={sc.charCount}>{description.length}/500</Text>
      </View>

      {/* Domain */}
      <View>
        <Text style={sc.label}>Domaine</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {domains.map((d: any) => {
            const sel = domainId === d.domain_id;
            const col = d.color || Colors.primary;
            return (
              <TouchableOpacity
                key={d.domain_id}
                style={[sc.domainPill, sel && { backgroundColor: col + '22', borderColor: col }]}
                onPress={() => setDomainId(d.domain_id)}
                testID={`domain-${d.domain_id}`}
              >
                <Text style={[sc.domainText, sel && { color: col, fontWeight: '700' }]}>
                  {lang === 'fr' ? d.label_fr : d.label_en}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Tags */}
      <View>
        <View style={sc.rowBetween}>
          <Text style={sc.label}>Tags</Text>
          {selectedTags.length > 0 && <Text style={[sc.hint, { color: Colors.primary }]}>{selectedTags.length} sélectionné{selectedTags.length > 1 ? 's' : ''}</Text>}
        </View>
        <TouchableOpacity style={sc.tagTrigger} onPress={onOpenTags} testID="open-tags-btn">
          {selectedTags.length === 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Ionicons name="pricetags-outline" size={18} color={Colors.muted} />
              <Text style={{ color: Colors.muted, fontSize: 15 }}>Choisir des tags</Text>
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>
              {selectedTags.slice(0, 5).map((t: any) => {
                const c = tagColor(t.category_id);
                return (
                  <View key={t.tag_id} style={[sc.tagPill, { backgroundColor: c + '22', borderColor: c }]}>
                    <Text style={[sc.tagPillText, { color: c }]}>{lang === 'fr' ? t.label_fr : t.label_en}</Text>
                  </View>
                );
              })}
              {selectedTags.length > 5 && <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 12, alignSelf: 'center' }}>+{selectedTags.length - 5}</Text>}
            </View>
          )}
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        </TouchableOpacity>
        {selectedTags.length === 0 && (
          <View style={sc.fieldTip}>
            <Text style={sc.fieldTipText}>Les tags permettent à votre tagPoint d'apparaître dans les recherches filtrées</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Step 3: Localisation ───────────────────────────────────────────────────────
function StepLocalisation({ selectedLat, selectedLng, locationAddress, precision, setPrecision, precisionRadius, onOpenLocation }: any) {
  return (
    <View style={{ gap: Spacing.lg }}>
      {/* Location */}
      <View>
        <Text style={sc.label}>Adresse</Text>
        <TouchableOpacity style={sc.locationRow} onPress={onOpenLocation} testID="open-location-btn">
          <Ionicons name="location" size={20} color={Colors.primary} />
          <Text style={sc.locationText} numberOfLines={2}>{locationAddress}</Text>
          <View style={sc.editBadge}>
            <Ionicons name="pencil" size={12} color={Colors.primary} />
            <Text style={sc.editBadgeText}>Modifier</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Precision */}
      <View>
        <Text style={sc.label}>Niveau de confidentialité</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {PRECISION_OPTIONS.map(p => {
            const active = precision === p.value;
            return (
              <TouchableOpacity
                key={p.value}
                style={[sc.precisionCompact, active && sc.precisionCompactActive]}
                onPress={() => setPrecision(p.value)}
                testID={`precision-${p.value}`}
              >
                <View style={[sc.precisionCompactIcon, active && { backgroundColor: Colors.primary + '22' }]}>
                  <Ionicons name={p.icon} size={22} color={active ? Colors.primary : Colors.muted} />
                </View>
                <Text style={[sc.precisionCompactLabel, active && { color: Colors.primary }]}>{p.label}</Text>
                <Text style={sc.precisionCompactDesc} numberOfLines={2}>{p.desc}</Text>
                {active && <View style={sc.precisionCheck}><Ionicons name="checkmark" size={10} color={Colors.background} /></View>}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Map */}
      <View>
        <Text style={sc.label}>Aperçu sur la carte</Text>
        <View style={sc.mapWrap}>
          <MapViewComponent
            key={`${selectedLat}-${selectedLng}-${precision}`}
            centerLat={selectedLat} centerLng={selectedLng}
            zoom={precisionRadius >= 1000 ? 13 : precisionRadius >= 100 ? 15 : 16}
            selectable={false} showUserMarker={false}
            selectedLat={selectedLat} selectedLng={selectedLng}
            pins={precisionRadius === 0 ? [{ id: 'pin', lat: selectedLat, lng: selectedLng, title: locationAddress, color: Colors.primary }] : []}
            precisionRadius={precisionRadius}
          />
        </View>
      </View>
    </View>
  );
}

// ─── Step 4: Date ───────────────────────────────────────────────────────────────
function StepDate({ scheduleType, setScheduleType, eventDateTime, onOpenDatePicker, recurringSchedule, toggleDay, addTimeToDay, removeTimeFromDay, editTimeForDay }: any) {
  const selectedDays = Object.keys(recurringSchedule).map(Number).sort((a, b) => a - b);

  return (
    <View style={{ gap: Spacing.lg }}>
      <View style={sc.scheduleTypes}>
        {([
          { type: 'none', icon: 'ban-outline', label: 'Sans date', sub: 'Permanente' },
          { type: 'once', icon: 'calendar-outline', label: 'Date unique', sub: 'Ponctuel' },
          { type: 'recurring', icon: 'repeat-outline', label: 'Récurrent', sub: 'Hebdo' },
        ] as const).map(({ type, icon, label, sub }) => {
          const active = scheduleType === type;
          return (
            <TouchableOpacity key={type} style={[sc.scheduleCard, active && sc.scheduleCardActive]}
              onPress={() => setScheduleType(type)} testID={`schedule-${type}`}>
              <View style={[sc.scheduleIconBox, active && { backgroundColor: Colors.primary + '22' }]}>
                <Ionicons name={icon} size={26} color={active ? Colors.primary : Colors.muted} />
              </View>
              <Text style={[sc.scheduleLabel, active && { color: Colors.primary, fontWeight: '700' }]}>{label}</Text>
              <Text style={sc.scheduleSub}>{sub}</Text>
              {active && <View style={sc.scheduleCheck}><Ionicons name="checkmark" size={12} color={Colors.background} /></View>}
            </TouchableOpacity>
          );
        })}
      </View>

      {scheduleType === 'once' && (
        <TouchableOpacity style={sc.dateBtn} onPress={onOpenDatePicker} testID="open-datetime-picker">
          <Ionicons name="calendar" size={22} color={eventDateTime ? Colors.primary : Colors.muted} />
          <View style={{ flex: 1 }}>
            {eventDateTime
              ? <><Text style={sc.dateBtnValue}>{fmtDate(eventDateTime)}</Text><Text style={sc.dateBtnSub}>à {fmtTime(eventDateTime)}</Text></>
              : <Text style={sc.dateBtnPlaceholder}>Choisir une date et une heure</Text>
            }
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        </TouchableOpacity>
      )}

      {scheduleType === 'recurring' && (
        <View style={{ gap: Spacing.md }}>
          {/* Day selector */}
          <View>
            <Text style={sc.scheduleFieldLabel}>Jours actifs</Text>
            <View style={sc.daysRow}>
              {DAYS.map((d, i) => {
                const active = recurringSchedule[i] !== undefined;
                return (
                  <TouchableOpacity key={d} style={[sc.dayBtn, active && sc.dayBtnActive]}
                    onPress={() => toggleDay(i)} testID={`day-${i}`}>
                    <Text style={[sc.dayText, active && { color: Colors.background }]}>{d}</Text>
                    {active && (recurringSchedule[i].length > 0) && (
                      <View style={sc.dayTimeBadge}>
                        <Text style={sc.dayTimeBadgeText}>{recurringSchedule[i].length}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
            {selectedDays.length === 0 && (
              <View style={sc.fieldTip}>
                <Ionicons name="information-circle-outline" size={13} color={Colors.muted} />
                <Text style={sc.fieldTipText}>Sélectionnez un ou plusieurs jours</Text>
              </View>
            )}
          </View>

          {/* Per-day time slots */}
          {selectedDays.map(dayIdx => (
            <View key={dayIdx} style={sc.dayScheduleCard}>
              <View style={sc.dayScheduleHeader}>
                <View style={sc.dayScheduleDot} />
                <Text style={sc.dayScheduleTitle}>{DAYS[dayIdx]}</Text>
                <Text style={sc.dayScheduleCount}>
                  {recurringSchedule[dayIdx].length} créneau{recurringSchedule[dayIdx].length !== 1 ? 'x' : ''}
                </Text>
              </View>
              <View style={{ gap: 8 }}>
                {recurringSchedule[dayIdx].map((time: Date, tIdx: number) => (
                  <View key={tIdx} style={sc.timeSlotRow}>
                    <TouchableOpacity style={[sc.dateBtn, { flex: 1 }]}
                      onPress={() => editTimeForDay(dayIdx, tIdx)} testID={`time-${dayIdx}-${tIdx}`}>
                      <Ionicons name="time-outline" size={18} color={Colors.primary} />
                      <Text style={sc.dateBtnValue}>{fmtTime(time)}</Text>
                      <Ionicons name="pencil-outline" size={13} color={Colors.muted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeTimeFromDay(dayIdx, tIdx)}
                      style={sc.removeTimeBtn} testID={`remove-time-${dayIdx}-${tIdx}`}>
                      <Ionicons name="close-circle" size={22} color={Colors.muted} />
                    </TouchableOpacity>
                  </View>
                ))}
                <TouchableOpacity style={sc.addTimeBtn} onPress={() => addTimeToDay(dayIdx)}
                  testID={`add-time-${dayIdx}`}>
                  <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                  <Text style={sc.addTimeBtnText}>Ajouter un créneau</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Step 5: Preview ────────────────────────────────────────────────────────────
function StepPreview({ title, description, images, selectedTags, locationAddress, precision, scheduleType, eventDateTime, recurringSchedule, quality, lang, onOpenFullPreview }: any) {
  const scheduleLabel = buildScheduleLabel(scheduleType, eventDateTime, recurringSchedule);
  const items = [
    { icon: 'camera-outline', label: 'Photos', value: images.length > 0 ? `${images.length} photo${images.length > 1 ? 's' : ''}` : null, tip: 'Aucune photo', done: images.length > 0 },
    { icon: 'text-outline', label: 'Titre', value: title || null, tip: 'Manquant', done: !!title },
    { icon: 'document-text-outline', label: 'Description', value: description ? `${description.length} car.` : null, tip: 'Non renseignée', done: !!description },
    { icon: 'pricetags-outline', label: 'Tags', value: selectedTags.length > 0 ? `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}` : null, tip: 'Aucun tag', done: selectedTags.length > 0 },
    { icon: 'location-outline', label: 'Lieu', value: locationAddress, tip: 'Non défini', done: true },
    { icon: 'calendar-outline', label: 'Date', value: scheduleType !== 'none' ? scheduleLabel : null, tip: 'Sans date', done: scheduleType !== 'none' },
  ];

  return (
    <View style={{ gap: Spacing.lg }}>
      <View style={[sc.qualityCard, { borderColor: quality.color + '44' }]}>
        <View style={sc.qualityCardHeader}>
          <Text style={[sc.qualityCardScore, { color: quality.color }]}>{quality.score}%</Text>
          <View style={{ flex: 1 }}>
            <Text style={sc.qualityCardLabel}>{quality.label}</Text>
            <Text style={sc.qualityCardSub}>Score d'attractivité</Text>
          </View>
          <View style={sc.qualityBarWrap}>
            <View style={sc.qualityBarBg}>
              <View style={[sc.qualityBarFill, { width: `${quality.score}%` as any, backgroundColor: quality.color }]} />
            </View>
          </View>
        </View>
      </View>

      <TouchableOpacity style={sc.fullPreviewBtn} onPress={onOpenFullPreview} testID="full-preview-btn">
        <Ionicons name="eye-outline" size={20} color={Colors.primary} />
        <Text style={sc.fullPreviewBtnText}>Voir l'aperçu complet</Text>
        <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
      </TouchableOpacity>

      <View style={sc.previewCard}>
        <Text style={sc.previewCardTitle}>Récapitulatif</Text>
        {items.map((item, i) => (
          <View key={i} style={[sc.previewRow, i < items.length - 1 && sc.previewRowBorder]}>
            <Ionicons name={item.icon as any} size={18} color={item.done ? Colors.primary : Colors.muted} />
            <Text style={sc.previewRowLabel}>{item.label}</Text>
            <Text style={[sc.previewRowValue, !item.done && { color: Colors.muted, fontStyle: 'italic' }]} numberOfLines={1}>
              {item.value || item.tip}
            </Text>
            <Ionicons name={item.done ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={item.done ? Colors.primary : Colors.muted} />
          </View>
        ))}
      </View>

      {quality.score < 50 && (
        <View style={sc.improveTip}>
          <Ionicons name="sparkles-outline" size={16} color={Colors.primary} />
          <Text style={sc.improveTipText}>
            {!images.length ? "Ajoutez des photos pour booster l'attractivité." :
             !description ? 'Une description complète fidélise les participants.' :
             !selectedTags.length ? 'Des tags améliorent la découverte de votre tagPoint.' :
             scheduleType === 'none' ? 'Une date aide les participants à planifier leur venue.' :
             'Complétez le titre pour un meilleur impact.'}
          </Text>
        </View>
      )}
    </View>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
function buildScheduleLabel(scheduleType: string, eventDateTime: Date | null, recurringSchedule: Record<number, Date[]>): string {
  if (scheduleType === 'none') return 'Sans date';
  if (scheduleType === 'once') return eventDateTime ? `${fmtDate(eventDateTime)} à ${fmtTime(eventDateTime)}` : 'Non configuré';
  const days = Object.keys(recurringSchedule).map(Number).sort((a, b) => a - b);
  if (days.length === 0) return 'Non configuré';
  return days.map(d => {
    const times = recurringSchedule[d];
    return `${DAYS[d]}: ${times.length > 0 ? times.map(fmtTime).join(', ') : '—'}`;
  }).join(' · ');
}

// ─── Fake votes data for preview encouragement ──────────────────────────────
const FAKE_VOTES_DATA = [
  { initials: 'ML', color: '#2196F3', name: 'Marie L.', stars: 5, comment: 'Super activité ! Bien organisée, ambiance parfaite. Je reviendrai sans hésiter !', time: 'il y a 2 jours' },
  { initials: 'PT', color: '#FF5722', name: 'Pierre T.', stars: 4, comment: 'Belle initiative et bonne ambiance. Je recommande à tous ceux qui cherchent un groupe motivé.', time: 'il y a 5 jours' },
  { initials: 'CD', color: '#9C27B0', name: 'Camille D.', stars: 5, comment: 'Accueil top, encadrement parfait pour les débutants. 5 étoiles mérités !', time: 'il y a 1 semaine' },
];
const FAKE_RATING = 4.7;
const FAKE_VOTES_COUNT = 12;
const FAKE_DIST = [8, 3, 1, 0, 0]; // [5★, 4★, 3★, 2★, 1★]

// ─── Full Preview Modal (rendered at root level) ─────────────────────────────
function FullPreviewModal({ visible, onClose, title, description, images, selectedTags, locationAddress, precision, scheduleType, eventDateTime, recurringSchedule, user, lang, selectedLat, selectedLng }: any) {
  const scheduleLabel = buildScheduleLabel(scheduleType, eventDateTime, recurringSchedule);
  const days = Object.keys(recurringSchedule || {}).map(Number).sort((a, b) => a - b);
  const precisionRadius = precision === 'exact' ? 0 : precision === '100m' ? 100 : 1000;
  const precisionLabel = precision === 'exact' ? 'Exact' : precision === '100m' ? '~100m' : '~1km';

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {/* Fixed header */}
        <View style={fpSt.header}>
          <TouchableOpacity onPress={onClose} style={fpSt.closeBtn} testID="close-full-preview" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color={Colors.primary} />
          </TouchableOpacity>
          <Text style={fpSt.headerTitle}>Détails</Text>
          <View style={fpSt.previewBadge}>
            <Text style={fpSt.previewBadgeText}>Aperçu</Text>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>

          {/* 1. Image hero + owner overlay */}
          <View style={{ marginHorizontal: Spacing.md, marginTop: Spacing.md }}>
            <View style={fpSt.heroWrap}>
              {images.length > 0
                ? <Image source={{ uri: images[0] }} style={fpSt.heroImage} resizeMode="cover" />
                : <View style={fpSt.heroPlaceholder}>
                    <Ionicons name="image-outline" size={60} color={Colors.muted} />
                    <Text style={{ color: Colors.muted, fontSize: 13, marginTop: 8 }}>Aucune photo ajoutée</Text>
                  </View>
              }
              {images.length > 1 && (
                <View style={fpSt.imgCount}>
                  <Ionicons name="images-outline" size={12} color="#fff" />
                  <Text style={fpSt.imgCountText}>{images.length} photos</Text>
                </View>
              )}
            </View>
            {/* Owner badge overlay (like [id].tsx) */}
            <View style={fpSt.ownerBadge}>
              <View style={fpSt.ownerAvatar}>
                {user?.picture
                  ? <Image source={{ uri: user.picture }} style={{ width: '100%', height: '100%' }} />
                  : <Text style={fpSt.ownerInitial}>{user?.name?.charAt(0)?.toUpperCase() || '?'}</Text>
                }
              </View>
              <View>
                <Text style={fpSt.ownerName}>{user?.name || 'Vous'}</Text>
                <Text style={fpSt.ownerRole}>Créateur</Text>
              </View>
            </View>
          </View>

          {/* 2. Title + fake rating + tags */}
          <View style={fpSt.titleSection}>
            <Text style={fpSt.title}>{title || 'Sans titre'}</Text>
            <View style={fpSt.metaRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="location-outline" size={15} color={Colors.primary} />
                <Text style={fpSt.distText}>{locationAddress || 'Localisation'}</Text>
              </View>
              <View style={fpSt.ratingRow}>
                {[1,2,3,4,5].map(i => (
                  <Ionicons key={i} name={i <= Math.round(FAKE_RATING) ? 'star' : 'star-outline'}
                    size={14} color={i <= Math.round(FAKE_RATING) ? Colors.star || '#FFD700' : Colors.muted} />
                ))}
                <Text style={fpSt.ratingCount}>{FAKE_RATING} ({FAKE_VOTES_COUNT})</Text>
              </View>
            </View>
            {selectedTags.length > 0 && (
              <View style={fpSt.tagsRow}>
                {selectedTags.map((t: any) => {
                  const c = tagColor(t.category_id);
                  return (
                    <View key={t.tag_id} style={[fpSt.tagPill, { backgroundColor: c + '22', borderColor: c }]}>
                      <Text style={[fpSt.tagText, { color: c }]}>{lang === 'fr' ? t.label_fr : t.label_en}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* 3. Date card */}
          {(scheduleType === 'once' || scheduleType === 'recurring') && (
            <View style={fpSt.dateCard}>
              {scheduleType === 'once' && eventDateTime && (
                <View style={fpSt.dateRow}>
                  <View style={fpSt.dateIconBox}>
                    <Ionicons name="calendar" size={20} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={fpSt.dateLabel}>Prochain événement</Text>
                    <Text style={fpSt.dateValue}>{scheduleLabel}</Text>
                  </View>
                </View>
              )}
              {scheduleType === 'recurring' && days.length > 0 && (
                <View>
                  <View style={fpSt.dateRow}>
                    <View style={fpSt.dateIconBox}>
                      <Ionicons name="repeat-outline" size={20} color={Colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={fpSt.dateLabel}>Récurrent</Text>
                      <Text style={fpSt.dateValue}>{days.map(d => DAYS[d]).join(', ')}</Text>
                    </View>
                  </View>
                  {/* Per-day table */}
                  <View style={fpSt.scheduleTable}>
                    {days.map((dayIdx: number, idx: number) => {
                      const times: Date[] = recurringSchedule[dayIdx] || [];
                      return (
                        <View key={dayIdx} style={[fpSt.scheduleRow, idx < days.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.border + '60' }]}>
                          <Text style={fpSt.scheduleDayText}>{DAYS[dayIdx]}</Text>
                          <View style={fpSt.scheduleTimesRow}>
                            {times.length > 0
                              ? times.map((t: Date, i: number) => (
                                  <View key={i} style={fpSt.scheduleTimeChip}>
                                    <Text style={fpSt.scheduleTimeChipText}>{fmtTime(t)}</Text>
                                  </View>
                                ))
                              : <Text style={{ fontSize: 12, color: Colors.muted }}>—</Text>
                            }
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* 4. RSVP row (preview — disabled) */}
          <View style={fpSt.rsvpRow}>
            <View style={fpSt.rsvpBtn}>
              <Ionicons name="add-circle-outline" size={18} color={Colors.background} />
              <Text style={fpSt.rsvpText}>Rejoindre</Text>
            </View>
            <Text style={fpSt.rsvpCount}>4 participants</Text>
            <View style={{ flex: 1 }} />
            <View style={fpSt.msgBtn}>
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={Colors.muted} />
            </View>
          </View>

          {/* 5. Actions row (preview — disabled) */}
          <View style={fpSt.actionsRow}>
            {([
              { icon: 'layers-outline', label: 'Similaires' },
              { icon: 'share-social-outline', label: 'Partager' },
              { icon: 'bookmark-outline', label: 'Sauvegarder' },
            ] as const).map(a => (
              <View key={a.label} style={fpSt.actionBtn}>
                <View style={fpSt.actionIcon}>
                  <Ionicons name={a.icon} size={26} color={Colors.muted} />
                </View>
                <Text style={fpSt.actionLabel}>{a.label}</Text>
              </View>
            ))}
          </View>

          {/* 6. Map */}
          {selectedLat != null && selectedLng != null && (
            <View style={fpSt.mapWrap}>
              <MapViewComponent
                centerLat={selectedLat} centerLng={selectedLng}
                zoom={precisionRadius > 500 ? 14 : 16}
                precisionRadius={precisionRadius}
                selectedLat={selectedLat} selectedLng={selectedLng}
                pins={precisionRadius === 0 ? [{ id: 'pin', lat: selectedLat, lng: selectedLng, title: locationAddress, color: Colors.primary }] : []}
              />
            </View>
          )}

          {/* 7. Description */}
          {description ? (
            <View style={fpSt.section}>
              <Text style={fpSt.sectionTitle}>Description</Text>
              <MarkdownText style={fpSt.descText}>{description}</MarkdownText>
            </View>
          ) : (
            <View style={[fpSt.section, { alignItems: 'center', paddingVertical: 20 }]}>
              <Ionicons name="document-text-outline" size={32} color={Colors.muted} />
              <Text style={{ color: Colors.muted, fontSize: 13, marginTop: 8 }}>Aucune description</Text>
            </View>
          )}

          {/* 8. Fake votes section — encouragement */}
          <View style={fpSt.section}>
            {/* Preview note */}
            <View style={fpSt.exampleBanner}>
              <Ionicons name="sparkles-outline" size={14} color={Colors.primary} />
              <Text style={fpSt.exampleBannerText}>
                Exemples d'avis — publiez pour recevoir de vrais votes !
              </Text>
            </View>

            {/* Rating summary */}
            <View style={fpSt.reviewsHeader}>
              <View style={fpSt.reviewsBig}>
                <Text style={fpSt.reviewsNum}>{FAKE_RATING}</Text>
                <View>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {[1,2,3,4,5].map(i => (
                      <Ionicons key={i} name={i <= Math.round(FAKE_RATING) ? 'star' : 'star-outline'}
                        size={16} color={i <= Math.round(FAKE_RATING) ? Colors.star || '#FFD700' : Colors.muted} />
                    ))}
                  </View>
                  <Text style={fpSt.reviewsCountTxt}>{FAKE_VOTES_COUNT} avis</Text>
                </View>
              </View>
              <View style={{ flex: 1, paddingLeft: Spacing.md }}>
                {FAKE_DIST.map((count, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <Text style={{ fontSize: 11, color: Colors.muted, width: 10 }}>{5 - i}</Text>
                    <View style={{ flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' }}>
                      <View style={{ width: `${(count / FAKE_VOTES_COUNT) * 100}%` as any, height: '100%', backgroundColor: Colors.primary + 'CC', borderRadius: 3 }} />
                    </View>
                    <Text style={{ fontSize: 11, color: Colors.muted, width: 14 }}>{count}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Fake vote cards */}
            {FAKE_VOTES_DATA.map((v, i) => (
              <View key={i} style={fpSt.voteCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <View style={[fpSt.voteAvatar, { backgroundColor: v.color }]}>
                    <Text style={fpSt.voteAvatarText}>{v.initials}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={fpSt.voteName}>{v.name}</Text>
                    <Text style={fpSt.voteTime}>{v.time}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {[1,2,3,4,5].map(s => (
                      <Ionicons key={s} name={s <= v.stars ? 'star' : 'star-outline'}
                        size={13} color={s <= v.stars ? Colors.star || '#FFD700' : Colors.muted} />
                    ))}
                  </View>
                </View>
                <Text style={fpSt.voteComment}>{v.comment}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* FAB Voter (disabled preview) */}
        <View style={[fpSt.fab, { opacity: 0.4 }]}>
          <Ionicons name="star" size={22} color={Colors.background} />
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.header },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm, backgroundColor: Colors.header },
  headerSideBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  headerSub: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  progressBg: { height: 3, backgroundColor: Colors.border },
  progressFill: { height: 3, backgroundColor: Colors.primary, borderRadius: 2 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 10 },
  dot: { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotNum: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  qualityBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingBottom: 8, gap: 10 },
  qualityInner: { flex: 1, height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  qualityFill: { height: '100%', borderRadius: 2 },
  qualityLabel: { fontSize: 11, fontWeight: '700', minWidth: 60, textAlign: 'right' },
  tipBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: Spacing.md, paddingBottom: 10 },
  tipText: { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 17 },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.md },
  bottomNav: { paddingHorizontal: Spacing.md, paddingBottom: Platform.OS === 'ios' ? 24 : 16, paddingTop: 10, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 15 },
  nextBtnText: { fontSize: 16, fontWeight: '700', color: Colors.background },
  publishBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 15 },
  publishBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
  uploadProgressContainer: { width: '100%', paddingHorizontal: 4, gap: 8 },
  uploadProgressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  uploadProgressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2, overflow: 'hidden', width: '100%' },
  uploadProgressFill: { height: 4, backgroundColor: Colors.background, borderRadius: 2 },
});

// Shared sub-component styles
const sc = StyleSheet.create({
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint: { fontSize: 12, color: Colors.muted, fontWeight: '600' },
  charCount: { fontSize: 11, color: Colors.muted, textAlign: 'right', marginTop: 4 },
  fieldTip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 4 },
  fieldTipText: { fontSize: 12, color: Colors.muted, fontStyle: 'italic', flex: 1 },
  noImgHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  noImgHintText: { fontSize: 12, color: Colors.muted },

  // Images
  imgAdd: { borderRadius: Radius.lg, backgroundColor: Colors.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  imgAddInner: { alignItems: 'center', gap: 4 },
  imgAddText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  imgThumb: { borderRadius: Radius.lg, marginRight: 10, position: 'relative', overflow: 'hidden' },
  mainBadge: { position: 'absolute', bottom: 6, left: 6, backgroundColor: Colors.primary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  mainBadgeText: { fontSize: 9, color: Colors.background, fontWeight: '700', textTransform: 'uppercase' },
  imgRemove: { position: 'absolute', top: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 11 },

  // Title input
  titleInput: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border },

  // Domain
  domainPill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, marginRight: 8 },
  domainText: { fontSize: 13, fontWeight: '600', color: Colors.muted },

  // Tags
  tagTrigger: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, minHeight: 52 },
  tagPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1.5 },
  tagPillText: { fontSize: 12, fontWeight: '600' },

  // Location
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  locationText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },
  editBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.primary + '15', borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 4 },
  editBadgeText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  // Precision - compact horizontal
  precisionCompact: { flex: 1, alignItems: 'center', gap: 5, padding: 10, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, position: 'relative', minHeight: 90 },
  precisionCompactActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  precisionCompactIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  precisionCompactLabel: { fontSize: 12, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  precisionCompactDesc: { fontSize: 10, color: Colors.muted, textAlign: 'center', lineHeight: 13 },
  precisionCheck: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },

  // Map
  mapWrap: { height: 200, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },

  // Schedule
  scheduleTypes: { flexDirection: 'row', gap: 8 },
  scheduleCard: { flex: 1, alignItems: 'center', gap: 6, padding: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, position: 'relative' },
  scheduleCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  scheduleIconBox: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  scheduleLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, textAlign: 'center' },
  scheduleSub: { fontSize: 11, color: Colors.muted, textAlign: 'center' },
  scheduleCheck: { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  dateBtnValue: { fontSize: 16, fontWeight: '700', color: Colors.primary, flex: 1 },
  dateBtnSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  dateBtnPlaceholder: { fontSize: 15, color: Colors.muted, flex: 1 },
  scheduleFieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dayBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.border },
  dayBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  timeSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  removeTimeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addTimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary + '60', backgroundColor: Colors.primary + '08' },
  addTimeBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  // Per-day schedule card
  dayScheduleCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  dayScheduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dayScheduleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  dayScheduleTitle: { fontSize: 14, fontWeight: '800', color: Colors.foreground, flex: 1 },
  dayScheduleCount: { fontSize: 11, color: Colors.muted },
  // Day badge (time count on day button)
  dayTimeBadge: { position: 'absolute', top: -4, right: -4, width: 15, height: 15, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dayTimeBadgeText: { fontSize: 9, color: Colors.background, fontWeight: '800' },

  // Preview
  fullPreviewBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.primary + '12', borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.primary + '40' },
  fullPreviewBtnText: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.primary },
  qualityCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5 },
  qualityCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qualityCardScore: { fontSize: 36, fontWeight: '900' },
  qualityCardLabel: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  qualityCardSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  qualityBarWrap: { flex: 1 },
  qualityBarBg: { height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  qualityBarFill: { height: '100%', borderRadius: 4 },
  previewCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  previewCardTitle: { fontSize: 13, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, letterSpacing: 0.6 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  previewRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  previewRowLabel: { fontSize: 14, fontWeight: '600', color: Colors.foreground, width: 80 },
  previewRowValue: { flex: 1, fontSize: 14, color: Colors.foreground },
  improveTip: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.primary + '12', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.primary + '30' },
  improveTipText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: SH * 0.82, overflow: 'hidden' },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cancel: { fontSize: 14, color: Colors.muted, minWidth: 50 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground, flex: 1, textAlign: 'center' },
  selectedBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: 8, backgroundColor: Colors.primary + '15', borderBottomWidth: 1, borderBottomColor: Colors.border },
  selectedBannerText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  clearText: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },
  catGroup: { marginBottom: Spacing.lg },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 0.8 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  tagChipText: { fontSize: 13, fontWeight: '500', color: Colors.foreground },
});

// Full Preview Modal styles (mirrors [id].tsx)
const fpSt = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Platform.OS === 'ios' ? 54 : 32, paddingBottom: Spacing.sm, backgroundColor: Colors.header, borderBottomWidth: 1, borderBottomColor: Colors.border },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.primary, textAlign: 'center' },
  previewBadge: { backgroundColor: Colors.primary + '20', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6 },
  previewBadgeText: { fontSize: 11, color: Colors.primary, fontWeight: '700' },

  // Image
  heroWrap: { height: 240, backgroundColor: Colors.card, borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  imgCount: { position: 'absolute', bottom: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  imgCountText: { fontSize: 11, color: '#fff', fontWeight: '600' },

  // Owner badge (like [id].tsx ownerBadge)
  ownerBadge: { position: 'absolute', bottom: -16, left: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.full, paddingRight: 12, paddingVertical: 4, paddingLeft: 4, borderWidth: 1, borderColor: Colors.border },
  ownerAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ownerInitial: { fontSize: 15, fontWeight: '700', color: Colors.background },
  ownerName: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  ownerRole: { fontSize: 11, color: Colors.primary },

  // Title section
  titleSection: { paddingHorizontal: Spacing.md, paddingTop: 28, paddingBottom: Spacing.md },
  title: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  distText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ratingCount: { fontSize: 12, color: Colors.muted, marginLeft: 4 },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  tagPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1.5 },
  tagText: { fontSize: 13, fontWeight: '600' },

  // Date card
  dateCard: { marginHorizontal: Spacing.md, marginBottom: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  dateIconBox: { width: 44, height: 44, borderRadius: Radius.md, backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { fontSize: 11, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  dateValue: { fontSize: 15, fontWeight: '700', color: Colors.primary },

  // Schedule table
  scheduleTable: { marginHorizontal: Spacing.md, marginTop: 8, marginBottom: Spacing.md, backgroundColor: Colors.background, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 9 },
  scheduleDayText: { fontSize: 12, fontWeight: '800', color: Colors.foreground, width: 44 },
  scheduleTimesRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  scheduleTimeChip: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: Colors.primary + '18', borderWidth: 1, borderColor: Colors.primary + '40' },
  scheduleTimeChipText: { fontSize: 12, fontWeight: '700', color: Colors.primary },

  // RSVP row
  rsvpRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  rsvpBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.full },
  rsvpText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  rsvpCount: { fontSize: 13, color: Colors.muted },
  msgBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },

  // Actions row
  actionsRow: { flexDirection: 'row', paddingHorizontal: Spacing.md, marginBottom: Spacing.md, gap: 0 },
  actionBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: Spacing.sm },
  actionIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  actionLabel: { fontSize: 12, color: Colors.muted, fontWeight: '500' },

  // Map
  mapWrap: { height: 200, marginHorizontal: Spacing.md, marginBottom: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },

  // Section
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.md, gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  descText: { fontSize: 14, color: Colors.foreground, lineHeight: 21 },

  // Reviews
  exampleBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '12', borderRadius: Radius.md, padding: Spacing.sm, borderWidth: 1, borderColor: Colors.primary + '30' },
  exampleBannerText: { flex: 1, fontSize: 12, color: Colors.primary, fontWeight: '600' },
  reviewsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  reviewsBig: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reviewsNum: { fontSize: 40, fontWeight: '900', color: Colors.foreground, lineHeight: 44 },
  reviewsCountTxt: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  voteCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  voteAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  voteAvatarText: { fontSize: 13, fontWeight: '700', color: '#fff' },
  voteName: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  voteTime: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  voteComment: { fontSize: 14, color: Colors.foreground, lineHeight: 20 },

  // FAB
  fab: { position: 'absolute', bottom: 24, right: 24, width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
});
