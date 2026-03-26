/**
 * Écran "Mes produits" — liste des produits créés par l'utilisateur
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Image, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { api } from '../../lib/api';

const VIOLET     = '#8B5CF6';
const VIOLET_DIM = 'rgba(139,92,246,0.12)';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  draft:           { label: 'Brouillon',          color: '#94A3B8', bg: '#94A3B822', icon: 'document-outline'         },
  pending_review:  { label: 'En validation',       color: '#F59E0B', bg: '#F59E0B22', icon: 'time-outline'              },
  active:          { label: 'Publié',              color: '#22C55E', bg: '#22C55E22', icon: 'checkmark-circle-outline'  },
  inactive:        { label: 'Inactif',             color: Colors.muted, bg: Colors.muted + '22', icon: 'pause-circle-outline' },
  rejected:        { label: 'Refusé',              color: '#EF4444', bg: '#EF444422', icon: 'close-circle-outline'     },
};

const CAT_LABELS: Record<string, string> = {
  velo: 'Vélo', raquette: 'Raquette', fitness: 'Fitness', yoga: 'Yoga',
  ballon: 'Ballon', natation: 'Natation', glisse: 'Glisse', running: 'Running',
  accessoire: 'Accessoires', autre: 'Matériel',
};

export default function MyProductsScreen() {
  const router = useRouter();
  const [products,   setProducts]   = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api.get('/products/mine') as { products: any[] };
      setProducts(d.products || []);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={m.root} edges={['top']}>
      {/* Header */}
      <View style={m.header}>
        <TouchableOpacity style={m.backBtn} onPress={() => router.back()} testID="my-products-back">
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={[m.headerIcon, { backgroundColor: VIOLET_DIM }]}>
          <Ionicons name="cube-outline" size={20} color={VIOLET} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={m.headerTitle}>Mes produits</Text>
          <Text style={m.headerSub}>
            {loading ? 'Chargement…' : `${products.length} produit${products.length > 1 ? 's' : ''}`}
          </Text>
        </View>
        <TouchableOpacity
          style={m.addBtn}
          onPress={() => router.push('/products/create' as any)}
          testID="add-product-btn"
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={m.addBtnText}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={m.center}>
          <ActivityIndicator size="large" color={VIOLET} />
        </View>
      ) : products.length === 0 ? (
        <View style={m.empty}>
          <View style={m.emptyIcon}>
            <Ionicons name="cube-outline" size={48} color={Colors.muted} />
          </View>
          <Text style={m.emptyTitle}>Aucun produit pour l'instant</Text>
          <Text style={m.emptySub}>Créez votre première annonce de location pour qu'elle apparaisse ici.</Text>
          <TouchableOpacity
            style={m.emptyBtn}
            onPress={() => router.push('/products/create' as any)}
            testID="create-first-product-btn"
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={m.emptyBtnText}>Créer mon premier produit</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={p => p.product_id}
          contentContainerStyle={m.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={VIOLET} />}
          renderItem={({ item: p }) => {
            const st = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft;
            const priceLabel = p.price != null
              ? `${Number(p.price).toFixed(2)} € / ${p.pricing_type === 'day' ? 'jour' : 'séance'}`
              : '—';
            return (
              <View style={m.card} testID={`product-card-${p.product_id}`}>
                {(p.cover_image_url || p.image_url) ? (
                  <Image source={{ uri: p.cover_image_url || p.image_url }} style={m.cardImg} />
                ) : (
                  <View style={[m.cardImg, m.cardImgPlaceholder]}>
                    <Ionicons name="image-outline" size={28} color={Colors.muted} />
                  </View>
                )}
                <View style={m.cardContent}>
                  <View style={m.cardTop}>
                    <View style={[m.statusBadge, { backgroundColor: st.bg }]}>
                      <Ionicons name={st.icon as any} size={11} color={st.color} />
                      <Text style={[m.statusText, { color: st.color }]}>{st.label}</Text>
                    </View>
                    {p.category && (
                      <View style={m.catBadge}>
                        <Text style={m.catText}>{CAT_LABELS[p.category] ?? p.category}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={m.cardTitle} numberOfLines={2}>{p.title}</Text>
                  <Text style={m.cardPrice}>{priceLabel}</Text>
                  {p.status === 'rejected' && p.rejection_reason && (
                    <Text style={m.rejectionNote} numberOfLines={2}>Motif : {p.rejection_reason}</Text>
                  )}
                  {p.status === 'pending_review' && (
                    <Text style={m.pendingNote}>En attente de validation par un admin</Text>
                  )}
                </View>
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const m = StyleSheet.create({
  root:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerSub:   { fontSize: 12, color: Colors.muted, marginTop: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: VIOLET, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: Spacing.xl },
  emptyIcon:   { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle:  { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  emptySub:    { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: VIOLET, borderRadius: Radius.full, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText:{ fontSize: 15, fontWeight: '700', color: '#fff' },
  list:        { padding: Spacing.md, gap: 12 },
  card:        { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  cardImg:     { width: 100, height: 100 },
  cardImgPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.border },
  cardContent: { flex: 1, padding: 12, gap: 4 },
  cardTop:     { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  statusText:  { fontSize: 10, fontWeight: '700' },
  catBadge:    { backgroundColor: Colors.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  catText:     { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  cardTitle:   { fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 19 },
  cardPrice:   { fontSize: 13, fontWeight: '800', color: VIOLET },
  rejectionNote: { fontSize: 11, color: '#EF4444', lineHeight: 16 },
  pendingNote: { fontSize: 11, color: '#F59E0B', lineHeight: 16 },
});
