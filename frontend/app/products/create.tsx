/**
 * Écran de création / édition produit — point d'entrée du flow
 * Supporte le mode édition via URL params: ?productId={id}&mode=edit
 */
import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ProductFormProvider, ProductFormData } from '../../components/product-form/ProductFormContext';
import { ProductCreationFlow } from '../../components/product-form/ProductCreationFlow';
import { api } from '../../lib/api';
import { Colors } from '../../constants/Colors';

// ── Mapping catégories DB → clés CATEGORIES du stepper ────────────────────────
const CATEGORY_NORMALIZE: Record<string, string> = {
  sport: 'autre', Sport: 'autre', Outdoor: 'autre', outdoor: 'autre',
  Test: 'autre',  test: 'autre',  Other: 'autre',   other: 'autre',
};
const VALID_CATEGORY_KEYS = new Set([
  'velo', 'raquette', 'fitness', 'yoga', 'ballon',
  'natation', 'glisse', 'running', 'accessoire', 'autre',
]);

function normalizeCategory(cat: string | null | undefined): string {
  if (!cat) return '';
  if (VALID_CATEGORY_KEYS.has(cat)) return cat;
  return CATEGORY_NORMALIZE[cat] ?? 'autre';
}

/** Mappe une réponse API vers les champs du formulaire */
function apiToFormData(data: any): Partial<ProductFormData> {
  return {
    product_id:          data.product_id,
    product_type:        data.product_type        || 'rental',
    category:            normalizeCategory(data.category),
    subcategory:         data.subcategory          || '',
    title:               data.title               || '',
    short_description:   data.short_description   || '',
    description:         data.description         || '',
    condition_label:     data.condition_label      || '',
    included_items:      data.included_items       || '',
    brand_model:         data.brand_model          || '',
    size_dimensions:     data.size_dimensions      || '',
    price:               data.price != null ? String(data.price) : '',
    pricing_type:        data.pricing_type         || 'day',
    available_quantity:  data.available_quantity != null ? String(data.available_quantity) : '1',
    images:              data.image_urls?.length ? data.image_urls : (data.cover_image_url ? [data.cover_image_url] : []),
    deposit_required:    !!data.deposit_required,
    deposit_amount:      data.deposit_amount != null ? String(data.deposit_amount) : '',
    max_duration_days:   data.max_duration_days != null ? String(data.max_duration_days) : '',
    pickup_type:         data.pickup_type          || '',
    pickup_notes:        data.pickup_notes         || '',
    return_rules:        data.return_rules         || '',
    cancellation_rules:  data.cancellation_rules   || '',
    city:                data.city                 || '',
    selectedLat:         data.lat                  || 0,
    selectedLng:         data.lng                  || 0,
    locationAddress:     data.city                 || '',
    location_privacy:    data.location_privacy     || '100m',
    availability_note:   data.availability_note    || '',
    related_spotyou_ids: data.related_spotyou_ids  || [],
  };
}

// État atomique pour éviter les problèmes de batching React
type EditState =
  | { loading: true }
  | { loading: false; data: Partial<ProductFormData> | undefined };

export default function ProductCreateScreen() {
  const { productId, mode } = useLocalSearchParams<{ productId?: string; mode?: string }>();
  const isEditMode = mode === 'edit' && !!productId;

  // Mise à jour atomique : loading + data en même setState
  const [editState, setEditState] = useState<EditState>(
    isEditMode ? { loading: true } : { loading: false, data: undefined }
  );

  useEffect(() => {
    if (!isEditMode) return;
    api.get(`/products/${productId}/detail`)
      .then((data: any) => {
        setEditState({ loading: false, data: apiToFormData(data) });
      })
      .catch(() => {
        setEditState({ loading: false, data: { product_id: productId } });
      });
  }, [isEditMode, productId]);

  if (editState.loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  const initialData = editState.loading === false ? editState.data : undefined;

  return (
    <ProductFormProvider initialData={initialData}>
      <ProductCreationFlow isEditMode={isEditMode} />
    </ProductFormProvider>
  );
}
