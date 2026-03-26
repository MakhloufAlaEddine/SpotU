/**
 * ProductCreationFlow — orchestrateur du flow de création produit.
 * Stepper violet (couleur produit), 7 étapes guidées.
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Animated, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/api';
import { uploadImage } from '../../lib/imageUpload';
import {
  useProductForm,
  calcProductQuality,
  validateStep,
} from './ProductFormContext';
import { Step1TypeCategory }     from './steps/Step1TypeCategory';
import { Step2MainInfo }         from './steps/Step2MainInfo';
import { Step3Photos }           from './steps/Step3Photos';
import { Step4RentalConditions } from './steps/Step4RentalConditions';
import { Step5Availability }     from './steps/Step5Availability';
import { Step6SpotYouLink }      from './steps/Step6SpotYouLink';
import { Step7Summary }          from './steps/Step7Summary';

const VIOLET      = '#8B5CF6';
const VIOLET_DIM  = 'rgba(139,92,246,0.12)';
const TOTAL_STEPS = 7;

const STEP_CONFIG = [
  { title: 'Type & Catégorie',    subtitle: 'Quel matériel louez-vous ?',     icon: 'pricetag-outline',          tip: 'Choisissez le type de produit et sa catégorie pour aider les locataires à vous trouver.' },
  { title: 'Informations',        subtitle: 'Titre, description, prix',        icon: 'document-text-outline',    tip: 'Un titre clair et une bonne description augmentent les chances de location.' },
  { title: 'Photos',              subtitle: 'Montrez votre matériel',          icon: 'camera-outline',            tip: 'Les annonces avec 3+ photos nettes génèrent 3x plus de réservations.' },
  { title: 'Conditions',          subtitle: 'Règles et mode de remise',        icon: 'shield-checkmark-outline',  tip: 'Des conditions claires évitent les malentendus et protègent tout le monde.' },
  { title: 'Disponibilité',       subtitle: 'Où et quand ?',                   icon: 'map-outline',               tip: 'La localisation aide les locataires proches à vous trouver facilement.' },
  { title: 'SpotYou',             subtitle: 'Associer un contexte',            icon: 'pin-outline',               tip: 'Lier à un SpotYou permet aux membres de cette communauté de trouver votre produit.' },
  { title: 'Publication',         subtitle: 'Aperçu & validation',             icon: 'eye-outline',               tip: 'Vérifiez tout avant de soumettre. Un admin validera votre annonce sous 24h.' },
] as const;

const STEP_COMPONENTS = [
  Step1TypeCategory,
  Step2MainInfo,
  Step3Photos,
  Step4RentalConditions,
  Step5Availability,
  Step6SpotYouLink,
  Step7Summary,
];

export function ProductCreationFlow({ isEditMode = false }: { isEditMode?: boolean }) {
  const router = useRouter();
  const { token } = useAuth();
  const { form, reset } = useProductForm();

  const [step, setStep]               = useState(0); // 0-indexed
  const [error, setError]             = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const quality = calcProductQuality(form);
  const cfg     = STEP_CONFIG[step];
  const isLast  = step === TOTAL_STEPS - 1;

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });

  /* ── Navigation ──────────────────────────────────────────────────────── */
  const goNext = () => {
    const err = validateStep(step + 1, form); // steps are 1-indexed in validator
    if (err) { setError(err); return; }
    setError(null);
    setStep(s => Math.min(s + 1, TOTAL_STEPS - 1));
    scrollTop();
  };

  const goBack = () => {
    if (step === 0) {
      Alert.alert(
        isEditMode ? 'Quitter la modification ?' : 'Quitter la création ?',
        isEditMode
          ? 'Les modifications non enregistrées seront perdues.'
          : 'Votre progression sera perdue.',
        [
          { text: 'Continuer', style: 'cancel' },
          { text: 'Quitter', style: 'destructive', onPress: () => { reset(); router.back(); } },
        ]
      );
      return;
    }
    setError(null);
    setStep(s => s - 1);
    scrollTop();
  };

  /* ── Upload des images ──────────────────────────────────────────────── */
  const uploadAllImages = async (): Promise<string[]> => {
    const uploaded: string[] = [];
    for (const uri of form.images) {
      if (uri.startsWith('http')) {
        uploaded.push(uri); // Déjà uploadé
      } else {
        const url = await uploadImage(uri, token || '', 'products');
        if (url) uploaded.push(url);
      }
    }
    return uploaded;
  };

  /* ── Soumission ─────────────────────────────────────────────────────── */
  const submit = async (status: 'draft' | 'pending_review') => {
    const err = validateStep(7, form);
    if (err && status === 'pending_review') { setError(err); return; }
    setError(null);
    setIsSubmitting(true);

    try {
      const imageUrls   = await uploadAllImages();
      const coverImg    = imageUrls[0] || null;

      const payload = {
        product_id:           form.product_id,
        product_type:         form.product_type,
        category:             form.category,
        subcategory:          form.subcategory,
        title:                form.title.trim(),
        short_description:    form.short_description.trim(),
        description:          form.description.trim(),
        condition_label:      form.condition_label,
        included_items:       form.included_items.trim(),
        brand_model:          form.brand_model.trim(),
        size_dimensions:      form.size_dimensions.trim(),
        price:                Number(form.price.replace(',', '.') || '0'),
        pricing_type:         form.pricing_type,
        available_quantity:   parseInt(form.available_quantity || '1', 10),
        cover_image_url:      coverImg,
        image_url:            coverImg,
        image_urls:           imageUrls,
        deposit_required:     form.deposit_required,
        deposit_amount:       form.deposit_amount ? Number(form.deposit_amount.replace(',', '.')) : null,
        max_duration_days:    form.max_duration_days ? parseInt(form.max_duration_days, 10) : null,
        pickup_type:          form.pickup_type,
        pickup_notes:         form.pickup_notes.trim(),
        return_rules:         form.return_rules.trim(),
        cancellation_rules:   form.cancellation_rules.trim(),
        city:                 form.city.trim(),
        lat:                  form.selectedLat || null,
        lng:                  form.selectedLng || null,
        location_privacy:     form.location_privacy,
        radius_km:            form.location_privacy === 'exact' ? 0 : form.location_privacy === '100m' ? 0.1 : 1.0,
        availability_note:    form.availability_note.trim(),
        related_spotyou_ids:  form.related_spotyou_ids,
        delivery_modes:       form.pickup_type ? [form.pickup_type] : [],
        status,
        currency:             'EUR',
      };

      const res = await api.post('/products', payload) as { product_id: string };

      Alert.alert(
        status === 'pending_review' ? 'Soumis pour validation !' : 'Brouillon enregistré !',
        status === 'pending_review'
          ? 'Ton produit est en cours de révision par nos équipes. Tu seras notifié dès qu\'il est validé.'
          : 'Ton brouillon est enregistré. Tu peux le retrouver dans "Mes produits".',
        [{ text: 'OK', onPress: () => { reset(); router.replace('/products/my-products' as any); } }],
      );
    } catch (e: any) {
      setError(e?.message || 'Une erreur est survenue. Réessaie.');
    } finally {
      setIsSubmitting(false);
    }
  };

  /* ── Rendu ──────────────────────────────────────────────────────────── */
  const StepComponent = STEP_COMPONENTS[step] as any;

  return (
    <SafeAreaView style={c.root} edges={['top', 'bottom']}>

      {/* ── En-tête ───────────────────────────────────────────────────── */}
      <View style={c.header}>
        <TouchableOpacity style={c.backBtn} onPress={goBack} testID="product-flow-back">
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={c.stepCount}>Étape {step + 1} / {TOTAL_STEPS}</Text>
          <Text style={c.stepTitle}>{cfg.title}</Text>
        </View>

        {/* Score qualité */}
        <View style={[c.qualityBadge, { backgroundColor: quality.color + '18' }]}>
          <Text style={[c.qualityScore, { color: quality.color }]}>{quality.score}</Text>
          <Text style={c.qualityMax}>/100</Text>
        </View>
      </View>

      {/* ── Barre de progression ─────────────────────────────────────── */}
      <View style={c.progressBar}>
        <View style={[c.progressFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` as any }]} />
      </View>

      {/* ── Dots d'étapes ────────────────────────────────────────────── */}
      <View style={c.dotsRow}>
        {STEP_CONFIG.map((s_cfg, i) => (
          <TouchableOpacity
            key={i}
            style={[c.dot, i <= step && c.dotActive, i === step && c.dotCurrent]}
            onPress={() => i < step && setStep(i)}
          >
            {i < step
              ? <Ionicons name="checkmark" size={10} color="#fff" />
              : <Text style={[c.dotNum, i === step && { color: '#fff' }]}>{i + 1}</Text>}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Tip ──────────────────────────────────────────────────────── */}
      <View style={c.tipBanner}>
        <Ionicons name="bulb-outline" size={14} color={VIOLET} />
        <Text style={c.tipText} numberOfLines={2}>{cfg.tip}</Text>
      </View>

      {/* ── Contenu étape ────────────────────────────────────────────── */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={c.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 6 ? (
          <Step7Summary
            onSaveDraft={() => submit('draft')}
            onPublish={() => submit('pending_review')}
            isSubmitting={isSubmitting}
          />
        ) : (
          <StepComponent />
        )}

        {/* Erreur de validation */}
        {error && (
          <View style={c.errorBanner} testID="step-error-banner">
            <Ionicons name="alert-circle" size={16} color="#EF4444" />
            <Text style={c.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>

      {/* ── Navigation bottom ────────────────────────────────────────── */}
      {!isLast && (
        <View style={c.navBar}>
          {step > 0 && (
            <TouchableOpacity style={c.prevBtn} onPress={goBack} testID="prev-step-btn">
              <Ionicons name="arrow-back" size={18} color={Colors.foreground} />
              <Text style={c.prevBtnText}>Précédent</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[c.nextBtn, step === 0 && { flex: 1 }]}
            onPress={goNext}
            disabled={isSubmitting}
            testID="next-step-btn"
          >
            <Text style={c.nextBtnText}>
              {step === 5 ? 'Voir le récapitulatif' : 'Suivant'}
            </Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

    </SafeAreaView>
  );
}

const c = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingVertical: 12 },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  stepCount:     { fontSize: 11, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  stepTitle:     { fontSize: 16, fontWeight: '800', color: Colors.foreground, marginTop: 1 },
  qualityBadge:  { flexDirection: 'row', alignItems: 'baseline', gap: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  qualityScore:  { fontSize: 18, fontWeight: '900' },
  qualityMax:    { fontSize: 11, color: Colors.muted },
  progressBar:   { height: 3, backgroundColor: Colors.border, marginHorizontal: Spacing.md, borderRadius: 2, overflow: 'hidden' },
  progressFill:  { height: '100%', backgroundColor: VIOLET, borderRadius: 2 },
  dotsRow:       { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 10 },
  dot:           { width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  dotActive:     { borderColor: VIOLET, backgroundColor: VIOLET },
  dotCurrent:    { backgroundColor: VIOLET, borderColor: VIOLET, width: 30, height: 30, borderRadius: 15 },
  dotNum:        { fontSize: 10, fontWeight: '700', color: Colors.muted },
  tipBanner:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginHorizontal: Spacing.md, marginBottom: 8, backgroundColor: VIOLET_DIM, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: VIOLET + '28' },
  tipText:       { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },
  content:       { paddingHorizontal: Spacing.md, paddingTop: 4, paddingBottom: 100 },
  errorBanner:   { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEE2E2', borderRadius: Radius.md, padding: Spacing.md, marginTop: Spacing.md, borderWidth: 1, borderColor: '#FECACA' },
  errorText:     { flex: 1, fontSize: 13, color: '#DC2626', fontWeight: '600' },
  navBar:        { flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  prevBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 14, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  prevBtnText:   { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  nextBtn:       { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: Radius.full, backgroundColor: VIOLET },
  nextBtnText:   { fontSize: 14, fontWeight: '700', color: '#fff' },
});
