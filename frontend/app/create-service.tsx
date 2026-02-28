import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator, Modal, Dimensions,
} from 'react-native';

const { height: SH } = Dimensions.get('window');
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LocationPicker } from '../components/LocationPicker';
import { WeekCalendar } from '../components/WeekCalendar';
import type { DaySlot } from '../components/WeekCalendar';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { Colors, Spacing, Radius } from '../constants/Colors';

// ─── Constants ────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';
const GREEN = '#1DBF73';

const STEP_LABELS = ['Infos', 'Domaine', 'Config', 'Résumé'];
const DURATIONS = [30, 45, 60, 90, 120];

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
  tagIds: string[], price: string, slots: DaySlot[]
) {
  const criteria = [
    { label: 'Titre renseigné (5+ car.)', ok: title.trim().length >= 5, pts: 20 },
    { label: 'Description du coach (50+ car.)', ok: coachDesc.trim().length >= 50, pts: 20 },
    { label: 'Adresse renseignée', ok: address.trim().length > 0, pts: 10 },
    { label: 'Tags sélectionnés', ok: tagIds.length > 0, pts: 15 },
    { label: 'Prix défini', ok: parseFloat(price) > 0, pts: 20 },
    { label: 'Créneaux configurés', ok: slots.length > 0, pts: 15 },
  ];
  const score = criteria.filter(c => c.ok).reduce((acc, c) => acc + c.pts, 0);
  return { score, criteria };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CreateServiceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLang();
  const scrollRef = useRef<ScrollView>(null);

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  // Step 1
  const [title, setTitle] = useState('');
  const [coachDesc, setCoachDesc] = useState('');
  const [address, setAddress] = useState('');
  const [addressLat, setAddressLat] = useState<number | null>(null);
  const [addressLng, setAddressLng] = useState<number | null>(null);
  const [showLocPicker, setShowLocPicker] = useState(false);

  // Step 2 - Domain & Tags
  const [domainId, setDomainId] = useState('dom_sport');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);
  const loadVersionRef = useRef(0);

  // Step 3 - Configuration
  const [price, setPrice] = useState('');
  const [durationMin, setDurationMin] = useState(60);
  const [maxParticipants, setMaxParticipants] = useState(1);
  const [slots, setSlots] = useState<DaySlot[]>([]);

  const allTags = categories.flatMap(c => c.tags || []);
  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.tag_id));

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

  useEffect(() => { loadDomains(); }, []);
  useEffect(() => { loadCategories(); setSelectedTagIds([]); }, [domainId]);

  const loadDomains = async () => {
    try {
      const data: any[] = await api.get('/domains');
      data.sort((a, b) => (a.domain_id === 'dom_sport' ? -1 : b.domain_id === 'dom_sport' ? 1 : 0));
      setDomains(data);
    } catch {}
  };

  const loadCategories = useCallback(async () => {
    const version = ++loadVersionRef.current;
    try {
      const data = await api.get(`/tags/categories?domain_id=${domainId}`);
      if (version === loadVersionRef.current) setCategories(data);
    } catch {}
  }, [domainId]);

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev => prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]);
  };

  const goNext = () => {
    if (step === 1) {
      if (title.trim().length < 5) { Alert.alert('', 'Le titre doit avoir au moins 5 caractères'); return; }
      if (!coachDesc.trim()) { Alert.alert('', 'La description du coach est requise'); return; }
    }
    if (step === 3) {
      const p = parseFloat(price);
      if (!price || isNaN(p) || p <= 0) { Alert.alert('Prix manquant', 'Renseignez le prix par séance'); return; }
    }
    setStep(s => Math.min(s + 1, 4));
    scrollTop();
  };

  const goPrev = () => { setStep(s => Math.max(s - 1, 1)); scrollTop(); };

  // ─── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const priceNum = parseFloat(price) || 0;
      await api.post('/services', {
        title: title.trim(),
        description: coachDesc.trim() || null,
        address: address.trim() || null,
        price: priceNum,
        duration_min: durationMin,
        max_participants: maxParticipants,
        domain_id: domainId,
        tag_ids: selectedTagIds,
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
          precision: 'exact', description: address || null,
        }] : [],
        slots: [],
      });
      router.replace('/(tabs)/profile' as any);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le service');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Step Header ─────────────────────────────────────────────────────────────
  const renderStepHeader = () => (
    <View style={s.stepHeader}>
      {STEP_LABELS.map((label, idx) => {
        const num = idx + 1;
        const done = step > num;
        const active = step === num;
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

      <View style={s.field}>
        <Text style={s.fieldLabel}>Adresse principale</Text>
        <TouchableOpacity
          style={[s.addressBtn, address ? s.addressBtnFilled : null]}
          onPress={() => setShowLocPicker(true)}
          testID="address-picker-btn"
        >
          <Ionicons name="location-outline" size={18} color={address ? Colors.primary : Colors.muted} />
          <Text style={[s.addressBtnText, !address && { color: Colors.muted }]} numberOfLines={2}>
            {address || 'Sélectionner une adresse…'}
          </Text>
          {address ? (
            <TouchableOpacity onPress={() => { setAddress(''); setAddressLat(null); setAddressLng(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={Colors.muted} />
            </TouchableOpacity>
          ) : (
            <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );

  // ─── Step 2: Domaine & Tags ───────────────────────────────────────────────────
  const renderStep2 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Domaine & Tags</Text>
      <Text style={s.stepHint}>Catégorisez votre service pour être trouvé par les bons clients</Text>

      {/* Domaine */}
      <View style={s.field}>
        <Text style={s.fieldLabel}>Domaine</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 2 }}>
            {domains.map((d: any) => {
              const sel = domainId === d.domain_id;
              const col = d.color || Colors.primary;
              return (
                <TouchableOpacity
                  key={d.domain_id}
                  style={[s.domainPill, sel && { backgroundColor: col + '22', borderColor: col }]}
                  onPress={() => setDomainId(d.domain_id)}
                  testID={`domain-${d.domain_id}`}
                >
                  <Text style={[s.domainPillText, sel && { color: col, fontWeight: '700' }]}>
                    {lang === 'fr' ? d.label_fr : d.label_en}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      </View>

      {/* Tags */}
      <View style={s.field}>
        <View style={s.rowBetween}>
          <Text style={s.fieldLabel}>Tags</Text>
          {selectedTags.length > 0 && (
            <Text style={[s.fieldLabel, { color: Colors.primary }]}>
              {selectedTags.length} sélectionné{selectedTags.length > 1 ? 's' : ''}
            </Text>
          )}
        </View>
        <TouchableOpacity style={s.tagTrigger} onPress={() => setShowTagModal(true)} testID="open-tags-btn">
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
                  <View key={t.tag_id} style={[s.tagPill, { backgroundColor: c + '22', borderColor: c }]}>
                    <Text style={[s.tagPillText, { color: c }]}>{lang === 'fr' ? t.label_fr : t.label_en}</Text>
                  </View>
                );
              })}
              {selectedTags.length > 5 && (
                <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 12, alignSelf: 'center' }}>+{selectedTags.length - 5}</Text>
              )}
            </View>
          )}
          <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
        </TouchableOpacity>
        {selectedTags.length === 0 && (
          <Text style={s.fieldTip}>Les tags permettent à votre service d'apparaître dans les recherches filtrées</Text>
        )}
      </View>
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
          {price && !isNaN(parseFloat(price)) && parseFloat(price) > 0 && (
            <Text style={s.netEarning}>
              Commission 15 % · Gain net : <Text style={{ fontWeight: '700', color: GREEN }}>{(parseFloat(price) * 0.85).toFixed(2)} €</Text>
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

  // ─── Step 4: Résumé & Score ───────────────────────────────────────────────────
  const { score, criteria } = useMemo(
    () => computeScore(title, coachDesc, address, selectedTagIds, price, slots),
    [title, coachDesc, address, selectedTagIds, price, slots]
  );
  const scoreColor = score >= 80 ? GREEN : score >= 50 ? ORANGE : Colors.destructive;
  const selectedDomain = domains.find(d => d.domain_id === domainId);

  const renderStep4 = () => (
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
        {selectedDomain && (
          <View style={s.summaryRow}>
            <Ionicons name="grid-outline" size={14} color={Colors.primary} />
            <Text style={s.summaryMeta}>{lang === 'fr' ? selectedDomain.label_fr : selectedDomain.label_en}</Text>
            {selectedTags.length > 0 && (
              <Text style={s.summaryMeta}> · {selectedTags.slice(0, 3).map((t: any) => lang === 'fr' ? t.label_fr : t.label_en).join(', ')}</Text>
            )}
          </View>
        )}
        <View style={s.summaryStatsRow}>
          {price ? <View style={s.statChip}><Text style={s.statChipText}>{price} €/séance</Text></View> : null}
          <View style={s.statChip}><Text style={s.statChipText}>{durationMin} min</Text></View>
          <View style={s.statChip}><Text style={s.statChipText}>{maxParticipants} pers. max</Text></View>
          <View style={s.statChip}><Text style={s.statChipText}>{slots.length} créneau{slots.length !== 1 ? 'x' : ''}</Text></View>
        </View>
      </View>
    </View>
  );

  // ─── Tag Modal ────────────────────────────────────────────────────────────────
  const renderTagModal = () => (
    <Modal visible={showTagModal} animationType="slide" transparent onRequestClose={() => setShowTagModal(false)}>
      <View style={s.tagModalOverlay}>
        <TouchableOpacity style={s.tagModalBackdrop} activeOpacity={1} onPress={() => setShowTagModal(false)} />
        <View style={s.tagModalSheet}>
          <View style={s.sheetHandle} />
          <View style={s.tagModalHeader}>
            <TouchableOpacity onPress={() => setShowTagModal(false)}>
              <Text style={s.modalCancel}>Annuler</Text>
            </TouchableOpacity>
            <Text style={s.tagModalTitle}>Choisir des tags</Text>
            <TouchableOpacity onPress={() => setShowTagModal(false)} testID="close-tag-modal">
              <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {selectedTagIds.length > 0 && (
            <View style={s.selectedBanner}>
              <Text style={s.selectedBannerText}>{selectedTagIds.length} tag{selectedTagIds.length > 1 ? 's' : ''} sélectionné{selectedTagIds.length > 1 ? 's' : ''}</Text>
              <TouchableOpacity onPress={() => setSelectedTagIds([])}>
                <Text style={s.clearText}>Effacer</Text>
              </TouchableOpacity>
            </View>
          )}
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: Spacing.md, paddingBottom: 50 }}
            showsVerticalScrollIndicator={false}
          >
            {categories.filter(c => (c.tags || []).length > 0).map((cat: any) => {
              const col = tagColor(cat.category_id);
              return (
                <View key={cat.category_id} style={s.catGroup}>
                  <View style={s.catRow}>
                    <View style={[s.catDot, { backgroundColor: col }]} />
                    <Text style={s.catLabel}>{lang === 'fr' ? cat.label_fr : cat.label_en}</Text>
                  </View>
                  <View style={s.tagsWrap}>
                    {(cat.tags || []).map((tag: any) => {
                      const sel = selectedTagIds.includes(tag.tag_id);
                      return (
                        <TouchableOpacity
                          key={tag.tag_id}
                          style={[s.tagChip, sel && { backgroundColor: col + '22', borderColor: col }]}
                          onPress={() => toggleTag(tag.tag_id)}
                          testID={`tag-chip-${tag.tag_id}`}
                        >
                          {sel && <Ionicons name="checkmark" size={12} color={col} style={{ marginRight: 3 }} />}
                          <Text style={[s.tagChipText, sel && { color: col, fontWeight: '700' }]}>
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
  );

  // ─── Main Render ──────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBackBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Créer un service</Text>
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
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </ScrollView>

        {/* Bottom navigation */}
        <View style={s.bottomNav}>
          {step > 1 ? (
            <TouchableOpacity style={s.prevBtn} onPress={goPrev} testID="prev-step-btn">
              <Ionicons name="chevron-back" size={18} color={Colors.foreground} />
              <Text style={s.prevBtnText}>Précédent</Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}

          {step < 4 ? (
            <TouchableOpacity style={s.nextBtn} onPress={goNext} testID="next-step-btn">
              <Text style={s.nextBtnText}>{step === 3 ? 'Voir le résumé' : 'Suivant'}</Text>
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
                    <Ionicons name="rocket-outline" size={18} color={Colors.background} />
                    <Text style={s.nextBtnText}>Publier mon service</Text>
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

      {/* Tag modal */}
      {renderTagModal()}
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
});
