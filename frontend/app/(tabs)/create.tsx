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
  const { user } = useAuth();
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

  // Location
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);
  const [locationAddress, setLocationAddress] = useState('Paris, France');
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Schedule
  const [scheduleType, setScheduleType] = useState<'none' | 'once' | 'recurring'>('none');
  const [eventDateTime, setEventDateTime] = useState<Date | null>(null);
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [recurringDays, setRecurringDays] = useState<number[]>([]);
  const [recurringTimes, setRecurringTimes] = useState<Date[]>([]);
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null);

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
            setRecurringDays([]); setRecurringTimes([]);
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
    if (scheduleType === 'recurring' && (recurringDays.length === 0 || recurringTimes.length === 0)) {
      Alert.alert('Configuration incomplète', 'Sélectionnez au moins un jour et un créneau horaire.'); return;
    }

    setSubmitting(true);
    try {
      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        latitude: selectedLat, longitude: selectedLng,
        precision, domain_id: domainId,
        tag_ids: selectedTagIds, images: [],
      };
      if (scheduleType === 'once' && eventDateTime) payload.event_date = eventDateTime.toISOString();
      if (scheduleType === 'recurring' && recurringDays.length > 0 && recurringTimes.length > 0)
        payload.event_schedule = { type: 'weekly', days: recurringDays, times: recurringTimes.map(fmtTime) };

      const result = await api.post('/tag-points', payload);
      Alert.alert('Publié !', 'Votre tagPoint est visible !', [
        { text: 'Voir', onPress: () => router.replace(`/tag-point/${result.point_id}` as any) },
        { text: 'Accueil', onPress: () => router.replace('/(tabs)/map' as any) },
      ]);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le tagPoint');
    } finally { setSubmitting(false); }
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
          recurringDays={recurringDays}
          toggleRecurringDay={(i: number) => setRecurringDays(p => p.includes(i) ? p.filter(x => x !== i) : [...p, i])}
          recurringTimes={recurringTimes}
          onEditTime={(idx: number) => setEditingTimeIdx(idx)}
          onAddTime={() => setEditingTimeIdx(recurringTimes.length)}
          onRemoveTime={(idx: number) => setRecurringTimes(p => p.filter((_, i) => i !== idx))}
        />
      );
      case 4: return (
        <StepPreview
          title={title} description={description} images={images}
          selectedTags={selectedTags} locationAddress={locationAddress}
          precision={precision} scheduleType={scheduleType}
          eventDateTime={eventDateTime} recurringDays={recurringDays} recurringTimes={recurringTimes}
          quality={quality} lang={lang}
          user={user} selectedLat={selectedLat} selectedLng={selectedLng}
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
            style={[st.publishBtn, submitting && { opacity: 0.5 }]}
            onPress={handleSubmit}
            disabled={submitting}
            testID="submit-btn"
          >
            {submitting
              ? <ActivityIndicator color={Colors.background} />
              : <>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
                  <Text style={st.publishBtnText}>Publier le TagPoint</Text>
                </>}
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
        visible={editingTimeIdx !== null}
        onClose={() => setEditingTimeIdx(null)}
        onConfirm={d => {
          if (editingTimeIdx !== null) {
            setRecurringTimes(p => { const next = [...p]; next[editingTimeIdx] = d; return next; });
          }
          setEditingTimeIdx(null);
        }}
        initialDate={(editingTimeIdx !== null && recurringTimes[editingTimeIdx]) || undefined}
        mode="time"
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
            <Text style={sc.fieldTipText}>Un bon titre : activité + lieu/ambiance + niveau</Text>
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
        <View style={{ gap: 8 }}>
          {PRECISION_OPTIONS.map(p => {
            const active = precision === p.value;
            return (
              <TouchableOpacity
                key={p.value}
                style={[sc.precisionCard, active && sc.precisionCardActive]}
                onPress={() => setPrecision(p.value)}
                testID={`precision-${p.value}`}
              >
                <View style={[sc.precisionIconBox, active && { backgroundColor: Colors.primary + '22', borderColor: Colors.primary }]}>
                  <Ionicons name={p.icon} size={22} color={active ? Colors.primary : Colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[sc.precisionLabel, active && { color: Colors.primary }]}>{p.label}</Text>
                  <Text style={sc.precisionDesc}>{p.desc}</Text>
                </View>
                {active && <Ionicons name="checkmark-circle" size={22} color={Colors.primary} />}
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
function StepDate({ scheduleType, setScheduleType, eventDateTime, onOpenDatePicker, recurringDay, setRecurringDay, recurringTime, onOpenTimePicker }: any) {
  return (
    <View style={{ gap: Spacing.lg }}>
      <View style={sc.scheduleTypes}>
        {([
          { type: 'none', icon: 'ban-outline', label: 'Sans date', sub: 'Activité permanente' },
          { type: 'once', icon: 'calendar-outline', label: 'Date unique', sub: 'Événement ponctuel' },
          { type: 'recurring', icon: 'repeat-outline', label: 'Récurrent', sub: 'Chaque semaine' },
        ] as const).map(({ type, icon, label, sub }) => {
          const active = scheduleType === type;
          return (
            <TouchableOpacity
              key={type}
              style={[sc.scheduleCard, active && sc.scheduleCardActive]}
              onPress={() => setScheduleType(type)}
              testID={`schedule-${type}`}
            >
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
          <View>
            <Text style={sc.scheduleFieldLabel}>Jour de la semaine</Text>
            <View style={sc.daysRow}>
              {DAYS.map((d, i) => (
                <TouchableOpacity
                  key={d}
                  style={[sc.dayBtn, recurringDay === i && sc.dayBtnActive]}
                  onPress={() => setRecurringDay(i)}
                  testID={`day-${i}`}
                >
                  <Text style={[sc.dayText, recurringDay === i && { color: Colors.background }]}>{d}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <TouchableOpacity style={sc.dateBtn} onPress={onOpenTimePicker} testID="open-time-picker">
            <Ionicons name="time-outline" size={22} color={recurringTime ? Colors.primary : Colors.muted} />
            <Text style={recurringTime ? sc.dateBtnValue : sc.dateBtnPlaceholder}>
              {recurringTime ? fmtTime(recurringTime) : 'Choisir une heure'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Step 5: Preview ────────────────────────────────────────────────────────────
function StepPreview({ title, description, images, selectedTags, locationAddress, precision, scheduleType, eventDateTime, recurringDay, recurringTime, quality, lang }: any) {
  const scheduleLabel = scheduleType === 'none' ? 'Sans date' : scheduleType === 'once' && eventDateTime
    ? `${fmtDate(eventDateTime)} à ${fmtTime(eventDateTime)}`
    : scheduleType === 'recurring' && recurringDay !== null && recurringTime
      ? `Chaque ${DAYS[recurringDay]} à ${fmtTime(recurringTime)}`
      : 'Non configuré';

  const items = [
    { icon: 'camera-outline', label: 'Photos', value: images.length > 0 ? `${images.length} photo${images.length > 1 ? 's' : ''}` : null, tip: 'Aucune photo', done: images.length > 0 },
    { icon: 'text-outline', label: 'Titre', value: title || null, tip: 'Manquant', done: !!title },
    { icon: 'document-text-outline', label: 'Description', value: description ? `${description.length} caractères` : null, tip: 'Non renseignée', done: !!description },
    { icon: 'pricetags-outline', label: 'Tags', value: selectedTags.length > 0 ? `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}` : null, tip: 'Aucun tag', done: selectedTags.length > 0 },
    { icon: 'location-outline', label: 'Lieu', value: locationAddress, tip: 'Non défini', done: true },
    { icon: 'calendar-outline', label: 'Date', value: scheduleType !== 'none' ? scheduleLabel : null, tip: 'Sans date', done: scheduleType !== 'none' },
  ];

  return (
    <View style={{ gap: Spacing.lg }}>
      {/* Quality score card */}
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

      {/* Checklist */}
      <View style={sc.previewCard}>
        <Text style={sc.previewCardTitle}>Récapitulatif</Text>
        {items.map((item, i) => (
          <View key={i} style={[sc.previewRow, i < items.length - 1 && sc.previewRowBorder]}>
            <Ionicons name={item.icon as any} size={18} color={item.done ? Colors.primary : Colors.muted} />
            <Text style={sc.previewRowLabel}>{item.label}</Text>
            <Text style={[sc.previewRowValue, !item.done && { color: Colors.muted, fontStyle: 'italic' }]} numberOfLines={1}>
              {item.value || item.tip}
            </Text>
            <Ionicons
              name={item.done ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={item.done ? Colors.primary : Colors.muted}
            />
          </View>
        ))}
      </View>

      {quality.score < 50 && (
        <View style={sc.improveTip}>
          <Ionicons name="sparkles-outline" size={16} color={Colors.primary} />
          <Text style={sc.improveTipText}>
            {!images.length ? 'Ajoutez des photos pour booster l\'attractivité.' :
             !description ? 'Une description complète fidélise les participants.' :
             !selectedTags.length ? 'Des tags améliorent la découverte de votre tagPoint.' :
             'Configurez une date pour apparaître en tête des résultats.'}
          </Text>
        </View>
      )}
    </View>
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

  // Precision
  precisionCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1.5, borderColor: Colors.border },
  precisionCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  precisionIconBox: { width: 44, height: 44, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  precisionLabel: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  precisionDesc: { fontSize: 12, color: Colors.muted, marginTop: 2 },

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
  dateBtnValue: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  dateBtnSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  dateBtnPlaceholder: { fontSize: 15, color: Colors.muted },
  scheduleFieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dayBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.border },
  dayBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: 11, fontWeight: '700', color: Colors.muted },

  // Preview
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
