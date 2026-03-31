/**
 * ProductFormContext — état global du flow de création produit.
 * Fournit useProductForm() à tous les composants d'étape.
 */
import React, { createContext, useContext, useState, useCallback } from 'react';

export type ProductType = 'rental' | 'sale' | 'digital' | 'affiliation';
export type PricingMode = 'hour' | 'day' | 'week' | 'month' | 'session';
export type ConditionLabel = 'new' | 'very_good' | 'good' | 'acceptable';
export type PickupType = 'local_pickup' | 'creator_handoff';
export type LocationPrivacy = 'exact' | '100m' | '1000m';
export type ProductStatus = 'draft' | 'pending_review';

export interface ProductFormData {
  // Step 1 — Type + Catégorie + Tags
  product_type: ProductType;
  category: string;
  subcategory: string;
  tag_ids: string[];

  // Step 2 — Infos principales
  title: string;
  short_description: string;
  description: string;
  condition_label: ConditionLabel;
  included_items: string;
  size_dimensions: string;

  // Tarification multi-unité
  pricing_modes: PricingMode[];  // ex: ['hour','day'] = location à l'heure ET à la journée
  price_per_hour: string;
  price_per_day: string;
  price_per_week: string;
  price_per_month: string;
  price_per_session: string;
  available_quantity: string;

  // Step 3 — Photos
  images: string[];         // URIs locaux ou URLs R2 après upload

  // Step 4 — Conditions de location
  deposit_required: boolean;
  deposit_amount: string;
  max_duration_days: string; // conservé pour compatibilité mais non affiché
  pickup_type: PickupType | '';
  pickup_notes: string;
  return_rules: string;
  cancellation_rules: string;

  // Step 5 — Disponibilité + localisation
  city: string;
  selectedLat: number;
  selectedLng: number;
  locationAddress: string;
  location_privacy: LocationPrivacy;
  availability_note: string;

  // Step 2 — SpotYou (intégré dans l'étape tarification)
  related_spotyou_ids: string[];
  category_label: string;  // label affiché de la catégorie sélectionnée

  // Meta
  product_id?: string;
}

const DEFAULT: ProductFormData = {
  product_type:       'rental',
  category:           '',
  subcategory:        '',
  tag_ids:            [],
  title:              '',
  short_description:  '',
  description:        '',
  condition_label:    'good',
  included_items:     '',
  size_dimensions:    '',
  pricing_modes:      ['day'],
  price_per_hour:     '',
  price_per_day:      '',
  price_per_week:     '',
  price_per_month:    '',
  price_per_session:  '',
  available_quantity: '1',
  images:             [],
  deposit_required:   false,
  deposit_amount:     '',
  max_duration_days:  '',
  pickup_type:        '',
  pickup_notes:       '',
  return_rules:       '',
  cancellation_rules: '',
  city:               '',
  selectedLat:        0,
  selectedLng:        0,
  locationAddress:    '',
  location_privacy:   '100m',
  availability_note:  '',
  related_spotyou_ids:[],
  category_label:     '',
};

/* ── Helpers ─────────────────────────────────────────────────────────────── */
export function getMinPrice(f: ProductFormData): number {
  const rates = [f.price_per_hour, f.price_per_day, f.price_per_week, f.price_per_month, f.price_per_session]
    .map(v => parseFloat(v?.replace(',', '.') || '0'))
    .filter(n => n > 0);
  return rates.length > 0 ? Math.min(...rates) : 0;
}

export function hasValidPricing(f: ProductFormData): boolean {
  if (f.pricing_modes.length === 0) return false;
  return f.pricing_modes.every(mode => {
    const val = mode === 'hour'    ? f.price_per_hour
              : mode === 'day'     ? f.price_per_day
              : mode === 'week'    ? f.price_per_week
              : mode === 'month'   ? f.price_per_month
              : mode === 'session' ? f.price_per_session : '';
    return parseFloat(val?.replace(',', '.') || '0') > 0;
  });
}

/* ── Qualité ────────────────────────────────────────────────────────────── */
export function calcProductQuality(f: ProductFormData): {
  score: number; label: string; color: string; checklist: string[];
} {
  let s = 0;
  const done: string[] = [];
  const todo: string[] = [];

  if (f.images.length >= 1) { s += 20; done.push('Photo principale'); }
  else                        todo.push('Photo principale');

  if (f.images.length >= 3) { s += 10; done.push('3 photos ou plus'); }

  if (f.title.trim().length >= 10) { s += 15; done.push('Titre clair'); }
  else                               todo.push('Titre (min. 10 car.)');

  if (f.title.trim().length >= 25) s += 5;

  if (f.description.trim().length >= 50) { s += 10; done.push('Description'); }
  else                                     todo.push('Description (min. 50 car.)');

  if (f.description.trim().length >= 150) s += 10;

  if (hasValidPricing(f)) { s += 10; done.push('Tarification définie'); }
  else                       todo.push('Au moins un tarif');

  if (f.pickup_type) { s += 10; done.push('Mode de remise'); }
  else                todo.push('Mode de remise');

  if (f.selectedLat && f.selectedLng) { s += 10; done.push('Localisation'); }
  else                                  todo.push('Localisation');

  s = Math.min(s, 100);

  let label = 'Basique';
  let color = '#94A3B8';
  if (s >= 85) { label = 'Excellent !'; color = '#22C55E'; }
  else if (s >= 65) { label = 'Très bien'; color = '#3B82F6'; }
  else if (s >= 40) { label = 'Bien'; color = '#F59E0B'; }

  return { score: s, label, color, checklist: todo };
}

/* ── Validation par étape ──────────────────────────────────────────────── */
export function validateStep(step: number, f: ProductFormData): string | null {
  switch (step) {
    case 1: // Classification
      if (!f.product_type)
        return 'Sélectionnez un type de produit.';
      if (!f.category)
        return 'Choisissez une catégorie de matériel.';
      if (!f.tag_ids || f.tag_ids.length === 0)
        return 'Sélectionne au moins un tag pour continuer.';
      break;
    case 2: // L'essentiel
      if (!f.title.trim() || f.title.trim().length < 3)
        return 'Le titre doit faire au moins 3 caractères.';
      if (!f.condition_label)
        return "Précisez l'état du matériel.";
      if (!f.available_quantity || parseInt(f.available_quantity, 10) < 1)
        return 'La quantité doit être au minimum 1.';
      if (!f.description.trim() || f.description.trim().length < 30)
        return 'La description est obligatoire (minimum 30 caractères).';
      break;
    case 3: // Photos
      if (f.images.length === 0)
        return 'Ajoutez au moins une photo principale.';
      break;
    case 4: // Localisation
      if (!f.locationAddress.trim() && !f.selectedLat)
        return 'Indiquez une localisation.';
      break;
    case 5: // Tarification + SpotYou
      if (f.pricing_modes.length === 0)
        return 'Activez au moins un mode de tarification.';
      // Vérifier que chaque mode actif a un prix > 0
      for (const mode of f.pricing_modes) {
        const val = mode === 'hour'    ? f.price_per_hour
                  : mode === 'day'     ? f.price_per_day
                  : mode === 'week'    ? f.price_per_week
                  : mode === 'month'   ? f.price_per_month
                  : mode === 'session' ? f.price_per_session : '';
        if (parseFloat(val?.replace(',', '.') || '0') <= 0) {
          const label = mode === 'hour'    ? "l'heure"
                      : mode === 'day'     ? "la journée"
                      : mode === 'week'    ? "la semaine"
                      : mode === 'month'   ? "le mois"
                      : "la séance";
          return `Saisissez le prix pour le mode "À ${label}".`;
        }
      }
      if (
        f.pricing_modes.includes('session') &&
        (!f.related_spotyou_ids || f.related_spotyou_ids.length === 0)
      )
        return 'Avec la tarification par séance, sélectionne au moins un SpotYou.';
      break;
    case 6: // Logistique
      if (!f.pickup_type)
        return 'Précisez le mode de remise du matériel.';
      if (f.deposit_required && (!f.deposit_amount || Number((f.deposit_amount || '').replace(',', '.')) <= 0))
        return 'Indiquez le montant de la caution.';
      break;
    case 7: // Détails & Règles — tout optionnel
      break;
    case 8: // Vérification finale complète (publication)
      if (!f.category)           return 'Étape 1 — Choisissez une catégorie.';
      if (!f.tag_ids || f.tag_ids.length === 0)
                                 return 'Étape 1 — Sélectionne au moins un tag.';
      if (!f.title.trim())       return 'Étape 2 — Le titre est obligatoire.';
      if (!f.condition_label)    return "Étape 2 — Précisez l'état du matériel.";
      if (!f.description.trim() || f.description.trim().length < 30)
                                 return 'Étape 2 — La description doit faire au moins 30 caractères.';
      if (f.images.length === 0) return 'Étape 3 — Ajoutez au moins une photo.';
      if (!hasValidPricing(f))   return 'Étape 5 — Définissez au moins un tarif.';
      if ((f.pricing_modes ?? []).includes('session') && (!f.related_spotyou_ids || f.related_spotyou_ids.length === 0))
                                 return 'Étape 5 — Sélectionne un SpotYou pour la tarification par séance.';
      if (!f.pickup_type)        return 'Étape 6 — Précisez le mode de remise.';
      if ((f.pricing_modes ?? []).some(m => ['day', 'week', 'month'].includes(m)) && !f.max_duration_days)
                                 return '';
      if (f.deposit_required && (!f.deposit_amount || Number((f.deposit_amount || '').replace(',', '.')) <= 0))
                                 return 'Étape 6 — Indiquez le montant de la caution.';
      break;
    default:
      break;
  }
  return null;
}

/* ── Context ────────────────────────────────────────────────────────────── */
interface ProductFormContextValue {
  form:       ProductFormData;
  set:        (partial: Partial<ProductFormData>) => void;
  reset:      () => void;
  scrollRef?: React.RefObject<ScrollView>;
}

const Ctx = createContext<ProductFormContextValue | null>(null);

export function ProductFormProvider({ children, initialData, scrollRef }: { children: React.ReactNode; initialData?: Partial<ProductFormData>; scrollRef?: React.RefObject<ScrollView> }) {
  const [form, setForm] = useState<ProductFormData>(() => ({ ...DEFAULT, ...(initialData ?? {}) }));

  const set = useCallback((partial: Partial<ProductFormData>) => {
    setForm(prev => ({ ...prev, ...partial }));
  }, []);

  const reset = useCallback(() => setForm(DEFAULT), []);

  return <Ctx.Provider value={{ form, set, reset, scrollRef }}>{children}</Ctx.Provider>;
}

export function useProductForm() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProductForm must be inside ProductFormProvider');
  return ctx;
}
