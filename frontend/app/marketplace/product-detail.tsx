/**
 * Écran Détail Produit — affiche le ProductDetailView dans un écran dédié.
 */
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ProductDetailView } from '../../components/ProductDetailView';
import { marketplaceStore } from '../../lib/marketplaceStore';
import { Colors } from '../../constants/Colors';

export default function ProductDetailScreen() {
  const router = useRouter();
  const item     = marketplaceStore.getSelected();
  const allItems = marketplaceStore.getProducts();

  if (!item) {
    // Sécurité — ne devrait pas arriver en pratique
    router.back();
    return <View style={{ flex: 1, backgroundColor: Colors.background }} />;
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ProductDetailView
        item={item}
        allItems={allItems}
        onBack={() => router.back()}
      />
    </SafeAreaView>
  );
}
