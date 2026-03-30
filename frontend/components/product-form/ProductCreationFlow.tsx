/**
 * ProductCreationFlow — orchestrateur du flow de création produit.
 * Stepper bleu (couleur produit), 9 étapes légères (sans scroll par étape).
 */
import React, { useState, useRef, useEffect, createContext, useContext } from 'react';

import { FlowScrollCtx } from './FlowScrollContext';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  Animated, Alert, ActivityIndicator, KeyboardAvoidingView, Platform,
  Keyboard,
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
  getMinPrice,
} from './ProductFormContext';
import { Step1TypeCategory }  from './steps/Step1TypeCategory';
import { Step2Essential }     from './steps/Step2Essential';
import { Step3Photos }        from './steps/Step3Photos';
import { Step5Pricing }       from './steps/Step5Pricing';
import { Step6Logistics }     from './steps/Step6Logistics';
import { Step5Availability }  from './steps/Step5Availability';
import { StepDetailsRules }   from './steps/StepDetailsRules';
import { Step7Summary }       from './steps/Step7Summary';

const BLUE      = '#3B82F6';
const BLUE_DIM  = 'rgba(59,130,246,0.12)';
const TOTAL_STEPS = 8;

const STEP_CONFIG = [
  { title: 'Classification',   subtitle: 'Type, catégorie & tags',         icon: 'pricetag-outline',         tip: 'Les tags définissent où votre produit apparaît — choisissez-les avec soin.' },
  { title: 'L\'essentiel',     subtitle: 'Titre, état & quantité',          icon: 'create-outline',           tip: 'Un titre précis attire plus de locataires. Soyez descriptif.' },
  { title: 'Photos',           subtitle: 'Photos du matériel',             icon: 'camera-outline',           tip: 'Les annonces avec 3+ photos génèrent 3× plus de réservations.' },
  { title: 'Tarification',     subtitle: 'Prix & modes de location',       icon: 'cash-outline',             tip: 'Proposez plusieurs modes pour maximiser vos chances de réservation.' },
  { title: 'Logistique',       subtitle: 'Remise, durée & caution',        icon: 'cube-outline',             tip: 'Des conditions claires évitent les malentendus.' },
  { title: 'Localisation',     subtitle: 'Où est disponible le produit ?', icon: 'map-outline',              tip: 'La localisation aide les locataires proches à vous trouver.' },
  { title: 'Détails & Règles', subtitle: 'Infos complémentaires',          icon: 'document-text-outline',    tip: 'Optionnel — chaque détail renforce la confiance des locataires.' },
  { title: 'Publication',      subtitle: 'Vérification & soumission',      icon: 'eye-outline',              tip: 'Vérifiez tout avant de soumettre. Un admin validera sous 24h.' },
] as const;

const STEP_COMPONENTS = [
  Step1TypeCategory,  // 0 — Classification
  Step2Essential,     // 1 — L'essentiel
  Step3Photos,        // 2 — Photos
  Step5Pricing,       // 3 — Tarification
  Step6Logistics,     // 4 — Logistique
  Step5Availability,  // 5 — Localisation
  StepDetailsRules,   // 6 — Détails & Règles (fusionné, avant-dernière)
  Step7Summary,       // 7 — Publication (rendu spécial)
];

export function ProductCreationFlow({ isEditMode = false }: { isEditMode?: boolean }) {
  const router = useRouter();
  const { token } = useAuth();
  const { form, reset } = useProductForm();

  const [step, setStep]               = useState(0); // 0-indexed
  const [error, setError]             = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const stepRef   = useRef(step);
  stepRef.current = step;

  // Scroll vers le bas quand le clavier s'ouvre à l'étape 2 (description en bas du form)
  useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      if (stepRef.current === 1) {
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      }
    });
    return () => sub.remove();
  }, []);

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
    let failedCount = 0;
    for (const uri of form.images) {
      if (uri.startsWith('http')) {
        uploaded.push(uri); // Déjà uploadé
      } else {
        const url = await uploadImage(uri, token || '', 'products');
        if (url) {
          uploaded.push(url);
        } else {
          failedCount++;
        }
      }
    }
    if (failedCount > 0 && uploaded.length === 0) {
      throw new Error(`Échec de l'envoi des photos. Vérifiez votre connexion et réessayez.`);
    }
    return uploaded;
  };

  /* ── Soumission ─────────────────────────────────────────────────────── */
  const submit = async (status: 'draft' | 'pending_review') => {
    const err = validateStep(TOTAL_STEPS, form);
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
        title:                (form.title ?? '').trim(),
        short_description:    (form.short_description ?? '').trim(),
        description:          (form.description ?? '').trim(),
        condition_label:      form.condition_label,
        included_items:       (form.included_items ?? '').trim(),
        size_dimensions:      (form.size_dimensions ?? '').trim(),
        price:                getMinPrice(form),
        pricing_type:         (form.pricing_modes ?? ['day'])[0],
        pricing_modes:        form.pricing_modes ?? ['day'],
        price_per_hour:       form.price_per_hour ? Number(String(form.price_per_hour).replace(',', '.')) : null,
        price_per_day:        form.price_per_day  ? Number(String(form.price_per_day).replace(',', '.'))  : null,
        price_per_week:       form.price_per_week ? Number(String(form.price_per_week).replace(',', '.')) : null,
        price_per_month:      form.price_per_month ? Number(String(form.price_per_month).replace(',', '.')) : null,
        price_per_session:    form.price_per_session ? Number(String(form.price_per_session).replace(',', '.')) : null,
        available_quantity:   parseInt(form.available_quantity || '1', 10),
        cover_image_url:      coverImg,
        image_url:            coverImg,
        image_urls:           imageUrls,
        deposit_required:     form.deposit_required,
        deposit_amount:       form.deposit_amount ? Number(String(form.deposit_amount).replace(',', '.')) : null,
        max_duration_days:    form.max_duration_days ? parseInt(form.max_duration_days, 10) : null,
        pickup_type:          form.pickup_type,
        pickup_notes:         (form.pickup_notes ?? '').trim(),
        return_rules:         (form.return_rules ?? '').trim(),
        cancellation_rules:   (form.cancellation_rules ?? '').trim(),
        city:                 (form.city ?? '').trim(),
        lat:                  form.selectedLat || null,
        lng:                  form.selectedLng || null,
        location_privacy:     form.location_privacy,
        radius_km:            form.location_privacy === 'exact' ? 0 : form.location_privacy === '100m' ? 0.1 : 1.0,
        availability_note:    (form.availability_note ?? '').trim(),
        related_spotyou_ids:  form.related_spotyou_ids ?? [],
        tag_ids:              form.tag_ids ?? [],
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

      {/* ── En-tête compact ──────────────────────────────────────────────── */}
      <View style={c.header}>
        <TouchableOpacity style={c.backBtn} onPress={goBack} testID="product-flow-back">
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={c.stepTitle} numberOfLines={1}>{cfg.title}</Text>
          <Text style={c.stepCount}>Étape {step + 1} sur {TOTAL_STEPS}</Text>
        </View>
        {/* Score qualité — compact */}
        <View style={[c.qualityBadge, { borderColor: quality.color + '40', backgroundColor: quality.color + '12' }]}>
          <Text style={[c.qualityScore, { color: quality.color }]}>{quality.score}</Text>
          <Text style={c.qualityMax}>/100</Text>
        </View>
      </View>

      {/* ── Barre de progression ─────────────────────────────────────────── */}
      <View style={c.progressBar}>
        <View style={[c.progressFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` as any }]} />
      </View>

      {/* ── Dots d'étapes ────────────────────────────────────────────────── */}
      <View style={c.dotsRow}>
        {STEP_CONFIG.map((_, i) => (
          <TouchableOpacity
            key={i}
            style={[c.dot, i < step && c.dotDone, i === step && c.dotCurrent]}
            onPress={() => i < step && setStep(i)}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            {i < step
              ? <Ionicons name="checkmark" size={9} color="#fff" />
              : <Text style={[c.dotNum, i === step && { color: '#fff', fontWeight: '800' }]}>{i + 1}</Text>}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Tip ──────────────────────────────────────────────────────────── */}
      <View style={c.tipBanner}>
        <Ionicons name="bulb-outline" size={13} color={BLUE} />
        <Text style={c.tipText} numberOfLines={2}>{cfg.tip}</Text>
      </View>

      {/* ── Erreur de validation (fixe, au-dessus du contenu) ────────────── */}
      {error ? (
        <View style={c.errorBanner} testID="step-error-banner">
          <Ionicons name="alert-circle" size={16} color="#EF4444" />
          <Text style={c.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* ── Contenu étape + navigation (KeyboardAvoidingView) ──────────── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlowScrollCtx.Provider value={scrollRef}>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={c.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {step === TOTAL_STEPS - 1 ? (
              <Step7Summary
                onSaveDraft={() => submit('draft')}
                onPublish={() => submit('pending_review')}
                isSubmitting={isSubmitting}
              />
            ) : (
              <StepComponent />
            )}
          </ScrollView>

          {/* ── Navigation bottom (sauf récap) ───────────────────────────── */}
          {!isLast && (
            <View style={c.navBar}>
              <TouchableOpacity
                style={c.prevBtn}
                onPress={goBack}
                testID="prev-step-btn"
              >
                <Ionicons name="arrow-back" size={18} color={Colors.foreground} />
                <Text style={c.prevBtnText}>{step === 0 ? 'Quitter' : 'Précédent'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={c.nextBtn}
                onPress={goNext}
                disabled={isSubmitting}
                testID="next-step-btn"
              >
                <Text style={c.nextBtnText}>
                  {step === TOTAL_STEPS - 2 ? 'Récapitulatif' : 'Suivant'}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

        </FlowScrollCtx.Provider>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const c = StyleSheet.create({
  root:         { flex: 1, backgroundColor: Colors.background },
  header:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: Spacing.md, paddingTop: 8, paddingBottom: 10 },
  backBtn:      { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  stepTitle:    { fontSize: 15, fontWeight: '800', color: Colors.foreground },
  stepCount:    { fontSize: 11, color: Colors.muted, fontWeight: '600', marginTop: 1 },
  qualityBadge: { flexDirection: 'row', alignItems: 'baseline', gap: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 16, borderWidth: 1 },
  qualityScore: { fontSize: 16, fontWeight: '900' },
  qualityMax:   { fontSize: 10, color: Colors.muted },

  progressBar:  { height: 2, backgroundColor: Colors.border, marginHorizontal: Spacing.md, borderRadius: 1, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: BLUE, borderRadius: 1 },

  dotsRow:      { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7, paddingVertical: 8 },
  dot:          { width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  dotDone:      { backgroundColor: BLUE, borderColor: BLUE },
  dotCurrent:   { width: 28, height: 28, borderRadius: 14, backgroundColor: BLUE, borderColor: BLUE },
  dotNum:       { fontSize: 10, fontWeight: '600', color: Colors.muted },

  tipBanner:    { flexDirection: 'row', alignItems: 'flex-start', gap: 7, marginHorizontal: Spacing.md, marginBottom: 6, backgroundColor: BLUE_DIM, borderRadius: Radius.md, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: BLUE + '22' },
  tipText:      { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 16 },

  errorBanner:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FEF2F2', marginHorizontal: Spacing.md, borderRadius: Radius.md, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: '#FECACA' },
  errorText:    { flex: 1, fontSize: 13, color: '#DC2626', fontWeight: '600' },

  content:      { paddingHorizontal: Spacing.md, paddingTop: 4, paddingBottom: 100 },

  navBar:       { flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.md, paddingVertical: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  prevBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 15, paddingHorizontal: 18, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  prevBtnText:  { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  nextBtn:      { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: Radius.full, backgroundColor: BLUE },
  nextBtnText:  { fontSize: 15, fontWeight: '700', color: '#fff' },
});
