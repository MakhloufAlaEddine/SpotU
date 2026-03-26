/**
 * Écran Boutique — grille 2 colonnes de produits/services liés à un SpotYou.
 * Remplace MarketplaceModal (modal → écran avec navigation).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, FlatList,
  ActivityIndicator, StyleSheet, Dimensions, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '../../constants/Colors';
import { api } from '../../lib/api';
import { TagImage } from '../../components/TagImage';
import { useCart } from '../../context/CartContext';
import { marketplaceStore } from '../../lib/marketplaceStore';

/* ─── Constantes ──────────────────────────────────────────────────────────── */
const COBALT        = '#3B82F6';
const COBALT_DIM    = 'rgba(59,130,246,0.12)';
const COBALT_BORDER = 'rgba(59,130,246,0.28)';
const ORANGE        = '#FF9500';
const ORANGE_DIM    = 'rgba(255,149,0,0.15)';
const ORANGE_BDR    = 'rgba(255,149,0,0.3)';
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

/* ─── Config modes de remise ─────────────────────────────────────────────*/
const DELIVERY_CFG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  local_pickup:    { icon: 'location-outline',  label: 'Sur place',         color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
  creator_handoff: { icon: 'person-outline',     label: 'Par le créateur',   color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)'  },
  digital:         { icon: 'globe-outline',      label: 'En ligne',          color: '#22C55E', bg: 'rgba(34,197,94,0.12)'   },
  external:        { icon: 'open-outline',       label: 'Site partenaire',   color: '#64748B', bg: 'rgba(100,116,139,0.12)' },
};

/* ─── Cache module-level ─────────────────────────────────────────────────*/
const productCache = new Map<string, any[]>();

/* ─── DeliveryBadges ─────────────────────────────────────────────────────*/
function DeliveryBadges({ modes }: { modes?: string[] }) {
  if (!modes?.length) return null;
  return (
    <View style={s.deliveryRow}>
      {modes.map(m => {
        const cfg = DELIVERY_CFG[m];
        if (!cfg) return null;
        return (
          <View key={m} style={[s.deliveryChip, { backgroundColor: cfg.bg }]}>
            <Ionicons name={cfg.icon as any} size={9} color={cfg.color} />
            <Text style={[s.deliveryTxt, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

/* ─── CartAddButton ──────────────────────────────────────────────────────*/
function CartAddButton({ item }: { item: any }) {
  const { addItem, items, updateQty } = useCart();
  const inCart = items.find((i: any) => i.product_id === item.product_id);

  if (inCart) {
    return (
      <View style={s.addedRow}>
        <TouchableOpacity
          onPress={() => updateQty(item.product_id, inCart.quantity - 1)}
          style={s.addedQtyBtn}
          testID={`cart-minus-${item.product_id}`}
        >
          <Ionicons name="remove" size={12} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.addedQtyVal}>{inCart.quantity}</Text>
        <TouchableOpacity
          onPress={() => updateQty(item.product_id, inCart.quantity + 1)}
          style={s.addedQtyBtn}
          testID={`cart-plus-${item.product_id}`}
        >
          <Ionicons name="add" size={12} color={Colors.foreground} />
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={s.addCartBtn}
      onPress={() => addItem({
        product_id:           item.product_id,
        title:                item.title,
        price:                item.price ?? 0,
        image_url:            item.image_url,
        tag_ids:              item.tag_ids,
        product_type:         item.product_type,
        rental_duration_unit: item.rental_duration_unit,
        rental_duration_qty:  item.rental_duration_qty,
        seller_name:          item.seller_name,
      })}
      activeOpacity={0.8}
      testID={`add-to-cart-${item.product_id}`}
    >
      <Ionicons name="add" size={13} color="#fff" />
      <Text style={s.addCartTxt}>Ajouter</Text>
    </TouchableOpacity>
  );
}

/* ─── ServiceCard ────────────────────────────────────────────────────────*/
function ServiceCard({ item }: { item: any }) {
  const badgeCfg  = BADGE[item.badge_type] ?? BADGE.other;
  const isFree    = item.price === 0;
  const initial   = item.coach_name?.charAt(0)?.toUpperCase() || 'C';

  return (
    <View style={[s.card, sv.card]}>
      <View style={s.imgWrap}>
        <TagImage
          uri={Array.isArray(item.images) ? item.images[0] : null}
          tagIds={item.tag_ids || []}
          style={s.img}
        />
        <View style={sv.imgOverlay} />
        <View style={sv.serviceBadge}>
          <Text style={sv.serviceBadgeTxt}>SERVICE</Text>
        </View>
        <View style={[s.badge, { backgroundColor: badgeCfg.bg, top: 7, left: 7 }]}>
          <Ionicons name={item.badge_type === 'owner' ? 'star' : 'person-outline'} size={9} color={badgeCfg.text} />
          <Text style={[s.badgeText, { color: badgeCfg.text }]} numberOfLines={1}>{item.badge_label}</Text>
        </View>
      </View>
      <View style={s.info}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <View style={sv.coachRow}>
          <View style={sv.coachAvatar}>
            {item.coach_picture
              ? <Image source={{ uri: item.coach_picture }} style={{ width: '100%', height: '100%' }} />
              : <Text style={sv.coachAvatarTxt}>{initial}</Text>}
          </View>
          <Text style={sv.coachName} numberOfLines={1}>{item.coach_name || 'Coach'}</Text>
        </View>
        <View style={s.row}>
          <Text style={sv.price}>{isFree ? 'Gratuit' : `Dès ${Number(item.price).toFixed(0)} €`}</Text>
          {item.duration_min && (
            <View style={sv.durationChip}>
              <Ionicons name="time-outline" size={9} color={ORANGE} />
              <Text style={sv.durationTxt}>{item.duration_min} min</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

/* ─── ProductCard ────────────────────────────────────────────────────────*/
function ProductCard({ item }: { item: any }) {
  if (item.item_type === 'service') return <ServiceCard item={item} />;

  const badgeCfg   = BADGE[item.badge_type] ?? BADGE.other;
  const isRental   = item.product_type === 'rental';
  const outOfStock = item.in_stock === false;
  const isFree     = item.price === 0;
  const levelColor = LEVEL_COLORS[item.skill_level] ?? Colors.muted;

  const rentalSuffix = (() => {
    if (!isRental) return '';
    const unit = item.rental_duration_unit;
    const qty  = item.rental_duration_qty ?? 1;
    if (!unit) return '/séance';
    const labels: Record<string, [string, string]> = {
      heure:   ['h',        'h'],
      jour:    ['jour',     'jours'],
      semaine: ['semaine',  'semaines'],
      mois:    ['mois',     'mois'],
    };
    const [singular, plural] = labels[unit] ?? [unit, unit];
    return qty > 1 ? `/${qty} ${plural}` : `/${singular}`;
  })();

  const priceLabel = isFree ? 'Gratuit' : `${Number(item.price).toFixed(2)} €${rentalSuffix}`;

  return (
    <View style={[s.card, outOfStock && s.cardOut]}>
      <View style={s.imgWrap}>
        <TagImage uri={item.image_url} tagIds={item.tag_ids || []} style={s.img} />
        <View style={[s.badge, { backgroundColor: badgeCfg.bg }]}>
          <Ionicons name={item.badge_type === 'owner' ? 'star' : 'person-outline'} size={9} color={badgeCfg.text} />
          <Text style={[s.badgeText, { color: badgeCfg.text }]} numberOfLines={1}>{item.badge_label || 'Autre'}</Text>
        </View>
        <View style={[s.typePill, isRental ? s.typePillRent : s.typePillSale]}>
          <Text style={s.typePillText}>{isRental ? 'Location' : 'Vente'}</Text>
        </View>
        {item.delivery_modes?.length > 0 && (
          <View style={s.deliveryOverlay}>
            {(item.delivery_modes as string[]).map((m: string) => {
              const cfg = DELIVERY_CFG[m];
              if (!cfg) return null;
              return (
                <View key={m} style={[s.deliveryIconBubble, { backgroundColor: cfg.color }]}>
                  <Ionicons name={cfg.icon as any} size={11} color="#fff" />
                </View>
              );
            })}
          </View>
        )}
        {outOfStock && <View style={s.outOverlay}><Text style={s.outText}>Indisponible</Text></View>}
      </View>
      <View style={s.info}>
        <Text style={s.title} numberOfLines={2}>{item.title}</Text>
        <Text style={s.desc} numberOfLines={2}>{item.description}</Text>
        <View style={s.row}>
          <Text style={[s.price, isFree && { color: '#22C55E' }]}>{priceLabel}</Text>
          {item.skill_level && item.skill_level !== 'tous' && (
            <View style={[s.lvlPill, { backgroundColor: levelColor + '22', borderColor: levelColor + '55' }]}>
              <Text style={[s.lvlText, { color: levelColor }]}>
                {item.skill_level === 'debutant' ? 'Débutant' : item.skill_level === 'intermediaire' ? 'Inter.' : 'Avancé'}
              </Text>
            </View>
          )}
        </View>
        {item.seller_name && (
          <View style={s.sellerRow}>
            <Ionicons name="person-outline" size={10} color={Colors.muted} />
            <Text style={s.sellerName} numberOfLines={1}>{item.seller_name}</Text>
          </View>
        )}
        {item.is_physical && (item.dist_from_spotyou_fmt || item.dist_from_user_fmt) && (
          <View style={s.distRow}>
            {item.dist_from_spotyou_fmt && (
              <View style={[s.distChip, s.distChipSpot]}>
                <Ionicons name="location" size={9} color={COBALT} />
                <Text style={[s.distTxt, { color: COBALT }]}>{item.dist_from_spotyou_fmt}</Text>
              </View>
            )}
            {item.dist_from_user_fmt && (
              <View style={[s.distChip, s.distChipUser]}>
                <Ionicons name="navigate" size={9} color="#22C55E" />
                <Text style={[s.distTxt, { color: '#22C55E' }]}>{item.dist_from_user_fmt}</Text>
              </View>
            )}
          </View>
        )}
        {!outOfStock && <CartAddButton item={item} />}
      </View>
    </View>
  );
}

/* ─── Écran principal ────────────────────────────────────────────────────*/
type LoadState = 'loading' | 'error' | 'empty' | 'loaded';

export default function MarketplaceScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    spotYouId: string;
    tagIds?: string;
    userLat?: string;
    userLng?: string;
  }>();

  const spotYouId = params.spotYouId;
  const tagIds    = params.tagIds ? params.tagIds.split(',').filter(Boolean) : [];
  const userLat   = params.userLat ? parseFloat(params.userLat) : undefined;
  const userLng   = params.userLng ? parseFloat(params.userLng) : undefined;

  const [products,  setProducts]  = useState<any[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [filter,    setFilter]    = useState<string>('all');
  const { totalItems } = useCart();

  const cacheKey = `${spotYouId}::${tagIds.join(',')}::${userLat ?? ''}::${userLng ?? ''}`;

  const load = useCallback((silent = false) => {
    const cached = productCache.get(cacheKey);
    if (cached) {
      setProducts(cached);
      marketplaceStore.setProducts(cached);
      setLoadState('loaded');
      if (silent) return;
    } else {
      setLoadState('loading');
    }

    const parts: string[] = [`spotyou_id=${spotYouId}`];
    if (tagIds.length) parts.push(`tag_ids=${tagIds.join(',')}`);
    if (userLat != null && userLng != null) {
      parts.push(`user_lat=${userLat}&user_lng=${userLng}`);
    }

    api.get(`/marketplace/products?${parts.join('&')}`)
      .then((d: any) => {
        const list = d.products || [];
        productCache.set(cacheKey, list);
        setProducts(list);
        marketplaceStore.setProducts(list);
        setLoadState(list.length === 0 ? 'empty' : 'loaded');
      })
      .catch(() => {
        if (productCache.has(cacheKey)) {
          setLoadState('loaded');
        } else {
          setLoadState('error');
        }
      });
  }, [cacheKey, spotYouId, tagIds.join(','), userLat, userLng]);

  useEffect(() => {
    const hasCached = productCache.has(cacheKey);
    load(hasCached);
    if (hasCached) {
      const t = setTimeout(() => load(false), 300);
      return () => clearTimeout(t);
    }
  }, [cacheKey]);

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

  const openDetail = (item: any) => {
    marketplaceStore.setSelected(item);
    router.push('/marketplace/product-detail' as any);
  };

  return (
    <SafeAreaView style={s.container} edges={['top']}>

      {/* ── Header ── */}
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="marketplace-back-btn">
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
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
        {totalItems > 0 && (
          <TouchableOpacity style={s.headerCartBtn} onPress={() => router.push('/cart' as any)} testID="marketplace-cart-header-btn">
            <Ionicons name="cart-outline" size={20} color={COBALT} />
            <View style={s.headerCartBadge}>
              <Text style={s.headerCartBadgeTxt}>{totalItems}</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Légende badges ── */}
      {loadState === 'loaded' && (ownerCount > 0 || otherCount > 0) && (
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
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtersWrap}>
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
        <View style={s.center}>
          <View style={s.emptyIconWrap}>
            <Ionicons name="basket-outline" size={40} color={Colors.muted} />
          </View>
          <Text style={s.emptyTitle}>
            {loadState === 'empty' && filter === 'all' ? 'Aucun produit associé' : 'Aucun produit pour ce filtre'}
          </Text>
          <Text style={s.emptySub}>
            {loadState === 'empty' && filter === 'all'
              ? "Aucun équipement n'est encore lié aux tags de ce SpotYou."
              : filter === 'owner'
              ? "Le créateur n'a pas encore ajouté de produits."
              : filter === 'other'
              ? "Aucun produit d'autres utilisateurs pour ces tags."
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
          keyExtractor={i => i.product_id ?? i.service_id}
          numColumns={2}
          columnWrapperStyle={s.columnWrapper}
          contentContainerStyle={s.gridContent}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openDetail(item)}
              testID={`open-detail-${item.product_id ?? item.service_id}`}
            >
              <ProductCard item={item} />
            </TouchableOpacity>
          )}
        />
      )}

      {/* ── Bouton flottant panier ── */}
      {totalItems > 0 && (
        <TouchableOpacity
          style={s.floatingCartBtn}
          onPress={() => router.push('/cart' as any)}
          activeOpacity={0.9}
          testID="marketplace-floating-cart-btn"
        >
          <Ionicons name="cart" size={22} color="#fff" />
          <View style={s.floatingCartBadge}>
            <Text style={s.floatingCartBadgeTxt}>{totalItems}</Text>
          </View>
        </TouchableOpacity>
      )}

    </SafeAreaView>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────*/
const s = StyleSheet.create({
  container:        { flex: 1, backgroundColor: Colors.background },
  header:           { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:          { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerIcon:       { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerTitle:      { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerSub:        { fontSize: 12, color: Colors.muted, marginTop: 1 },

  legendRow:        { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, paddingVertical: 8, flexWrap: 'wrap' },
  legendPill:       { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  legendText:       { fontSize: 11, fontWeight: '600' },

  filtersContainer: { height: 50, marginBottom: 2 },
  filtersWrap:      { paddingHorizontal: Spacing.md, alignItems: 'center', flexDirection: 'row', paddingVertical: 8 },
  filterChip:       { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, marginRight: 8 },
  filterChipActive: { backgroundColor: COBALT, borderColor: COBALT },
  filterLabel:      { fontSize: 13, color: Colors.muted, fontWeight: '500' },
  filterLabelActive:{ color: '#fff' },

  gridContent:      { paddingHorizontal: Spacing.md, paddingBottom: 80 },
  columnWrapper:    { gap: CARD_GAP, marginBottom: CARD_GAP },

  card:             { width: CARD_W, borderRadius: 14, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  cardOut:          { opacity: 0.55 },
  imgWrap:          { width: '100%', height: IMG_H, position: 'relative' },
  img:              { width: '100%', height: IMG_H },
  badge:            { position: 'absolute', top: 7, left: 7, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 10, maxWidth: CARD_W - 14 },
  badgeText:        { fontSize: 10, fontWeight: '700' },
  typePill:         { position: 'absolute', bottom: 7, right: 7, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8 },
  typePillSale:     { backgroundColor: 'rgba(0,0,0,0.55)' },
  typePillRent:     { backgroundColor: 'rgba(59,130,246,0.75)' },
  typePillText:     { fontSize: 10, fontWeight: '600', color: '#fff' },
  outOverlay:       { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  outText:          { fontSize: 12, fontWeight: '700', color: '#fff', textTransform: 'uppercase' },
  info:             { padding: 10, gap: 4 },
  title:            { fontSize: 13, fontWeight: '700', color: Colors.foreground, lineHeight: 17 },
  desc:             { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  row:              { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  price:            { fontSize: 14, fontWeight: '800', color: COBALT },
  lvlPill:          { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  lvlText:          { fontSize: 9, fontWeight: '600' },
  sellerRow:        { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  sellerName:       { fontSize: 10, color: Colors.muted },
  distRow:          { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  distChip:         { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  distChipSpot:     { backgroundColor: 'rgba(59,130,246,0.08)', borderColor: 'rgba(59,130,246,0.25)' },
  distChipUser:     { backgroundColor: 'rgba(34,197,94,0.08)',  borderColor: 'rgba(34,197,94,0.25)'  },
  distTxt:          { fontSize: 10, fontWeight: '600' },
  deliveryRow:      { flexDirection: 'row', gap: 4, marginTop: 5, flexWrap: 'wrap' },
  deliveryChip:     { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 6 },
  deliveryTxt:      { fontSize: 9, fontWeight: '600' },
  deliveryOverlay:  { position: 'absolute', bottom: 7, left: 7, flexDirection: 'row', gap: 5 },
  deliveryIconBubble:{ width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },

  addCartBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: COBALT, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 5, marginTop: 8, alignSelf: 'center' },
  addCartTxt:       { fontSize: 11, fontWeight: '700', color: '#fff' },
  addedRow:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card, borderRadius: 20, height: 26, marginTop: 8, borderWidth: 1, borderColor: COBALT + '55', overflow: 'hidden', alignSelf: 'center', width: 100 },
  addedQtyBtn:      { flex: 1, alignItems: 'center', justifyContent: 'center', height: 26 },
  addedQtyVal:      { minWidth: 24, textAlign: 'center', fontSize: 12, fontWeight: '800', color: Colors.foreground },

  floatingCartBtn:      { position: 'absolute', bottom: 32, right: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: COBALT, alignItems: 'center', justifyContent: 'center', shadowColor: COBALT, shadowOpacity: 0.55, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 10 },
  floatingCartBadge:    { position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  floatingCartBadgeTxt: { fontSize: 10, fontWeight: '800', color: '#fff' },

  headerCartBtn:        { position: 'relative', width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCartBadge:      { position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  headerCartBadgeTxt:   { fontSize: 9, fontWeight: '800', color: '#fff' },

  center:           { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.md, gap: 10 },
  loadingText:      { fontSize: 14, color: Colors.muted, marginTop: 8 },
  errorIconWrap:    { width: 72, height: 72, borderRadius: 36, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  errorTitle:       { fontSize: 17, fontWeight: '700', color: '#EF4444' },
  errorSub:         { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  retryBtn:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, backgroundColor: '#EF4444' },
  retryText:        { fontSize: 14, fontWeight: '700', color: '#fff' },
  emptyIconWrap:    { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, marginBottom: 4 },
  emptyTitle:       { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  emptySub:         { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  resetFilterBtn:   { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: COBALT },
  resetFilterText:  { fontSize: 14, fontWeight: '600', color: COBALT },
});

/* ─── Styles spécifiques service ─────────────────────────────────────────*/
const sv = StyleSheet.create({
  card:           { borderColor: ORANGE_BDR, borderWidth: 1.5 },
  imgOverlay:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.22)' },
  serviceBadge:   { position: 'absolute', bottom: 7, right: 7, backgroundColor: ORANGE, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  serviceBadgeTxt:{ fontSize: 8, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  coachRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  coachAvatar:    { width: 18, height: 18, borderRadius: 9, backgroundColor: ORANGE, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  coachAvatarTxt: { fontSize: 8, fontWeight: '800', color: '#fff' },
  coachName:      { fontSize: 11, color: Colors.muted, flex: 1 },
  price:          { fontSize: 14, fontWeight: '800', color: ORANGE },
  durationChip:   { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: ORANGE_DIM, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  durationTxt:    { fontSize: 9, color: ORANGE, fontWeight: '600' },
});
