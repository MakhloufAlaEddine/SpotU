/**
 * MarketplaceModal — Grille 2 colonnes avec badges source.
 * Cobalt Blue #3B82F6
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Modal, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, Dimensions, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { api } from '../lib/api';
import { TagImage } from './TagImage';

const COBALT        = '#3B82F6';
const COBALT_DIM    = 'rgba(59,130,246,0.12)';
const COBALT_BORDER = 'rgba(59,130,246,0.28)';
const SCREEN_W      = Dimensions.get('window').width;
const CARD_GAP      = 10;
const CARD_W        = (SCREEN_W - Spacing.md * 2 - CARD_GAP) / 2;
const IMG_H         = 130;

/* ─── Filtres ──────────────────────────────────────────────────────────── */
const FILTERS = [
  { key: 'all',      label: 'Tous'      },
  { key: 'owner',    label: 'Créateur'  },
  { key: 'other',    label: 'Autres'    },
  { key: 'service',  label: 'Services'  },
  { key: 'rental',   label: 'Location'  },
  { key: 'sale',     label: 'Vente'     },
] as const;

/* ─── Badge config ─────────────────────────────────────────────────────── */
const BADGE: Record<string, { bg: string; text: string }> = {
  owner: { bg: '#22C55E', text: '#fff' },
  other: { bg: Colors.muted, text: '#fff' },
};

const LEVEL_COLORS: Record<string, string> = {
  debutant:     '#34D399',
  intermediaire:'#FBBF24',
  avance:       '#F87171',
  tous:         Colors.muted,
};

interface Props {
  visible: boolean;
  onClose: () => void;
  spotYouId: string;
  tagIds?: string[];
}

/* ─── ProductCard ────────────────────────────────────────────────────────*/
function ProductCard({ item }: { item: any }) {
  const badgeCfg   = BADGE[item.badge_type] ?? BADGE.other;
  const isService  = item.item_type === 'service';
  const isRental   = !isService && item.product_type === 'rental';
  const outOfStock = !isService && item.in_stock === false;
  const isFree     = item.price === 0;
  const levelColor = LEVEL_COLORS[item.skill_level] ?? Colors.muted;

  const imageUri = isService
    ? (Array.isArray(item.images) ? item.images[0] : null)
    : item.image_url;

  const priceLabel = isFree
    ? 'Gratuit'
    : isService
    ? `Dès ${Number(item.price).toFixed(0)} €`
    : `${Number(item.price).toFixed(2)} €${isRental ? '/séance' : ''}`;

  return (
    <View style={[s.card, outOfStock && s.cardOut]}>
      {/* ── Image ── */}
      <View style={s.imgWrap}>
        <TagImage uri={imageUri} tagIds={item.tag_ids || []} style={s.img} />
        {/* Badge owner/other */}
        <View style={[s.badge, { backgroundColor: badgeCfg.bg }]}>
          <Ionicons name={item.badge_type === 'owner' ? 'star' : 'person-outline'} size={9} color={badgeCfg.text} />
          <Text style={[s.badgeText, { color: badgeCfg.text }]} numberOfLines={1}>{item.badge_label || 'Autre'}</Text>
        </View>
        {/* Type pill */}
        <View style={[s.typePill, isService ? s.typePillService : isRental ? s.typePillRent : s.typePillSale]}>
          <Text style={s.typePillText}>{isService ? 'Service' : isRental ? 'Location' : 'Vente'}</Text>
        </View>
        {outOfStock && (
          <View style={s.outOverlay}><Text style={s.outText}>Indisponible</Text></View>
        )}
      </View>

      {/* ── Infos ── */}
      <View style={s.info}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <Text style={s.desc} numberOfLines={2}>{item.description}</Text>

        <View style={s.row}>
          <Text style={[s.price, isFree && { color: '#22C55E' }]}>{priceLabel}</Text>
          {isService && item.duration_min ? (
            <View style={[s.lvlPill, { backgroundColor: '#F59E0B22', borderColor: '#F59E0B55' }]}>
              <Text style={[s.lvlText, { color: '#F59E0B' }]}>{item.duration_min} min</Text>
            </View>
          ) : !isService && item.skill_level && item.skill_level !== 'tous' ? (
            <View style={[s.lvlPill, { backgroundColor: levelColor + '22', borderColor: levelColor + '55' }]}>
              <Text style={[s.lvlText, { color: levelColor }]}>
                {item.skill_level === 'debutant' ? 'Débutant' : item.skill_level === 'intermediaire' ? 'Inter.' : 'Avancé'}
              </Text>
            </View>
          ) : null}
        </View>

        {isService && item.coach_name ? (
          <View style={s.sellerRow}>
            <Ionicons name="person-circle-outline" size={12} color={COBALT} />
            <Text style={[s.sellerName, { color: COBALT, fontWeight: '600' }]} numberOfLines={1}>{item.coach_name}</Text>
          </View>
        ) : !isService && item.seller_name ? (
          <View style={s.sellerRow}>
            <Ionicons name="person-outline" size={10} color={Colors.muted} />
            <Text style={s.sellerName} numberOfLines={1}>{item.seller_name}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ─── Cache module-level ─────────────────────────────────────────────────*/
const productCache = new Map<string, any[]>();

/* ─── Modal principal ────────────────────────────────────────────────────*/
type LoadState = 'loading' | 'refreshing' | 'error' | 'empty' | 'loaded';

export function MarketplaceModal({ visible, onClose, spotYouId, tagIds }: Props) {
  const [products,  setProducts]  = useState<any[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [filter,    setFilter]    = useState<string>('all');

  const cacheKey = `${spotYouId}::${tagIds?.join(',') ?? ''}`;

  const load = useCallback((silent = false) => {
    // Si cache dispo, afficher immédiatement + rafraîchir en arrière-plan
    const cached = productCache.get(cacheKey);
    if (cached) {
      setProducts(cached);
      setLoadState(silent ? 'refreshing' : 'loaded');
      if (silent) return; // ne pas refetch si déjà en mode silencieux
    } else {
      setLoadState('loading');
    }

    const parts: string[] = [`spotyou_id=${spotYouId}`];
    if (tagIds?.length) parts.push(`tag_ids=${tagIds.join(',')}`);

    api.get(`/marketplace/products?${parts.join('&')}`)
      .then((d: any) => {
        const list = d.products || [];
        productCache.set(cacheKey, list);
        setProducts(list);
        setLoadState(list.length === 0 ? 'empty' : 'loaded');
      })
      .catch(() => {
        // Si on a un cache, garder les données mais indiquer l'erreur réseau discrètement
        if (productCache.has(cacheKey)) {
          setLoadState('loaded'); // cache toujours valide
        } else {
          setLoadState('error');
        }
      });
  }, [cacheKey, spotYouId, tagIds]);

  useEffect(() => {
    if (visible) {
      setFilter('all');
      // Si cache dispo : affichage immédiat + refresh silencieux en arrière-plan
      const hasCached = productCache.has(cacheKey);
      load(hasCached);
      if (hasCached) {
        // refresh en background après 300ms
        const t = setTimeout(() => load(false), 300);
        return () => clearTimeout(t);
      }
    }
  }, [visible, cacheKey]);

  const filtered = products.filter(p => {
    if (filter === 'all')     return true;
    if (filter === 'owner')   return p.badge_type === 'owner';
    if (filter === 'other')   return p.badge_type === 'other';
    if (filter === 'service') return p.item_type === 'service';
    if (filter === 'rental')  return p.item_type === 'product' && p.product_type === 'rental';
    if (filter === 'sale')    return p.item_type === 'product' && p.product_type === 'sale';
    return true;
  });

  const ownerCount = products.filter(p => p.badge_type === 'owner').length;
  const otherCount = products.filter(p => p.badge_type === 'other').length;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.container}>

        {/* ── Header ── */}
        <View style={s.header}>
          <View style={[s.headerIcon, { backgroundColor: COBALT_DIM, borderColor: COBALT_BORDER }]}>
            <Ionicons name="storefront-outline" size={20} color={COBALT} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Boutique</Text>
            <Text style={s.headerSub}>
              {loadState === 'loading'
                ? 'Chargement…'
                : loadState === 'error'
                ? 'Erreur réseau'
                : `${products.length} produit${products.length > 1 ? 's' : ''} lié${products.length > 1 ? 's' : ''}`}
            </Text>
          </View>
          <TouchableOpacity style={s.closeBtn} onPress={onClose} testID="marketplace-close-btn">
            <Ionicons name="close" size={22} color={Colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* ── Légende badges ── */}
        {(loadState === 'loaded' || loadState === 'refreshing') && (ownerCount > 0 || otherCount > 0) && (
          <View style={s.legendRow}>
            {ownerCount > 0 && (
              <View style={[s.legendPill, { backgroundColor: '#22C55E22', borderColor: '#22C55E55' }]}>
                <Ionicons name="star" size={10} color="#22C55E" />
                <Text style={[s.legendText, { color: '#22C55E' }]}>{ownerCount} du créateur</Text>
              </View>
            )}
            {otherCount > 0 && (
              <View style={[s.legendPill, { backgroundColor: Colors.muted + '22', borderColor: Colors.muted + '55' }]}>
                <Ionicons name="person-outline" size={10} color={Colors.muted} />
                <Text style={[s.legendText, { color: Colors.muted }]}>{otherCount} autres utilisateurs</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Filtres ── */}
        <View style={s.filtersContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.filtersWrap}
          >
            {(FILTERS as ReadonlyArray<{ key: string; label: string }>).map((f) => {
              const active = filter === f.key;
              return (
                <TouchableOpacity
                  key={f.key}
                  style={[s.filterChip, active && s.filterChipActive]}
                  onPress={() => setFilter(f.key)}
                  testID={`marketplace-filter-${f.key}`}
                >
                  <Text style={[s.filterLabel, active && s.filterLabelActive]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Contenu ── */}
        {loadState === 'loading' ? (
          <View style={s.center}>
            <ActivityIndicator size="large" color={COBALT} />
            <Text style={s.loadingText}>Chargement des produits…</Text>
          </View>
        ) : loadState === 'error' ? (
          /* ── Erreur réseau ── */
          <View style={s.center}>
            <View style={s.errorIconWrap}>
              <Ionicons name="wifi-outline" size={40} color="#EF4444" />
            </View>
            <Text style={s.errorTitle}>Connexion impossible</Text>
            <Text style={s.errorSub}>Vérifiez votre connexion internet{'\n'}et réessayez.</Text>
            <TouchableOpacity style={s.retryBtn} onPress={() => load(false)} testID="marketplace-retry-btn">
              <Ionicons name="refresh-outline" size={16} color="#fff" />
              <Text style={s.retryText}>Réessayer</Text>
            </TouchableOpacity>
          </View>
        ) : loadState === 'empty' || (loadState === 'loaded' && filtered.length === 0) ? (
          /* ── Vraiment vide (pas d'erreur réseau) ── */
          <View style={s.center}>
            <View style={s.emptyIconWrap}>
              <Ionicons name="basket-outline" size={40} color={Colors.muted} />
            </View>
            <Text style={s.emptyTitle}>
              {loadState === 'empty' && filter === 'all'
                ? 'Aucun produit associé'
                : 'Aucun produit pour ce filtre'}
            </Text>
            <Text style={s.emptySub}>
              {loadState === 'empty' && filter === 'all'
                ? 'Aucun équipement n\'est encore lié aux tags de ce SpotYou.'
                : filter === 'owner'
                ? 'Le créateur n\'a pas encore ajouté de produits.'
                : filter === 'other'
                ? 'Aucun produit d\'autres utilisateurs pour ces tags.'
                : 'Essayez un autre filtre.'}
            </Text>
            {filter !== 'all' && (
              <TouchableOpacity style={s.resetFilterBtn} onPress={() => setFilter('all')}>
                <Text style={s.resetFilterText}>Voir tous les produits</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={i => i.product_id}
            numColumns={2}
            columnWrapperStyle={s.columnWrapper}
            contentContainerStyle={s.gridContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <ProductCard item={item} />}
          />
        )}
      </View>
    </Modal>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────*/
const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: Colors.background },
  header:          { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerIcon:      { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle:     { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerSub:       { fontSize: 12, color: Colors.muted, marginTop: 1 },
  closeBtn:        { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },

  legendRow:       { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 8, flexWrap: 'wrap' },
  legendPill:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  legendText:      { fontSize: 11, fontWeight: '600' },

  filtersContainer:  { height: 50, marginBottom: 2 },
  filtersWrap:     { paddingHorizontal: Spacing.md, alignItems: 'center', flexDirection: 'row', paddingVertical: 8 },
  filterChip:      { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, marginRight: 8 },
  filterChipActive:{ backgroundColor: COBALT, borderColor: COBALT },
  filterLabel:     { fontSize: 13, color: Colors.muted, fontWeight: '500' },
  filterLabelActive:{ color: '#fff' },

  gridContent:     { paddingHorizontal: Spacing.md, paddingBottom: 40 },
  columnWrapper:   { gap: CARD_GAP, marginBottom: CARD_GAP },

  /* Card */
  card:            { width: CARD_W, borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  cardOut:         { opacity: 0.55 },

  imgWrap:         { width: '100%', height: IMG_H, position: 'relative' },
  img:             { width: '100%', height: IMG_H },

  badge:           { position: 'absolute', top: 7, left: 7, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10, maxWidth: CARD_W - 14 },
  badgeText:       { fontSize: 10, fontWeight: '700' },

  typePill:        { position: 'absolute', bottom: 7, right: 7, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  typePillSale:    { backgroundColor: 'rgba(0,0,0,0.55)' },
  typePillRent:    { backgroundColor: 'rgba(59,130,246,0.75)' },
  typePillService: { backgroundColor: 'rgba(249,115,22,0.85)' },
  typePillText:    { fontSize: 10, fontWeight: '600', color: '#fff' },

  outOverlay:      { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  outText:         { fontSize: 12, fontWeight: '700', color: '#fff', textTransform: 'uppercase' },

  info:            { padding: 10, gap: 4 },
  title:           { fontSize: 13, fontWeight: '700', color: Colors.foreground, lineHeight: 17 },
  desc:            { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  row:             { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  price:           { fontSize: 14, fontWeight: '800', color: COBALT },
  lvlPill:         { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  lvlText:         { fontSize: 9, fontWeight: '600' },
  sellerRow:       { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  sellerName:      { fontSize: 10, color: Colors.muted },

  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, gap: 10 },
  loadingText:     { fontSize: 14, color: Colors.muted, marginTop: 8 },

  errorIconWrap:   { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  errorTitle:      { fontSize: 17, fontWeight: '700', color: '#EF4444' },
  errorSub:        { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  retryBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: '#EF4444' },
  retryText:       { fontSize: 14, fontWeight: '700', color: '#fff' },

  emptyIconWrap:   { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  emptyTitle:      { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  emptySub:        { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  resetFilterBtn:  { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COBALT },
  resetFilterText: { fontSize: 14, fontWeight: '600', color: COBALT },
});
