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
    product_type:        data.product_type        || 'rental',
    category:            data.category            || '',
    subcategory:         data.subcategory          || '',
    title:               data.title               || '',
    short_description:   data.short_description   || '',
    description:         data.description         || '',
    condition_label:     data.condition_label      || 'good',
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

export default function ProductCreateScreen() {
  const { productId, mode } = useLocalSearchParams<{ productId?: string; mode?: string }>();
  const isEditMode = mode === 'edit' && !!productId;

  const [initialData, setInitialData] = useState<Partial<ProductFormData> | undefined>(undefined);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);

  useEffect(() => {
    if (!isEditMode) return;
    api.get(`/products/${productId}/detail`)
      .then((data: any) => setInitialData(apiToFormData(data)))
      .catch(() => {
        // Si l'API échoue, on ouvre quand même le stepper vide
        setInitialData({ product_id: productId });
      })
      .finally(() => setLoadingEdit(false));
  }, [isEditMode, productId]);

  if (loadingEdit) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color="#3B82F6" />
      </View>
    );
  }

  return (
    <ProductFormProvider initialData={initialData}>
      <ProductCreationFlow />
    </ProductFormProvider>
  );
}
