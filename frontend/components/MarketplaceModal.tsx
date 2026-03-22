/**
 * MarketplaceModal — Produits liés au SpotYou, filtrés par tags.
 * Couleur marketplace : Cobalt Blue #3B82F6
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { api } from '../lib/api';
import { TagImage } from './TagImage';

const COBALT = '#3B82F6';
const COBALT_DIM = 'rgba(59,130,246,0.12)';
const COBALT_BORDER = 'rgba(59,130,246,0.25)';

const FILTERS = [
  { key: 'all', label: 'Tous' },
  { key: 'rental', label: 'Location' },
  { key: 'sale', label: 'Vente' },
  { key: 'recommended', label: 'Recommandés' },
  { key: 'creator', label: 'Du créateur' },
  { key: 'spotu', label: 'SpotU' },
] as const;

const LEVEL_LABELS: Record<string, string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  avance: 'Avancé',
  tous: 'Tous niveaux',
};

const LEVEL_COLORS: Record<string, string> = {
  debutant: '#34D399',
  intermediaire: '#FBBF24',
  avance: '#F87171',
  tous: Colors.muted,
};

const TYPE_LABELS: Record<string, { label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  sale: { label: 'Vente', icon: 'pricetag-outline' },
  rental: { label: 'Location', icon: 'time-outline' },
  external: { label: 'Externe', icon: 'open-outline' },
};

interface MarketplaceModalProps {
  visible: boolean;
  onClose: () => void;
  spotYouId: string;
  tagIds?: string[];
}

export function MarketplaceModal({ visible, onClose, spotYouId, tagIds }: MarketplaceModalProps) {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    const qs = tagIds?.length ? `tag_ids=${tagIds.join(',')}` : `spotyou_id=${spotYouId}`;
    api.get(`/marketplace/products?${qs}`)
      .then((d: any) => setProducts(d.products || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  }, [visible, spotYouId]);

  const filtered = products.filter(p => {
    if (filter === 'all') return true;
    if (filter === 'rental') return p.product_type === 'rental';
    if (filter === 'sale') return p.product_type === 'sale';
    if (filter === 'recommended') return p.seller_type === 'recommended';
    if (filter === 'creator') return p.seller_type === 'creator';
    if (filter === 'spotu') return ['spotu', 'sponsored', 'affiliated'].includes(p.seller_type);
    return true;
  });

  // Separate into SpotU products and Creator products
  const spotuProducts = filtered.filter(p => ['spotu', 'sponsored', 'affiliated', 'recommended'].includes(p.seller_type));
  const creatorProducts = filtered.filter(p => p.seller_type === 'creator');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <View style={s.headerIcon}>
                <Ionicons name="storefront" size={18} color={COBALT} />
              </View>
              <Text style={s.headerTitle}>Marketplace</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} testID="close-marketplace">
              <Ionicons name="close-circle" size={28} color={Colors.muted} />
            </TouchableOpacity>
          </View>

          {/* Filter tabs */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtersWrap}>
            {FILTERS.map(f => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[s.filterPill, active && s.filterPillActive]}
                  onPress={() => setFilter(f.key)}
                  testID={`filter-${f.key}`}
                >
                  <Text style={[s.filterText, active && s.filterTextActive]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Content */}
          {loading ? (
            <View style={s.center}><ActivityIndicator size="large" color={COBALT} /></View>
          ) : filtered.length === 0 ? (
            <View style={s.center}>
              <Ionicons name="bag-outline" size={48} color={Colors.muted} />
              <Text style={s.emptyText}>Aucun produit disponible</Text>
            </View>
          ) : (
            <FlatList
              data={[
                ...(spotuProducts.length > 0 ? [{ _section: 'spotu' }] : []),
                ...spotuProducts,
                ...(creatorProducts.length > 0 ? [{ _section: 'creator' }] : []),
                ...creatorProducts,
              ]}
              keyExtractor={(item, idx) => item._section || item.product_id || String(idx)}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 32 }}
              renderItem={({ item }) => {
                if (item._section) {
                  return (
                    <View style={s.sectionHeader}>
                      <View style={[s.sectionDot, { backgroundColor: item._section === 'spotu' ? COBALT : Colors.primary }]} />
                      <Text style={s.sectionTitle}>
                        {item._section === 'spotu' ? 'Produits SpotU' : 'Produits du créateur'}
                      </Text>
                      <View style={s.sectionLine} />
                    </View>
                  );
                }
                return <ProductCard item={item} />;
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

function ProductCard({ item }: { item: any }) {
  const typeInfo = TYPE_LABELS[item.product_type] || TYPE_LABELS.sale;
  const levelColor = LEVEL_COLORS[item.skill_level] || Colors.muted;
  const levelLabel = LEVEL_LABELS[item.skill_level] || item.skill_level;
  const isSponsored = item.seller_type === 'sponsored';
  const isAffiliated = item.seller_type === 'affiliated';

  return (
    <View style={s.card} testID={`product-${item.product_id}`}>
      {/* Sponsored / Affiliated badge */}
      {(isSponsored || isAffiliated) && (
        <View style={[s.badge, isSponsored ? s.badgeSponsored : s.badgeAffiliated]}>
          <Ionicons name={isSponsored ? 'megaphone-outline' : 'link-outline'} size={10} color="#fff" />
          <Text style={s.badgeText}>{isSponsored ? 'Sponsorisé' : 'Affilié'}</Text>
        </View>
      )}

      <View style={s.cardRow}>
        {/* Image */}
        <View style={s.cardImg}>
          {item.image_url
            ? <TagImage uri={item.image_url} style={{ width: '100%', height: '100%' }} iconSize={24} placeholderColor="#1A2A4A" placeholderIcon="bag-outline" />
            : <View style={s.cardImgPlaceholder}><Ionicons name="bag-outline" size={24} color={COBALT + '40'} /></View>
          }
        </View>

        {/* Info */}
        <View style={s.cardInfo}>
          <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>

          {/* Price + type */}
          <View style={s.cardMetaRow}>
            <Text style={s.cardPrice}>
              {item.price > 0 ? `${item.price.toFixed(2).replace('.', ',')} \u20AC` : 'Gratuit'}
              {item.product_type === 'rental' && <Text style={s.cardPriceUnit}> / séance</Text>}
            </Text>
            <View style={s.typePill}>
              <Ionicons name={typeInfo.icon} size={10} color={COBALT} />
              <Text style={s.typeText}>{typeInfo.label}</Text>
            </View>
          </View>

          {/* Tags row: stock + level + seller */}
          <View style={s.cardTagsRow}>
            {/* Stock */}
            <View style={[s.microPill, { backgroundColor: item.in_stock ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)' }]}>
              <View style={[s.stockDot, { backgroundColor: item.in_stock ? '#34D399' : '#F87171' }]} />
              <Text style={[s.microPillText, { color: item.in_stock ? '#34D399' : '#F87171' }]}>
                {item.in_stock ? 'En stock' : 'Rupture'}
              </Text>
            </View>

            {/* Level */}
            <View style={[s.microPill, { backgroundColor: levelColor + '15' }]}>
              <Text style={[s.microPillText, { color: levelColor }]}>{levelLabel}</Text>
            </View>

            {/* Seller name if creator */}
            {item.seller_name && (
              <View style={[s.microPill, { backgroundColor: Colors.primary + '15' }]}>
                <Ionicons name="person-outline" size={9} color={Colors.primary} />
                <Text style={[s.microPillText, { color: Colors.primary }]} numberOfLines={1}>{item.seller_name}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%', paddingTop: 8 },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: COBALT_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COBALT_BORDER },
  headerTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },

  // Filters
  filtersWrap: { paddingHorizontal: Spacing.md, paddingBottom: 12, gap: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  filterPillActive: { backgroundColor: COBALT_DIM, borderColor: COBALT },
  filterText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  filterTextActive: { color: COBALT },

  // Center
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: Colors.muted, marginTop: 12 },

  // Section headers
  sectionHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: 16, paddingBottom: 8, gap: 8 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  sectionLine: { flex: 1, height: 1, backgroundColor: Colors.border },

  // Product card
  card: { marginHorizontal: Spacing.md, marginBottom: 10, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  cardRow: { flexDirection: 'row', padding: 10 },
  cardImg: { width: 80, height: 80, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: '#0F1A2E' },
  cardImgPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0F1A2E' },
  cardInfo: { flex: 1, marginLeft: 12, justifyContent: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 18, marginBottom: 4 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardPrice: { fontSize: 16, fontWeight: '800', color: COBALT },
  cardPriceUnit: { fontSize: 11, fontWeight: '500', color: Colors.muted },
  typePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: COBALT_DIM, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: COBALT_BORDER },
  typeText: { fontSize: 10, fontWeight: '700', color: COBALT },

  // Micro pills row
  cardTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  microPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  microPillText: { fontSize: 10, fontWeight: '600' },
  stockDot: { width: 5, height: 5, borderRadius: 3 },

  // Badges
  badge: { position: 'absolute', top: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderBottomLeftRadius: 10, zIndex: 2 },
  badgeSponsored: { backgroundColor: '#F59E0B' },
  badgeAffiliated: { backgroundColor: '#8B5CF6' },
  badgeText: { fontSize: 9, fontWeight: '700', color: '#fff', textTransform: 'uppercase' },
});
