import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LocationPicker } from '../components/LocationPicker';
import { WeekCalendar } from '../components/WeekCalendar';
import type { DaySlot } from '../components/WeekCalendar';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Colors, Spacing, Radius } from '../constants/Colors';

// ─── Constants ────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';
const GREEN = '#1DBF73';

const STEP_LABELS = ['Infos', 'Services', 'Config', 'Résumé'];
const DURATIONS = [30, 45, 60, 90, 120];

const PACKAGE_TYPES = [
  { type_id: 'individual', type_label: 'Cours individuel', icon: 'person-outline', desc: 'Séance 1-on-1 avec le coach' },
  { type_id: 'group_small', type_label: 'Petit groupe', icon: 'people-outline', desc: '2 à 8 personnes' },
  { type_id: 'group_large', type_label: 'Grand groupe', icon: 'people-circle-outline', desc: '8+ personnes' },
  { type_id: 'intensive', type_label: 'Stage intensif', icon: 'flame-outline', desc: 'Format immersif multi-jours' },
  { type_id: 'online', type_label: 'Coaching en ligne', icon: 'videocam-outline', desc: 'Suivi à distance' },
  { type_id: 'workshop', type_label: 'Atelier collectif', icon: 'construct-outline', desc: 'Atelier thématique collectif' },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface PackageConfig {
  type_id: string;
  type_label: string;
  icon: string;
  duration_min: number;
  max_participants: number;
  price: string;
  slots: DaySlot[];
}

// ─── Score computation ────────────────────────────────────────────────────────
function computeScore(
  title: string, coachDesc: string, address: string, pkgs: PackageConfig[]
) {
  const criteria = [
    { label: 'Titre renseigné (5+ car.)', ok: title.trim().length >= 5, pts: 20 },
    { label: 'Description du coach (50+ car.)', ok: coachDesc.trim().length >= 50, pts: 20 },
    { label: 'Adresse renseignée', ok: address.trim().length > 0, pts: 15 },
    { label: 'Au moins 1 type de prestation', ok: pkgs.length > 0, pts: 15 },
    { label: 'Prix défini pour chaque prestation', ok: pkgs.length > 0 && pkgs.every(p => parseFloat(p.price) > 0), pts: 15 },
    { label: 'Créneaux configurés', ok: pkgs.length > 0 && pkgs.every(p => p.slots.length > 0), pts: 15 },
  ];
  const score = criteria.filter(c => c.ok).reduce((acc, c) => acc + c.pts, 0);
  return { score, max: 100, criteria };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CreateServiceScreen() {
  const router = useRouter();
  const { user } = useAuth();
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

  // Step 2
  const [selectedTypeIds, setSelectedTypeIds] = useState<string[]>([]);

  // Step 3
  const [pkgConfigs, setPkgConfigs] = useState<PackageConfig[]>([]);
  const [activePkgIdx, setActivePkgIdx] = useState(0);

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

  // Keep activePkgIdx in bounds
  useEffect(() => {
    if (activePkgIdx >= pkgConfigs.length && pkgConfigs.length > 0) {
      setActivePkgIdx(pkgConfigs.length - 1);
    }
  }, [pkgConfigs.length]);

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });

  // Sync pkgConfigs when entering Step 3
  const syncPackageConfigs = (typeIds: string[]) => {
    setPkgConfigs(prev => {
      return typeIds.map(tid => {
        const existing = prev.find(p => p.type_id === tid);
        if (existing) return existing;
        const typeInfo = PACKAGE_TYPES.find(t => t.type_id === tid)!;
        const defaultMax = tid === 'individual' ? 1 : tid === 'group_small' ? 6 : 12;
        return {
          type_id: tid,
          type_label: typeInfo.type_label,
          icon: typeInfo.icon,
          duration_min: 60,
          max_participants: defaultMax,
          price: '',
          slots: [],
        };
      });
    });
    setActivePkgIdx(0);
  };

  const goNext = () => {
    if (step === 1) {
      if (title.trim().length < 5) { Alert.alert('', 'Le titre doit avoir au moins 5 caractères'); return; }
      if (!coachDesc.trim()) { Alert.alert('', 'La description du coach est requise'); return; }
    }
    if (step === 2) {
      if (selectedTypeIds.length === 0) { Alert.alert('', 'Sélectionnez au moins un type de prestation'); return; }
      syncPackageConfigs(selectedTypeIds);
    }
    if (step === 3) {
      for (const pkg of pkgConfigs) {
        const p = parseFloat(pkg.price);
        if (!pkg.price || isNaN(p) || p <= 0) {
          Alert.alert('Prix manquant', `Renseignez le prix pour "${pkg.type_label}"`);
          return;
        }
      }
    }
    setStep(s => Math.min(s + 1, 4));
    scrollTop();
  };

  const goPrev = () => { setStep(s => Math.max(s - 1, 1)); scrollTop(); };

  const updatePkg = (idx: number, updates: Partial<PackageConfig>) => {
    setPkgConfigs(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...updates };
      return next;
    });
  };

  const toggleTypeId = (tid: string) => {
    setSelectedTypeIds(prev =>
      prev.includes(tid) ? prev.filter(id => id !== tid) : [...prev, tid]
    );
  };

  // ─── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const minPrice = pkgConfigs.length > 0
        ? Math.min(...pkgConfigs.map(p => parseFloat(p.price) || 0))
        : 0;

      await api.post('/services', {
        title: title.trim(),
        description: coachDesc.trim() || null,
        address: address.trim() || null,
        price: minPrice,
        packages: pkgConfigs.map(pkg => ({
          type_id: pkg.type_id,
          type_label: pkg.type_label,
          duration_min: pkg.duration_min,
          max_participants: pkg.max_participants,
          price: parseFloat(pkg.price) || 0,
          slots: pkg.slots.map(s => ({
            slot_date: s.date,
            start_time: s.startTime,
            end_time: s.endTime,
          })),
        })),
        locations: addressLat !== null && addressLng !== null ? [{
          latitude: addressLat,
          longitude: addressLng,
          precision: 'exact',
          description: address || null,
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

  // ─── Step 2: Types de prestations ────────────────────────────────────────────
  const renderStep2 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Types de prestations</Text>
      <Text style={s.stepHint}>Sélectionnez les types de séances que vous proposez</Text>

      {PACKAGE_TYPES.map(pt => {
        const active = selectedTypeIds.includes(pt.type_id);
        return (
          <TouchableOpacity
            key={pt.type_id}
            style={[s.pkgTypeCard, active && s.pkgTypeCardActive]}
            onPress={() => toggleTypeId(pt.type_id)}
            testID={`pkg-type-${pt.type_id}`}
          >
            <View style={[s.pkgTypeIcon, active && s.pkgTypeIconActive]}>
              <Ionicons name={pt.icon as any} size={24} color={active ? ORANGE : Colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.pkgTypeLabel, active && { color: Colors.foreground }]}>{pt.type_label}</Text>
              <Text style={s.pkgTypeDesc}>{pt.desc}</Text>
            </View>
            <View style={[s.pkgTypeCheck, active && s.pkgTypeCheckActive]}>
              {active && <Ionicons name="checkmark" size={14} color={Colors.background} />}
            </View>
          </TouchableOpacity>
        );
      })}

      {selectedTypeIds.length > 0 && (
        <View style={s.selectionSummary}>
          <Ionicons name="checkmark-circle" size={16} color={GREEN} />
          <Text style={s.selectionSummaryText}>
            {selectedTypeIds.length} prestation{selectedTypeIds.length > 1 ? 's' : ''} sélectionnée{selectedTypeIds.length > 1 ? 's' : ''}
          </Text>
        </View>
      )}
    </View>
  );

  // ─── Step 3: Configuration ────────────────────────────────────────────────────
  const renderStep3 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Configuration</Text>
      <Text style={s.stepHint}>Configurez les détails de chaque type de prestation</Text>

      {/* Package tabs */}
      {pkgConfigs.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 8, paddingBottom: 2 }}>
            {pkgConfigs.map((pkg, i) => (
              <TouchableOpacity
                key={pkg.type_id}
                style={[s.pkgTab, activePkgIdx === i && s.pkgTabActive]}
                onPress={() => setActivePkgIdx(i)}
                testID={`pkg-tab-${i}`}
              >
                <Ionicons name={pkg.icon as any} size={14} color={activePkgIdx === i ? ORANGE : Colors.muted} />
                <Text style={[s.pkgTabText, activePkgIdx === i && { color: ORANGE }]}>{pkg.type_label}</Text>
                {pkg.slots.length > 0 && (
                  <View style={s.pkgTabBadge}>
                    <Text style={s.pkgTabBadgeText}>{pkg.slots.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {pkgConfigs.length > 0 && (() => {
        const pkg = pkgConfigs[activePkgIdx];
        if (!pkg) return null;
        return (
          <View style={s.pkgConfigCard}>
            {/* Header */}
            <View style={s.pkgConfigHeader}>
              <View style={s.pkgConfigIconBox}>
                <Ionicons name={pkg.icon as any} size={20} color={ORANGE} />
              </View>
              <Text style={s.pkgConfigTitle}>{pkg.type_label}</Text>
            </View>

            {/* Prix */}
            <View style={s.field}>
              <Text style={s.fieldLabel}>Prix (€) par séance *</Text>
              <TextInput
                style={s.input}
                value={pkg.price}
                onChangeText={v => updatePkg(activePkgIdx, { price: v })}
                placeholder="Ex: 60"
                placeholderTextColor={Colors.muted}
                keyboardType="decimal-pad"
                testID={`pkg-price-${activePkgIdx}`}
              />
              {pkg.price && !isNaN(parseFloat(pkg.price)) && parseFloat(pkg.price) > 0 && (
                <Text style={s.netEarning}>
                  Commission 15 % · Gain net : <Text style={{ fontWeight: '700', color: GREEN }}>{(parseFloat(pkg.price) * 0.85).toFixed(2)} €</Text>
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
                    style={[s.chip, pkg.duration_min === d && s.chipActive]}
                    onPress={() => updatePkg(activePkgIdx, { duration_min: d })}
                    testID={`duration-${d}-${activePkgIdx}`}
                  >
                    <Text style={[s.chipText, pkg.duration_min === d && s.chipTextActive]}>{d} min</Text>
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
                  onPress={() => updatePkg(activePkgIdx, { max_participants: Math.max(1, pkg.max_participants - 1) })}
                  testID={`max-dec-${activePkgIdx}`}
                >
                  <Ionicons name="remove" size={18} color={Colors.foreground} />
                </TouchableOpacity>
                <Text style={s.stepperVal}>{pkg.max_participants}</Text>
                <TouchableOpacity
                  style={s.stepperBtn}
                  onPress={() => updatePkg(activePkgIdx, { max_participants: Math.min(100, pkg.max_participants + 1) })}
                  testID={`max-inc-${activePkgIdx}`}
                >
                  <Ionicons name="add" size={18} color={Colors.foreground} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Calendrier */}
            <View style={s.field}>
              <Text style={s.fieldLabel}>Créneaux horaires</Text>
              <WeekCalendar
                slots={pkg.slots}
                durationMin={pkg.duration_min}
                onSlotsChange={newSlots => updatePkg(activePkgIdx, { slots: newSlots })}
              />
            </View>
          </View>
        );
      })()}
    </View>
  );

  // ─── Step 4: Résumé & Score ───────────────────────────────────────────────────
  const { score, criteria } = useMemo(
    () => computeScore(title, coachDesc, address, pkgConfigs),
    [title, coachDesc, address, pkgConfigs]
  );
  const pct = score;
  const scoreColor = pct >= 80 ? GREEN : pct >= 50 ? ORANGE : Colors.destructive;

  const renderStep4 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Résumé & Publication</Text>

      {/* Score de complétion */}
      <View style={[s.scoreCard, { borderColor: scoreColor + '40' }]}>
        <View style={s.scoreHeader}>
          <View style={[s.scoreBadge, { backgroundColor: scoreColor }]}>
            <Text style={s.scoreBadgeText}>{pct}</Text>
            <Text style={s.scoreBadgeSub}>/100</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.scoreTitle, { color: scoreColor }]}>
              {pct === 100 ? 'Service parfait !' : pct >= 80 ? 'Très bon service !' : pct >= 50 ? 'Service correct' : 'Complétez votre service'}
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

      {/* Résumé service */}
      <View style={s.summaryCard}>
        <Text style={s.summaryTitle}>{title}</Text>
        {coachDesc.length > 0 && (
          <Text style={s.summaryDesc} numberOfLines={3}>{coachDesc}</Text>
        )}
        {address.length > 0 && (
          <View style={s.summaryRow}>
            <Ionicons name="location-outline" size={14} color={ORANGE} />
            <Text style={s.summaryMeta}>{address}</Text>
          </View>
        )}
      </View>

      {/* Prestations */}
      {pkgConfigs.length > 0 && (
        <View style={s.pkgSummarySection}>
          <Text style={s.summarySectionTitle}>Prestations ({pkgConfigs.length})</Text>
          {pkgConfigs.map((pkg, i) => (
            <View key={i} style={s.pkgSummaryRow}>
              <View style={s.pkgSummaryIconBox}>
                <Ionicons name={pkg.icon as any} size={16} color={ORANGE} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.pkgSummaryLabel}>{pkg.type_label}</Text>
                <Text style={s.pkgSummaryMeta}>
                  {pkg.price ? `${pkg.price} €` : '—'} · {pkg.duration_min} min · {pkg.max_participants} pers. max · {pkg.slots.length} créneau{pkg.slots.length !== 1 ? 'x' : ''}
                </Text>
              </View>
              <Ionicons
                name={pkg.slots.length > 0 && parseFloat(pkg.price) > 0 ? 'checkmark-circle' : 'alert-circle-outline'}
                size={18}
                color={pkg.slots.length > 0 && parseFloat(pkg.price) > 0 ? GREEN : ORANGE}
              />
            </View>
          ))}
        </View>
      )}
    </View>
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
                : <><Ionicons name="rocket-outline" size={18} color={Colors.background} /><Text style={s.nextBtnText}>Publier mon service</Text></>}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Location picker modal */}
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
  // Step 2 - package type cards
  pkgTypeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 16,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  pkgTypeCardActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  pkgTypeIcon: {
    width: 46, height: 46, borderRadius: 14, backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  pkgTypeIconActive: { backgroundColor: ORANGE + '20' },
  pkgTypeLabel: { fontSize: 15, fontWeight: '700', color: Colors.muted },
  pkgTypeDesc: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  pkgTypeCheck: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  pkgTypeCheckActive: { backgroundColor: ORANGE, borderColor: ORANGE },
  selectionSummary: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: GREEN + '15', borderRadius: Radius.md, padding: 10,
    borderWidth: 1, borderColor: GREEN + '30',
  },
  selectionSummaryText: { fontSize: 13, fontWeight: '600', color: GREEN },
  // Step 3 - config
  pkgTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  pkgTabActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  pkgTabText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  pkgTabBadge: {
    minWidth: 16, height: 16, borderRadius: 8, backgroundColor: ORANGE,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  pkgTabBadgeText: { fontSize: 9, fontWeight: '800', color: Colors.background },
  pkgConfigCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: Colors.border, gap: 16,
  },
  pkgConfigHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pkgConfigIconBox: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: ORANGE + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  pkgConfigTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground, flex: 1 },
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
    width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.card,
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
  // Summary
  summaryCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md,
    borderWidth: 1, borderColor: ORANGE_BORDER, gap: 8,
  },
  summaryTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  summaryDesc: { fontSize: 13, color: Colors.muted, lineHeight: 19 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryMeta: { fontSize: 13, color: Colors.foreground, flex: 1 },
  pkgSummarySection: { gap: 8 },
  summarySectionTitle: { fontSize: 14, fontWeight: '700', color: ORANGE, marginBottom: 2 },
  pkgSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: Radius.lg, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  pkgSummaryIconBox: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: ORANGE + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  pkgSummaryLabel: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  pkgSummaryMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
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
});
