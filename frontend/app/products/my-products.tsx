/**
 * Écran "Mes produits" — liste + détail avec actions (edit/delete)
 */
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  StyleSheet, ActivityIndicator, Image,
  RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { api } from '../../lib/api';
import { ProductDetailView } from '../../components/ProductDetailView';

const BLUE     = '#3B82F6';
const BLUE_DIM = 'rgba(59,130,246,0.12)';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  draft:          { label: 'Brouillon',     color: '#94A3B8', bg: '#94A3B822', icon: 'document-outline'        },
  pending_review: { label: 'En validation', color: '#F59E0B', bg: '#F59E0B22', icon: 'time-outline'             },
  active:         { label: 'Publié',        color: '#22C55E', bg: '#22C55E22', icon: 'checkmark-circle-outline' },
  approved:       { label: 'Publié',        color: '#22C55E', bg: '#22C55E22', icon: 'checkmark-circle-outline' },
  inactive:       { label: 'Inactif',       color: Colors.muted, bg: Colors.muted + '22', icon: 'pause-circle-outline' },
  rejected:       { label: 'Refusé',        color: '#EF4444', bg: '#EF444422', icon: 'close-circle-outline'    },
};

const PRICING_LABELS: Record<string, string> = {
  day: 'jour', hour: 'heure', week: 'semaine', month: 'mois', unit: 'unité',
};


/* ── Écran principal ─────────────────────────────────────────────────────── */
export default function MyProductsScreen() {
  const router = useRouter();
  const [products,   setProducts]   = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected,   setSelected]   = useState<any | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await api.get('/products/mine') as { products: any[] };
      setProducts(d.products || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleEdit = (product: any) => {
    setSelected(null);
    router.push(`/products/create?productId=${product.product_id}&mode=edit` as any);
  };

  const handleDelete = (product: any) => {
    Alert.alert(
      'Supprimer l\'annonce',
      `Êtes-vous sûr de vouloir supprimer "${product.title}" ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/products/${product.product_id}`);
              setSelected(null);
              load(true);
            } catch {
              Alert.alert('Erreur', 'La suppression a échoué.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={m.root} edges={['top']}>
      {/* Header */}
      <View style={m.header}>
        <TouchableOpacity style={m.backBtn} onPress={() => router.back()} testID="my-products-back">
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
        <View style={[m.headerIcon, { backgroundColor: BLUE_DIM }]}>
          <Ionicons name="storefront-outline" size={20} color={BLUE} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={m.headerTitle}>Mes annonces</Text>
          <Text style={m.headerSub}>
            {loading ? 'Chargement…' : `${products.length} annonce${products.length > 1 ? 's' : ''}`}
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
          <ActivityIndicator size="large" color={BLUE} />
        </View>
      ) : products.length === 0 ? (
        <View style={m.empty}>
          <View style={m.emptyIcon}>
            <Ionicons name="storefront-outline" size={48} color={Colors.muted} />
          </View>
          <Text style={m.emptyTitle}>Aucune annonce pour l'instant</Text>
          <Text style={m.emptySub}>Créez votre première annonce de location pour qu'elle apparaisse ici.</Text>
          <TouchableOpacity
            style={m.emptyBtn}
            onPress={() => router.push('/products/create' as any)}
            testID="create-first-product-btn"
          >
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={m.emptyBtnText}>Créer ma première annonce</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={p => p.product_id}
          contentContainerStyle={m.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} tintColor={BLUE} />}
          renderItem={({ item: p }) => {
            const st = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.draft;
            const priceLabel = p.price != null
              ? `${Number(p.price).toFixed(2)} € / ${PRICING_LABELS[p.pricing_type] ?? 'jour'}`
              : '—';
            const isRejected = p.status === 'rejected';
            return (
              <TouchableOpacity
                style={[m.card, isRejected && m.cardRejected]}
                onPress={() => setSelected(p)}
                activeOpacity={0.75}
                testID={`product-card-${p.product_id}`}
              >
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
                        <Text style={m.catText}>{p.category}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={m.cardTitle} numberOfLines={2}>{p.title}</Text>
                  <Text style={m.cardPrice}>{priceLabel}</Text>
                  {isRejected && (
                    <Text style={m.rejectionNote} numberOfLines={1}>
                      {(p.admin_comment || p.rejection_reason)
                        ? `Motif : ${p.admin_comment || p.rejection_reason}`
                        : 'Annonce refusée — appuyez pour voir les détails'}
                    </Text>
                  )}
                  {p.status === 'pending_review' && (
                    <Text style={m.pendingNote}>En attente de validation</Text>
                  )}
                  <View style={m.cardChevron}>
                    <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {selected && (
        <View style={StyleSheet.absoluteFillObject}>
          <ProductDetailView
            item={selected}
            allItems={products}
            isOwner
            onBack={() => setSelected(null)}
            onEdit={() => handleEdit(selected)}
            onDelete={() => handleDelete(selected)}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

/* ── Styles ──────────────────────────────────────────────────────────────── */
const m = StyleSheet.create({
  root:        { flex: 1, backgroundColor: Colors.background },
  header:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:     { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerSub:   { fontSize: 12, color: Colors.muted, marginTop: 1 },
  addBtn:      { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BLUE, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText:  { fontSize: 13, fontWeight: '700', color: '#fff' },
  center:      { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: Spacing.xl },
  emptyIcon:   { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  emptyTitle:  { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  emptySub:    { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  emptyBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: BLUE, borderRadius: Radius.full, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText:{ fontSize: 15, fontWeight: '700', color: '#fff' },
  list:        { padding: Spacing.md, gap: 12 },
  card:        { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  cardRejected:{ borderColor: '#EF444455', borderWidth: 1.5 },
  cardImg:     { width: 100, height: 100 },
  cardImgPlaceholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.border },
  cardContent: { flex: 1, padding: 12, gap: 4 },
  cardTop:     { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  statusText:  { fontSize: 10, fontWeight: '700' },
  catBadge:    { backgroundColor: Colors.border, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 3 },
  catText:     { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  cardTitle:   { fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 19 },
  cardPrice:   { fontSize: 13, fontWeight: '800', color: BLUE },
  rejectionNote: { fontSize: 11, color: '#EF4444', lineHeight: 16 },
  pendingNote: { fontSize: 11, color: '#F59E0B', lineHeight: 16 },
  cardChevron: { position: 'absolute', right: 12, bottom: 12 },
});



