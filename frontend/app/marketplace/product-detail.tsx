/**
 * Écran Détail Produit — affiche le ProductDetailView dans un écran dédié.
 * Détecte si l'utilisateur courant est le vendeur et active le bouton "Modifier".
 */
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ProductDetailView } from '../../components/ProductDetailView';
import { marketplaceStore } from '../../lib/marketplaceStore';
import { Colors } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

export default function ProductDetailScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const item     = marketplaceStore.getSelected();
  const allItems = marketplaceStore.getProducts();

  if (!item) {
    router.back();
    return <View style={{ flex: 1, backgroundColor: Colors.background }} />;
  }

  const isOwner = !!(user && item.seller_id && user.user_id === item.seller_id);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }} edges={['top']}>
      <ProductDetailView
        item={item}
        allItems={allItems}
        isOwner={isOwner}
        onBack={() => router.back()}
        onEdit={() =>
          router.push(`/products/create?productId=${item.product_id}&mode=edit` as any)
        }
      />
    </SafeAreaView>
  );
}
