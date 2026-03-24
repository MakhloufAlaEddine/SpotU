/**
 * ProductDetailView — Vue détail produit dans le modal boutique SpotYou.
 * Reste dans le même modal, sans navigation vers un autre écran.
 *
 * @param item       Produit ou service sélectionné
 * @param allItems   Tous les items chargés (pour calculer les autres contenus du vendeur)
 * @param onBack     Callback retour vers la liste
 * @param onCta      Callback CTA (placeholder pour usage futur)
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '../constants/Colors';
import { TagImage } from './TagImage';

/* ─── Constantes couleurs ───────────────────────────────────────────────── */
const COBALT     = '#3B82F6';
const COBALT_DIM = 'rgba(59,130,246,0.10)';
const COBALT_BDR = 'rgba(59,130,246,0.30)';
const ORANGE     = '#FF9500';
const GREEN      = '#22C55E';
const IMG_H      = 230;

/* ─── Config modes de remise ────────────────────────────────────────────── */
const DELIVERY_CFG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  local_pickup:    { icon: 'location-outline',  label: 'Sur place',       color: '#F59E0B', bg: 'rgba(245,158,11,0.12)'  },
  creator_handoff: { icon: 'person-outline',     label: 'Par le créateur', color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)'  },
  digital:         { icon: 'globe-outline',      label: 'En ligne',        color: GREEN,      bg: 'rgba(34,197,94,0.12)'   },
  external:        { icon: 'open-outline',       label: 'Site partenaire', color: '#64748B', bg: 'rgba(100,116,139,0.12)' },
};

const LEVEL_LABELS: Record<string, string> = {
  debutant:     'Débutant',
  intermediaire:'Intermédiaire',
  avance:       'Avancé',
  tous:         'Tous niveaux',
};

const LEVEL_COLORS: Record<string, string> = {
  debutant:     '#34D399',
  intermediaire:'#FBBF24',
  avance:       '#F87171',
  tous:         Colors.muted,
};

/* ─── Types ─────────────────────────────────────────────────────────────── */
export interface ProductDetailViewProps {
  item: any;
  allItems: any[];
  onBack: () => void;
  onCta?: (item: any) => void;
}

/* ─── Stars ─────────────────────────────────────────────────────────────── */
function Stars({ value }: { value: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons
          key={i}
          name={i <= Math.round(value) ? 'star' : 'star-outline'}
          size={13}
          color="#FBBF24"
        />
      ))}
    </View>
  );
}

/* ─── Section wrapper ───────────────────────────────────────────────────── */
function Section({
  title,
  children,
  noBorder,
}: { title?: string; children: React.ReactNode; noBorder?: boolean }) {
  return (
    <View style={[d.section, noBorder && { borderBottomWidth: 0 }]}>
      {title && <Text style={d.sectionTitle}>{title}</Text>}
      {children}
    </View>
  );
}

/* ─── Composant principal ───────────────────────────────────────────────── */
export function ProductDetailView({ item, allItems, onBack, onCta }: ProductDetailViewProps) {
  const [descExpanded, setDescExpanded]   = useState(false);
  const [ownerExpanded, setOwnerExpanded] = useState(false);

  const isService  = item.item_type === 'service';
  const isRental   = item.product_type === 'rental';
  const isFree     = item.price === 0;
  const outOfStock = item.in_stock === false;

  /* Infos vendeur */
  const sellerName    = item.seller_name    || item.coach_name    || 'SpotU';
  const sellerPicture = item.seller_picture || item.coach_picture || null;
  const sellerId      = item.seller_id      || item.coach_id      || null;
  const sellerInitial = sellerName.charAt(0).toUpperCase();
  const sellerStats   = item.seller_stats || {};

  /* Rôle */
  const roleLabel = (() => {
    if (item.badge_type === 'owner') return 'Créateur du SpotYou';
    if (isService)                   return 'Coach';
    if (item.seller_type === 'admin') return 'SpotU';
    return 'Utilisateur';
  })();

  /* Libellé prix */
  const priceLabel = (() => {
    if (isFree) return 'Gratuit';
    const base = `${Number(item.price).toFixed(2)} €`;
    if (!isRental) return base;
    const unit = item.rental_duration_unit;
    const qty  = item.rental_duration_qty ?? 1;
    if (!unit) return `${base}/séance`;
    const map: Record<string, [string, string]> = {
      heure:   ['h',        'h'],
      jour:    ['jour',     'jours'],
      semaine: ['semaine',  'semaines'],
      mois:    ['mois',     'mois'],
    };
    const [s, p] = map[unit] ?? [unit, unit];
    return qty > 1 ? `${base}/${qty} ${p}` : `${base}/${s}`;
  })();

  /* Libellé CTA */
  const ctaLabel = isRental ? "Voir les conditions" : "Voir l'offre";

  /* Autres items du même vendeur (depuis la liste déjà chargée) */
  const otherProducts = sellerId
    ? allItems.filter(
        i =>
          (i.seller_id || i.coach_id) === sellerId &&
          (i.product_id || i.service_id) !== (item.product_id || item.service_id) &&
          i.item_type === 'product',
      )
    : [];
  const otherServices = sellerId
    ? allItems.filter(
        i =>
          (i.seller_id || i.coach_id) === sellerId &&
          (i.product_id || i.service_id) !== (item.product_id || item.service_id) &&
          i.item_type === 'service',
      )
    : [];

  const spotYouCount   = sellerStats.spotyou_count  ?? 0;
  const hasOtherContent =
    otherProducts.length > 0 || otherServices.length > 0 || spotYouCount > 0;

  /* Description longue ? */
  const longDesc = (item.description || '').length > 180;

  /* URL image */
  const imgUri = isService
    ? Array.isArray(item.images) ? item.images[0] : null
    : item.image_url;

  return (
    <View style={d.root} testID="product-detail-view">

      {/* ── Header ── */}
      <View style={d.header}>
        <TouchableOpacity
          onPress={onBack}
          style={d.backBtn}
          testID="product-detail-back-btn"
        >
          <Ionicons name="arrow-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={d.headerTitle} numberOfLines={1}>Détail produit</Text>
        <View style={d.headerSpacer} />
      </View>

      {/* ── Contenu scrollable ── */}
      <ScrollView
        style={d.scroll}
        contentContainerStyle={d.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces
      >
        {/* ── Image principale ── */}
        <View style={d.imageWrap}>
          <TagImage uri={imgUri || ''} style={d.image} />

          {/* Overlay bas semi-transparent */}
          <View style={d.imgBottomOverlay} />

          {/* Badge type (bas droite) */}
          <View style={[
            d.imgBadge,
            { position: 'absolute', bottom: 12, right: 12 },
            isService ? d.badgeOrange :
            isRental  ? d.badgeBlue   : d.badgeDark,
          ]}>
            <Text style={d.imgBadgeText}>
              {isService ? 'SERVICE' : isRental ? 'LOCATION' : 'VENTE'}
            </Text>
          </View>

          {/* Badge source (haut gauche) */}
          {item.badge_type === 'owner' ? (
            <View style={[d.imgBadge, d.badgeGreen, { position: 'absolute', top: 12, left: 12 }]}>
              <Ionicons name="star" size={10} color="#fff" />
              <Text style={d.imgBadgeText}>Créateur</Text>
            </View>
          ) : (
            <View style={[d.imgBadge, d.badgeMuted, { position: 'absolute', top: 12, left: 12 }]}>
              <Ionicons name="person-outline" size={10} color="#fff" />
              <Text style={d.imgBadgeText} numberOfLines={1}>
                {item.badge_label || 'Autre'}
              </Text>
            </View>
          )}

          {/* Indisponible */}
          {outOfStock && (
            <View style={d.outOverlay}>
              <Text style={d.outText}>INDISPONIBLE</Text>
            </View>
          )}
        </View>

        {/* ── Identité produit ── */}
        <Section>
          <Text style={d.productTitle}>{item.title}</Text>

          {/* Prix + niveau */}
          <View style={d.priceRow}>
            <Text style={[d.price, isFree && { color: GREEN }]}>{priceLabel}</Text>
            {item.skill_level && item.skill_level !== 'tous' && (
              <View style={[
                d.levelPill,
                {
                  backgroundColor: (LEVEL_COLORS[item.skill_level] ?? Colors.muted) + '22',
                  borderColor:     (LEVEL_COLORS[item.skill_level] ?? Colors.muted) + '55',
                },
              ]}>
                <Text style={[d.levelText, { color: LEVEL_COLORS[item.skill_level] ?? Colors.muted }]}>
                  {LEVEL_LABELS[item.skill_level] ?? item.skill_level}
                </Text>
              </View>
            )}
          </View>

          {/* Distances */}
          {item.is_physical && (item.dist_from_spotyou_fmt || item.dist_from_user_fmt) && (
            <View style={d.chipRow}>
              {item.dist_from_spotyou_fmt && (
                <View style={[d.chip, d.chipBlue]}>
                  <Ionicons name="location" size={11} color={COBALT} />
                  <Text style={[d.chipText, { color: COBALT }]}>
                    {item.dist_from_spotyou_fmt} du SpotYou
                  </Text>
                </View>
              )}
              {item.dist_from_user_fmt && (
                <View style={[d.chip, d.chipGreen]}>
                  <Ionicons name="navigate" size={11} color={GREEN} />
                  <Text style={[d.chipText, { color: GREEN }]}>
                    {item.dist_from_user_fmt} de vous
                  </Text>
                </View>
              )}
            </View>
          )}
        </Section>

        {/* ── Infos pratiques ── */}
        {(
          (item.delivery_modes?.length > 0) ||
          item.duration_min ||
          (isRental && item.rental_duration_unit)
        ) && (
          <Section title="Infos pratiques">
            <View style={d.chipRow}>
              {(item.delivery_modes || []).map((m: string) => {
                const cfg = DELIVERY_CFG[m];
                if (!cfg) return null;
                return (
                  <View
                    key={m}
                    style={[d.chip, { backgroundColor: cfg.bg, borderColor: cfg.color + '55' }]}
                  >
                    <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
                    <Text style={[d.chipText, { color: cfg.color }]}>{cfg.label}</Text>
                  </View>
                );
              })}

              {item.duration_min && (
                <View style={[d.chip, { backgroundColor: 'rgba(255,149,0,0.10)', borderColor: 'rgba(255,149,0,0.30)' }]}>
                  <Ionicons name="time-outline" size={11} color={ORANGE} />
                  <Text style={[d.chipText, { color: ORANGE }]}>{item.duration_min} min</Text>
                </View>
              )}

              {isRental && item.rental_duration_unit && (
                <View style={[d.chip, d.chipBlue]}>
                  <Ionicons name="calendar-outline" size={11} color={COBALT} />
                  <Text style={[d.chipText, { color: COBALT }]}>
                    {item.rental_duration_qty ?? 1} {item.rental_duration_unit}
                  </Text>
                </View>
              )}
            </View>
          </Section>
        )}

        {/* ── Description ── */}
        {!!item.description && (
          <Section title="Description">
            <Text
              style={d.descText}
              numberOfLines={descExpanded ? undefined : 4}
            >
              {item.description}
            </Text>
            {longDesc && (
              <TouchableOpacity
                onPress={() => setDescExpanded(v => !v)}
                style={d.expandBtn}
                testID="product-detail-expand-desc"
              >
                <Text style={d.expandBtnText}>
                  {descExpanded ? 'Voir moins' : 'Voir plus'}
                </Text>
                <Ionicons
                  name={descExpanded ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={COBALT}
                />
              </TouchableOpacity>
            )}
          </Section>
        )}

        {/* ── Proposé par ── */}
        <Section title="Proposé par">
          <TouchableOpacity
            style={d.ownerCard}
            onPress={() => setOwnerExpanded(v => !v)}
            activeOpacity={0.82}
            testID="product-detail-owner-toggle"
          >
            {/* Avatar */}
            <View style={d.ownerAvatarWrap}>
              {sellerPicture ? (
                <Image source={{ uri: sellerPicture }} style={d.ownerAvatarImg} />
              ) : (
                <Text style={d.ownerAvatarTxt}>{sellerInitial}</Text>
              )}
              {item.badge_type === 'owner' && (
                <View style={d.ownerDot}>
                  <Ionicons name="star" size={7} color="#fff" />
                </View>
              )}
            </View>

            {/* Infos */}
            <View style={d.ownerInfo}>
              <Text style={d.ownerName}>{sellerName}</Text>
              <Text style={d.ownerRole}>{roleLabel}</Text>

              {/* Rating */}
              {sellerStats.rating_avg != null && Number(sellerStats.rating_avg) > 0 ? (
                <View style={d.ratingRow}>
                  <Stars value={Number(sellerStats.rating_avg)} />
                  <Text style={d.ratingTxt}>
                    {Number(sellerStats.rating_avg).toFixed(1)}
                    {sellerStats.rating_count > 0
                      ? ` · ${sellerStats.rating_count} avis`
                      : ''}
                  </Text>
                </View>
              ) : (
                <Text style={d.noRatingTxt}>Pas encore d'avis</Text>
              )}
            </View>

            <Ionicons
              name={ownerExpanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={Colors.muted}
            />
          </TouchableOpacity>

          {/* ── Bloc show/hide propriétaire ── */}
          {ownerExpanded && (
            <View style={d.ownerDetails} testID="product-detail-owner-details">

              {/* Stats */}
              {(
                (sellerStats.products_count > 0) ||
                (sellerStats.services_count > 0) ||
                (sellerStats.spotyou_count  > 0)
              ) && (
                <View style={d.ownerStatsRow}>
                  {sellerStats.products_count > 0 && (
                    <View style={d.ownerStat}>
                      <Text style={d.ownerStatVal}>{sellerStats.products_count}</Text>
                      <Text style={d.ownerStatLbl}>
                        produit{sellerStats.products_count > 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                  {sellerStats.services_count > 0 && (
                    <View style={d.ownerStat}>
                      <Text style={d.ownerStatVal}>{sellerStats.services_count}</Text>
                      <Text style={d.ownerStatLbl}>
                        service{sellerStats.services_count > 1 ? 's' : ''}
                      </Text>
                    </View>
                  )}
                  {sellerStats.spotyou_count > 0 && (
                    <View style={d.ownerStat}>
                      <Text style={d.ownerStatVal}>{sellerStats.spotyou_count}</Text>
                      <Text style={d.ownerStatLbl}>SpotYou</Text>
                    </View>
                  )}
                </View>
              )}

              {/* Badge créateur */}
              {item.badge_type === 'owner' && (
                <View style={d.creatorBadge}>
                  <Ionicons name="star" size={11} color={GREEN} />
                  <Text style={d.creatorBadgeText}>Créateur de ce SpotYou</Text>
                </View>
              )}

              <Text style={d.reassuranceTxt}>
                Toutes les offres sont vérifiées par SpotU.
              </Text>
            </View>
          )}
        </Section>

        {/* ── Autres propositions du propriétaire ── */}
        {hasOtherContent && (
          <Section
            title={`Autres propositions de ${sellerName.split(' ')[0]}`}
            noBorder
          >
            <View style={d.otherRow}>
              {otherProducts.length > 0 && (
                <View style={d.otherChip}>
                  <Ionicons name="cube-outline" size={13} color={COBALT} />
                  <Text style={[d.otherChipTxt, { color: COBALT }]}>
                    {otherProducts.length} produit{otherProducts.length > 1 ? 's' : ''}
                  </Text>
                </View>
              )}
              {otherServices.length > 0 && (
                <View style={d.otherChip}>
                  <Ionicons name="calendar-outline" size={13} color={ORANGE} />
                  <Text style={[d.otherChipTxt, { color: ORANGE }]}>
                    {otherServices.length} service{otherServices.length > 1 ? 's' : ''}
                  </Text>
                </View>
              )}
              {spotYouCount > 0 && (
                <View style={d.otherChip}>
                  <Ionicons name="location-outline" size={13} color={GREEN} />
                  <Text style={[d.otherChipTxt, { color: GREEN }]}>
                    {spotYouCount} SpotYou
                  </Text>
                </View>
              )}
            </View>
          </Section>
        )}

      </ScrollView>

      {/* ── Footer sticky CTA ── */}
      <View style={d.footer} testID="product-detail-footer">
        <View>
          <Text style={d.footerPriceLabel}>Prix</Text>
          <Text style={[d.footerPrice, isFree && { color: GREEN }]}>
            {priceLabel}
          </Text>
        </View>
        <TouchableOpacity
          style={[d.ctaBtn, outOfStock && d.ctaBtnDisabled]}
          onPress={() => onCta?.(item)}
          disabled={outOfStock}
          activeOpacity={0.85}
          testID="product-detail-cta-btn"
        >
          <Text style={d.ctaBtnTxt}>
            {outOfStock ? 'Indisponible' : ctaLabel}
          </Text>
        </TouchableOpacity>
      </View>

    </View>
  );
}

/* ─── Styles ─────────────────────────────────────────────────────────────── */
const d = StyleSheet.create({
  root:          { flex: 1, backgroundColor: Colors.background },

  /* Header */
  header:        { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: Spacing.md, paddingTop: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn:       { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle:   { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  headerSpacer:  { width: 36 },

  /* ScrollView */
  scroll:        { flex: 1 },
  scrollContent: { paddingBottom: 110 },

  /* Image */
  imageWrap:     { width: '100%', height: IMG_H, backgroundColor: Colors.card },
  image:         { width: '100%', height: IMG_H },
  imgBottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 90, backgroundColor: 'rgba(0,0,0,0.42)' },
  imgBadge:      { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  imgBadgeText:  { fontSize: 10, fontWeight: '700', color: '#fff' },
  badgeBlue:     { backgroundColor: 'rgba(59,130,246,0.85)' },
  badgeOrange:   { backgroundColor: 'rgba(255,149,0,0.90)' },
  badgeDark:     { backgroundColor: 'rgba(0,0,0,0.62)' },
  badgeGreen:    { backgroundColor: '#22C55E' },
  badgeMuted:    { backgroundColor: Colors.muted },
  outOverlay:    { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  outText:       { fontSize: 15, fontWeight: '800', color: '#fff', letterSpacing: 1 },

  /* Section */
  section:       { paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  sectionTitle:  { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 10 },

  /* Identité */
  productTitle:  { fontSize: 21, fontWeight: '800', color: Colors.foreground, lineHeight: 27, marginBottom: 8 },
  priceRow:      { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  price:         { fontSize: 24, fontWeight: '900', color: COBALT },
  levelPill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  levelText:     { fontSize: 11, fontWeight: '600' },

  /* Chips */
  chipRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  chipText:      { fontSize: 12, fontWeight: '600' },
  chipBlue:      { backgroundColor: COBALT_DIM, borderColor: COBALT_BDR },
  chipGreen:     { backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.30)' },

  /* Description */
  descText:      { fontSize: 14, color: Colors.foreground, lineHeight: 22 },
  expandBtn:     { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, paddingVertical: 2, alignSelf: 'flex-start' },
  expandBtnText: { fontSize: 13, fontWeight: '600', color: COBALT },

  /* Propriétaire */
  ownerCard:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, backgroundColor: Colors.card, borderRadius: 13, borderWidth: 1, borderColor: Colors.border },
  ownerAvatarWrap: { width: 46, height: 46, borderRadius: 23, backgroundColor: COBALT, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  ownerAvatarImg:  { width: 46, height: 46, borderRadius: 23 },
  ownerAvatarTxt:  { fontSize: 19, fontWeight: '800', color: '#fff' },
  ownerDot:        { position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.card },
  ownerInfo:       { flex: 1, gap: 2 },
  ownerName:       { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  ownerRole:       { fontSize: 12, color: Colors.muted },
  ratingRow:       { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  ratingTxt:       { fontSize: 12, color: Colors.muted, fontWeight: '600' },
  noRatingTxt:     { fontSize: 11, color: Colors.muted, marginTop: 2, fontStyle: 'italic' },

  /* Bloc show/hide propriétaire */
  ownerDetails:    { marginTop: 10, padding: 13, backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, gap: 10 },
  ownerStatsRow:   { flexDirection: 'row', gap: 20 },
  ownerStat:       { alignItems: 'center', gap: 2 },
  ownerStatVal:    { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  ownerStatLbl:    { fontSize: 10, color: Colors.muted, fontWeight: '500' },
  creatorBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(34,197,94,0.10)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(34,197,94,0.30)', alignSelf: 'flex-start' },
  creatorBadgeText:{ fontSize: 12, fontWeight: '600', color: GREEN },
  reassuranceTxt:  { fontSize: 11, color: Colors.muted, fontStyle: 'italic', lineHeight: 16 },

  /* Autres contenus */
  otherRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  otherChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: Colors.card, borderRadius: 9, borderWidth: 1, borderColor: Colors.border },
  otherChipTxt:    { fontSize: 13, fontWeight: '600' },

  /* Footer */
  footer:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 14, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background, gap: 16 },
  footerPriceLabel:{ fontSize: 11, color: Colors.muted, fontWeight: '500' },
  footerPrice:     { fontSize: 21, fontWeight: '900', color: COBALT },
  ctaBtn:          { flex: 1, backgroundColor: COBALT, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  ctaBtnDisabled:  { backgroundColor: Colors.muted, opacity: 0.5 },
  ctaBtnTxt:       { fontSize: 16, fontWeight: '700', color: '#fff' },
});
