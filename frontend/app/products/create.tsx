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

/** Mappe une réponse API vers les champs du formulaire */
function apiToFormData(data: any): Partial<ProductFormData> {
  return {
    product_id:          data.product_id,
    status:              data.status || 'draft',
    product_type:        data.product_type        || 'rental',
    // category_id est maintenant un DB ID direct (ex: 'cat_prd_bike')
    category:            data.category            || '',
    subcategory:         data.subcategory          || '',
    // Tags
    tag_ids:             Array.isArray(data.tag_ids) ? data.tag_ids : [],
    title:               data.title               || '',
    short_description:   data.short_description   || '',
    description:         data.description         || '',
    condition_label:     data.condition_label      || 'good',
    included_items:      data.included_items       || '',
    size_dimensions:     data.size_dimensions      || '',
    // Tarification multi-unité
    pricing_modes:       Array.isArray(data.pricing_modes) && data.pricing_modes.length > 0
                           ? data.pricing_modes
                           : (data.pricing_type ? [data.pricing_type] : ['day']),
    price_per_hour:      data.price_per_hour    != null ? String(data.price_per_hour)    : '',
    price_per_day:       data.price_per_day     != null ? String(data.price_per_day)     : '',
    price_per_week:      data.price_per_week    != null ? String(data.price_per_week)    : '',
    price_per_month:     data.price_per_month   != null ? String(data.price_per_month)   : '',
    price_per_session:   data.price_per_session != null ? String(data.price_per_session) : '',
    available_quantity:  data.available_quantity != null ? String(data.available_quantity) : '1',
    images:              Array.isArray(data.image_urls) && data.image_urls.length > 0
                           ? data.image_urls
                           : (data.cover_image_url ? [data.cover_image_url] : []),
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
    related_spotyou_ids: Array.isArray(data.related_spotyou_ids) ? data.related_spotyou_ids : [],
    category_label:      data.category_label || '',
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
