/**
 * Écran de création produit — point d'entrée du flow
 */
import React from 'react';
import { ProductFormProvider } from '../../components/product-form/ProductFormContext';
import { ProductCreationFlow } from '../../components/product-form/ProductCreationFlow';

export default function ProductCreateScreen() {
  return (
    <ProductFormProvider>
      <ProductCreationFlow />
    </ProductFormProvider>
  );
}
