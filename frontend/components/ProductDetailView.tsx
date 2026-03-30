/**
 * ProductDetailView — composant partagé enrichi
 *   - Non-owner : galerie, prix, infos, conditions inline, vendeur, CTA "Louer"
 *   - Owner     : même contenu + badge statut + CTA "Modifier / Supprimer"
 */
import React, { useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  NativeScrollEvent, NativeSyntheticEvent, Dimensions, FlatList, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { TagImage } from './TagImage';

const { width: SW } = Dimensions.get('window');

const COBALT      = '#3B82F6';
const COBALT_DIM  = 'rgba(59,130,246,0.10)';
const ORANGE      = '#FF9500';
const GREEN       = '#22C55E';
const DANGER      = '#EF4444';
const IMG_H       = 300;

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const PICKUP_CFG: Record<string, { icon: string; label: string; color: string }> = {
  local_pickup:    { icon: 'location-outline',  label: 'Sur place',       color: ORANGE  },
  creator_handoff: { icon: 'person-outline',     label: 'Par le créateur', color: '#8B5CF6' },
  digital:         { icon: 'globe-outline',      label: 'En ligne',        color: GREEN   },
};

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  active:         { label: 'Publié',             color: GREEN,  bg: GREEN  + '18', icon: 'checkmark-circle'    },
  approved:       { label: 'Publié',             color: GREEN,  bg: GREEN  + '18', icon: 'checkmark-circle'    },
  pending_review: { label: 'En attente',         color: ORANGE, bg: ORANGE + '18', icon: 'hourglass-outline'   },
  draft:          { label: 'Brouillon',          color: Colors.muted, bg: 'rgba(255,255,255,0.06)', icon: 'document-outline' },
  inactive:       { label: 'Inactif',            color: Colors.muted, bg: 'rgba(255,255,255,0.06)', icon: 'pause-circle-outline' },
  rejected:       { label: 'Refusé',             color: DANGER, bg: DANGER + '18', icon: 'close-circle'        },
};

const MODE_LABELS: Record<string, { label: string; field: string }> = {
  hour:    { label: '/h',     field: 'price_per_hour'    },
  day:     { label: '/jour',  field: 'price_per_day'     },
  week:    { label: '/sem',   field: 'price_per_week'    },
  month:   { label: '/mois',  field: 'price_per_month'   },
  session: { label: '/séance',field: 'price_per_session' },
};

const LEVEL_LABELS: Record<string, string> = {
  debutant: 'Débutant', intermediaire: 'Intermédiaire', avance: 'Avancé', tous: 'Tous niveaux',
};

function cleanCategory(raw: string): string {
  if (!raw) return '';
  return raw.replace(/^cat_prd_/, '').replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function Stars({ value }: { value: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1,2,3,4,5].map(i => (
        <Ionicons key={i} name={i <= Math.round(value) ? 'star' : 'star-outline'} size={12} color="#FBBF24" />
      ))}
    </View>
  );
}

/* ─── Props ──────────────────────────────────────────────────────────────── */
export interface ProductDetailViewProps {
  item: any;
  allItems?: any[];
  onBack: () => void;
  isOwner?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onCta?: (item: any) => void;
}

/* ─── Composant principal ────────────────────────────────────────────────── */
export function ProductDetailView({
  item, allItems = [], onBack,
  isOwner = false, onEdit, onDelete, onCta,
}: ProductDetailViewProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const [condOpen,     setCondOpen]     = useState(false);
  const [galleryIdx,   setGalleryIdx]   = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  /* Images */
  const images: string[] = (() => {
    const urls = item.image_urls ?? [];
    if (urls.length > 0) return urls;
    if (item.image_url) return [item.image_url];
    return [];
  })();

  /* Pricing chips */
  const pricingChips = (item.pricing_modes ?? []).map((mode: string) => {
    const cfg   = MODE_LABELS[mode];
    const price = cfg ? item[cfg.field] : null;
    return cfg && price ? { mode, label: cfg.label, price } : null;
  }).filter(Boolean);

  /* Info vendeur */
  const sellerName    = item.seller_name    || 'SpotU';
  const sellerPicture = item.seller_picture_url || item.seller_picture || null;
  const sellerId      = item.seller_id      || null;
  const sellerStats   = item.seller_stats   || {};
  const sellerInitial = sellerName.charAt(0).toUpperCase();

  /* Status */
  const statusCfg = STATUS_CFG[item.status] || STATUS_CFG.draft;

  /* Autres produits du même vendeur */
  const otherProducts = sellerId
    ? allItems.filter(i =>
        (i.seller_id === sellerId) &&
        (i.product_id !== item.product_id) &&
        i.item_type === 'product')
    : [];

  /* Category label */
  const catLabel = item.category_label || cleanCategory(item.category || '');

  /* Return/cancel rules */
  const hasReturnRules = !!(item.return_rules?.trim());
  const hasCancelRules = !!(item.cancellation_rules?.trim());
  const hasConditions  = hasReturnRules || hasCancelRules;

  const longDesc = (item.description || '').length > 200;

  /* Gallery scroll handler */
  const onGalleryScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SW);
    setGalleryIdx(idx);
  };

  return (
    <View style={d.root} testID="product-detail-view">
      {/* ── Header back ── */}
      <View style={d.header}>
        <TouchableOpacity onPress={onBack} style={d.backBtn} testID="btn-back">
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={d.headerTitle} numberOfLines={1}>{item.title}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* ── Scroll ── */}
      <ScrollView
        ref={scrollRef}
        style={d.scroll}
        contentContainerStyle={{ paddingBottom: isOwner ? 96 : 80 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Galerie ── */}
        <View style={d.galleryWrap} testID="product-hero-gallery">
          <ScrollView
            horizontal pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onGalleryScroll}
            scrollEventThrottle={16}
          >
            {images.length > 0 ? images.map((uri, i) => (
              <TagImage
                key={i} uri={uri}
                style={{ width: SW, height: IMG_H }}
                tagIds={item.tag_ids || []}
              />
            )) : (
              <TagImage uri="" style={{ width: SW, height: IMG_H }} tagIds={item.tag_ids || []} />
            )}
          </ScrollView>

          {/* Dots */}
          {images.length > 1 && (
            <View style={d.dots}>
              {images.map((_, i) => (
                <View key={i} style={[d.dot, i === galleryIdx && d.dotActive]} />
              ))}
            </View>
          )}

          {/* Status badge (owner) */}
          {isOwner && (
            <View style={[d.statusBadge, { backgroundColor: statusCfg.bg }]} testID="product-status-badge">
              <Ionicons name={statusCfg.icon as any} size={13} color={statusCfg.color} />
              <Text style={[d.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
            </View>
          )}

          {/* Overlay gradient bas */}
          <View style={d.galleryGrad} />
        </View>

        <View style={d.content}>
          {/* ── Titre + pricing ── */}
          <View testID="product-title-row">
            <Text style={d.title}>{item.title}</Text>

            {/* Rejected admin comment */}
            {isOwner && item.status === 'rejected' && item.admin_comment && (
              <View style={d.rejectBox}>
                <Ionicons name="alert-circle-outline" size={14} color={DANGER} />
                <Text style={d.rejectText}>{item.admin_comment}</Text>
              </View>
            )}
          </View>

          {/* Pricing chips */}
          {pricingChips.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={d.priceRow} testID="product-pricing-chips">
              {pricingChips.map((c: any) => (
                <View key={c.mode} style={d.priceChip}>
                  <Text style={d.priceAmount}>{Number(c.price).toFixed(0)}€</Text>
                  <Text style={d.priceUnit}>{c.label}</Text>
                </View>
              ))}
              {/* Legacy single price fallback */}
              {pricingChips.length === 0 && item.price > 0 && (
                <View style={d.priceChip}>
                  <Text style={d.priceAmount}>{Number(item.price).toFixed(2)}€</Text>
                  <Text style={d.priceUnit}>/séance</Text>
                </View>
              )}
            </ScrollView>
          )}

          {/* ── Distances (non-owner) ── */}
          {!isOwner && (item.distance_km != null || item.spotyou_distance_km != null) && (
            <View style={d.chipRow} testID="product-distances">
              {item.spotyou_distance_km != null && (
                <View style={d.chip}>
                  <Ionicons name="location" size={12} color={COBALT} />
                  <Text style={d.chipText}>{Number(item.spotyou_distance_km).toFixed(1)} km du SpotYou</Text>
                </View>
              )}
              {item.distance_km != null && (
                <View style={d.chip}>
                  <Ionicons name="navigate-outline" size={12} color={Colors.muted} />
                  <Text style={d.chipText}>{Number(item.distance_km).toFixed(1)} km de vous</Text>
                </View>
              )}
            </View>
          )}

          {/* ── Quick info chips ── */}
          <View style={d.chipRow} testID="product-quick-info">
            {catLabel ? (
              <View style={[d.chip, { backgroundColor: COBALT_DIM, borderColor: COBALT + '30' }]}>
                <Ionicons name="pricetag-outline" size={11} color={COBALT} />
                <Text style={[d.chipText, { color: COBALT }]}>{catLabel}</Text>
              </View>
            ) : null}
            {item.condition_label ? (
              <View style={d.chip}>
                <Ionicons name="shield-checkmark-outline" size={11} color={Colors.muted} />
                <Text style={d.chipText}>{item.condition_label}</Text>
              </View>
            ) : null}
          </View>

          {/* ── Description ── */}
          {item.description ? (
            <View style={d.card} testID="product-description">
              <Text style={d.sectionTitle}>DESCRIPTION</Text>
              <Text
                style={d.bodyText}
                numberOfLines={descExpanded ? undefined : 3}
              >
                {item.description}
              </Text>
              {longDesc && (
                <TouchableOpacity onPress={() => setDescExpanded(v => !v)} style={{ marginTop: 6 }}>
                  <Text style={d.readMore}>
                    {descExpanded ? 'Réduire' : 'Lire plus'}
                    <Ionicons name={descExpanded ? 'chevron-up' : 'chevron-down'} size={12} color={COBALT} />
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null}

          {/* ── Infos pratiques ── */}
          {(item.pickup_type || item.deposit_required || item.max_duration_days || item.availability_note || item.available_quantity) && (
            <View style={d.card} testID="product-infos-pratiques">
              <Text style={d.sectionTitle}>INFOS PRATIQUES</Text>
              {item.pickup_type && PICKUP_CFG[item.pickup_type] && (() => {
                const cfg = PICKUP_CFG[item.pickup_type];
                return (
                  <View style={d.infoRow}>
                    <View style={[d.infoIcon, { backgroundColor: cfg.color + '18' }]}>
                      <Ionicons name={cfg.icon as any} size={14} color={cfg.color} />
                    </View>
                    <Text style={d.infoLabel}>{cfg.label}</Text>
                    {item.pickup_notes ? <Text style={d.infoSub} numberOfLines={1}>{item.pickup_notes}</Text> : null}
                  </View>
                );
              })()}
              {item.deposit_required && item.deposit_amount && (
                <View style={d.infoRow}>
                  <View style={[d.infoIcon, { backgroundColor: ORANGE + '18' }]}>
                    <Ionicons name="wallet-outline" size={14} color={ORANGE} />
                  </View>
                  <Text style={d.infoLabel}>Caution : {Number(item.deposit_amount).toFixed(0)} €</Text>
                </View>
              )}
              {item.max_duration_days && (
                <View style={d.infoRow}>
                  <View style={[d.infoIcon, { backgroundColor: COBALT_DIM }]}>
                    <Ionicons name="time-outline" size={14} color={COBALT} />
                  </View>
                  <Text style={d.infoLabel}>Max {item.max_duration_days} jour{item.max_duration_days > 1 ? 's' : ''}</Text>
                </View>
              )}
              {item.available_quantity != null && item.available_quantity > 0 && (
                <View style={d.infoRow}>
                  <View style={[d.infoIcon, { backgroundColor: GREEN + '18' }]}>
                    <Ionicons name="layers-outline" size={14} color={GREEN} />
                  </View>
                  <Text style={d.infoLabel}>{item.available_quantity} disponible{item.available_quantity > 1 ? 's' : ''}</Text>
                </View>
              )}
              {item.availability_note ? (
                <View style={d.infoRow}>
                  <View style={[d.infoIcon, { backgroundColor: 'rgba(255,255,255,0.04)' }]}>
                    <Ionicons name="information-circle-outline" size={14} color={Colors.muted} />
                  </View>
                  <Text style={d.infoSub}>{item.availability_note}</Text>
                </View>
              ) : null}
            </View>
          )}

          {/* ── Contenu inclus ── */}
          {item.included_items ? (
            <View style={d.card} testID="product-contenu-inclus">
              <Text style={d.sectionTitle}>CONTENU INCLUS</Text>
              {item.included_items.split(/\n|•|;/).filter((l: string) => l.trim()).map((line: string, i: number) => (
                <View key={i} style={d.infoRow}>
                  <Ionicons name="checkmark-circle" size={14} color={GREEN} />
                  <Text style={d.bodyText}>{line.trim()}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── Conditions inline (non-owner seulement) ── */}
          {!isOwner && hasConditions && (
            <View style={d.card} testID="product-inline-conditions">
              <TouchableOpacity
                style={d.condHeader}
                onPress={() => setCondOpen(v => !v)}
                activeOpacity={0.7}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="document-text-outline" size={14} color={COBALT} />
                  <Text style={d.sectionTitle}>CONDITIONS DE LOCATION</Text>
                </View>
                <Ionicons name={condOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.muted} />
              </TouchableOpacity>
              {condOpen && (
                <View style={{ gap: 12, marginTop: 12 }}>
                  {hasReturnRules && (
                    <View style={d.condBlock}>
                      <Text style={d.condLabel}>
                        <Ionicons name="refresh-circle-outline" size={12} color={COBALT} /> Retour
                      </Text>
                      <Text style={d.condText}>{item.return_rules}</Text>
                    </View>
                  )}
                  {hasCancelRules && (
                    <View style={d.condBlock}>
                      <Text style={d.condLabel}>
                        <Ionicons name="close-circle-outline" size={12} color={ORANGE} /> Annulation
                      </Text>
                      <Text style={d.condText}>{item.cancellation_rules}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}

          {/* ── SpotYou liés ── */}
          {(item.related_spotyou_ids?.length > 0 || item.related_spotyou_count > 0) && (
            <View style={d.spotYouRow}>
              <Ionicons name="location" size={14} color={COBALT} />
              <Text style={d.spotYouText}>
                Disponible sur {item.related_spotyou_ids?.length ?? item.related_spotyou_count} SpotYou
              </Text>
            </View>
          )}

          {/* ── Proposé par (non-owner) ── */}
          {!isOwner && (
            <View style={d.card} testID="product-seller-profile">
              <Text style={d.sectionTitle}>PROPOSÉ PAR</Text>
              <View style={d.sellerRow}>
                {sellerPicture ? (
                  <TagImage uri={sellerPicture} style={d.sellerAvatar} />
                ) : (
                  <View style={[d.sellerAvatar, d.sellerAvatarFallback]}>
                    <Text style={d.sellerInitial}>{sellerInitial}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={d.sellerName}>{sellerName}</Text>
                  {sellerStats.avg_rating > 0 && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <Stars value={sellerStats.avg_rating} />
                      <Text style={d.sellerRating}>
                        {Number(sellerStats.avg_rating).toFixed(1)} ({sellerStats.review_count ?? 0} avis)
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          {/* ── Autres produits du vendeur ── */}
          {!isOwner && otherProducts.length > 0 && (
            <View>
              <Text style={[d.sectionTitle, { marginBottom: 10 }]}>AUTRES ANNONCES</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                {otherProducts.slice(0, 5).map((p: any) => (
                  <View key={p.product_id} style={d.miniCard}>
                    <TagImage uri={p.image_url || ''} style={d.miniImage} tagIds={p.tag_ids || []} />
                    <Text style={d.miniTitle} numberOfLines={2}>{p.title}</Text>
                    <Text style={d.miniPrice}>{Number(p.price).toFixed(0)} €</Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </ScrollView>

      {/* ── Bottom bar ── */}
      <View style={d.bottomBar}>
        {isOwner ? (
          <View style={d.ownerBtns}>
            <TouchableOpacity
              style={d.deleteBtn}
              onPress={onDelete}
              testID="btn-owner-delete"
              activeOpacity={0.8}
            >
              <Ionicons name="trash-outline" size={16} color={DANGER} />
              <Text style={d.deleteBtnText}>Supprimer</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={d.editBtn}
              onPress={onEdit}
              testID="btn-owner-edit"
              activeOpacity={0.8}
            >
              <Ionicons name="create-outline" size={16} color="#fff" />
              <Text style={d.editBtnText}>Modifier l'annonce</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={d.rentBtn}
            onPress={() => onCta?.(item)}
            testID="btn-buyer-rent"
            activeOpacity={0.85}
          >
            <Ionicons name="calendar-outline" size={18} color="#fff" />
            <Text style={d.rentBtnText}>Louer / Réserver</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const d = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },
  header:        { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  headerTitle:   { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foreground },

  scroll:        { flex: 1 },
  content:       { padding: 16, gap: 12 },

  // Gallery
  galleryWrap:   { width: SW, height: IMG_H, position: 'relative' },
  galleryGrad:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 60, backgroundColor: 'rgba(13,17,23,0.5)' },
  dots:          { position: 'absolute', bottom: 12, alignSelf: 'center', flexDirection: 'row', gap: 5 },
  dot:           { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive:     { backgroundColor: '#fff', width: 14 },
  statusBadge:   { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  statusText:    { fontSize: 12, fontWeight: '700' },

  // Title
  title:         { fontSize: 22, fontWeight: '800', color: Colors.foreground, lineHeight: 30 },
  rejectBox:     { flexDirection: 'row', gap: 8, backgroundColor: DANGER + '12', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: DANGER + '30', marginTop: 8 },
  rejectText:    { flex: 1, fontSize: 12, color: DANGER, lineHeight: 17 },

  // Pricing chips
  priceRow:      { gap: 8, paddingBottom: 4 },
  priceChip:     { flexDirection: 'row', alignItems: 'baseline', gap: 3, backgroundColor: COBALT_DIM, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: COBALT + '30' },
  priceAmount:   { fontSize: 22, fontWeight: '800', color: COBALT },
  priceUnit:     { fontSize: 12, color: COBALT + 'BB', fontWeight: '600' },

  // Chips
  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: Colors.border },
  chipText:      { fontSize: 12, color: Colors.muted, fontWeight: '600' },

  // Card sections
  card:          { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 2 },
  sectionTitle:  { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  bodyText:      { fontSize: 14, color: Colors.foreground, lineHeight: 21 },
  readMore:      { fontSize: 13, color: COBALT, fontWeight: '600' },

  // Info rows
  infoRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  infoIcon:      { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  infoLabel:     { flex: 1, fontSize: 13, color: Colors.foreground, fontWeight: '600' },
  infoSub:       { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 17 },

  // Conditions
  condHeader:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  condBlock:     { backgroundColor: Colors.background, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.border, gap: 5 },
  condLabel:     { fontSize: 12, fontWeight: '700', color: Colors.foreground, marginBottom: 4 },
  condText:      { fontSize: 13, color: Colors.muted, lineHeight: 19 },

  // SpotYou
  spotYouRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: COBALT_DIM, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: COBALT + '25' },
  spotYouText:   { fontSize: 13, color: COBALT, fontWeight: '600' },

  // Seller
  sellerRow:     { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 },
  sellerAvatar:  { width: 44, height: 44, borderRadius: 22 },
  sellerAvatarFallback: { backgroundColor: COBALT_DIM, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: COBALT + '30' },
  sellerInitial: { fontSize: 18, fontWeight: '800', color: COBALT },
  sellerName:    { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  sellerRating:  { fontSize: 12, color: Colors.muted },

  // Mini cards (other products)
  miniCard:      { width: 130, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  miniImage:     { width: 130, height: 80 },
  miniTitle:     { fontSize: 12, fontWeight: '600', color: Colors.foreground, padding: 8, paddingBottom: 4 },
  miniPrice:     { fontSize: 13, fontWeight: '800', color: COBALT, paddingHorizontal: 8, paddingBottom: 8 },

  // Bottom bar
  bottomBar:     { backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28 },
  rentBtn:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: COBALT, borderRadius: 24, paddingVertical: 14 },
  rentBtnText:   { fontSize: 16, fontWeight: '800', color: '#fff' },
  ownerBtns:     { flexDirection: 'row', gap: 10 },
  deleteBtn:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 24, borderWidth: 1.5, borderColor: DANGER, paddingVertical: 13 },
  deleteBtnText: { fontSize: 14, fontWeight: '700', color: DANGER },
  editBtn:       { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: COBALT, borderRadius: 24, paddingVertical: 13 },
  editBtnText:   { fontSize: 14, fontWeight: '700', color: '#fff' },
});
