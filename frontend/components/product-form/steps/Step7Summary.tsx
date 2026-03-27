/**
 * Step 7 — Récapitulatif + Aperçu + Publication
 * Réutilise ProductDetailView en mode consultation (aperçu avant publication)
 */
import React, { useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, calcProductQuality, getMinPrice } from '../ProductFormContext';
import { ProductDetailView } from '../../ProductDetailView';

const BLUE = '#3B82F6';

const CAT_LABELS: Record<string, string> = {
  velo: 'Vélo / Trottinette', raquette: 'Raquette / Padel',
  fitness: 'Fitness / Musculation', yoga: 'Yoga / Tapis',
  ballon: 'Ballon / Sports collectifs', natation: 'Natation',
  glisse: 'Ski / Snowboard', running: 'Running / Trail',
  accessoire: 'Accessoires sport', autre: 'Autre matériel',
};

const COND_LABELS: Record<string, string> = {
  new: 'Neuf', very_good: 'Très bon', good: 'Bon', acceptable: 'Acceptable',
};

const PICKUP_LABELS: Record<string, string> = {
  local_pickup: 'Récupération sur place',
  creator_handoff: 'Remise en main propre',
};

interface Props {
  onSaveDraft: () => Promise<void>;
  onPublish: () => Promise<void>;
  isSubmitting: boolean;
}

export function Step7Summary({ onSaveDraft, onPublish, isSubmitting }: Props) {
  const { form } = useProductForm();
  const quality = calcProductQuality(form);
  const [showPreview, setShowPreview] = useState(false);

  const minPrice = getMinPrice(form);
  const activeModes = form.pricing_modes ?? ['day'];
  const priceLabel = minPrice > 0
    ? activeModes.map(m => {
        const val = m === 'hour' ? form.price_per_hour : m === 'day' ? form.price_per_day : m === 'week' ? form.price_per_week : m === 'month' ? form.price_per_month : '';
        const n = parseFloat((val ?? '').replace(',', '.'));
        return n > 0 ? `${n.toFixed(2)} €${m === 'hour' ? '/h' : m === 'day' ? '/j' : m === 'week' ? '/sem' : m === 'month' ? '/mois' : '/séance'}` : null;
      }).filter(Boolean).join(' · ')
    : '—';

  // Fake product object pour réutiliser ProductDetailView
  const fakeItem = {
    product_id:           'preview',
    item_type:            'product',
    product_type:         'rental',
    title:                form.title || 'Titre non défini',
    description:          form.description || form.short_description || '',
    price:                minPrice,
    image_url:            form.images[0] || null,
    image_urls:           form.images,
    condition_label:      form.condition_label,
    included_items:       form.included_items,
    pickup_type:          form.pickup_type,
    pickup_notes:         form.pickup_notes,
    return_rules:         form.return_rules,
    deposit_required:     form.deposit_required,
    deposit_amount:       form.deposit_amount,
    available_quantity:   parseInt(form.available_quantity || '1', 10),
    in_stock:             true,
    city:                 form.city,
    pricing_type:         activeModes[0] ?? 'day',
    pricing_modes:        activeModes,
    rental_duration_unit: activeModes[0] === 'hour' ? 'heure' : activeModes[0] === 'week' ? 'semaine' : 'jour',
    rental_duration_qty:  1,
    seller_name:          'Moi',
    badge_type:           'owner',
    badge_label:          'Vous',
    delivery_modes:       form.pickup_type ? [form.pickup_type] : [],
    seller_stats:         { rating_avg: 0, rating_count: 0, product_count: 0, service_count: 0, spotyou_count: 0 },
  };

  if (showPreview) {
    return (
      <View style={{ flex: 1 }}>
        <ProductDetailView
          item={fakeItem}
          allItems={[]}
          onBack={() => setShowPreview(false)}
        />
      </View>
    );
  }

  return (
    <View style={sm.wrap}>
      {/* Score qualité */}
      <View style={sm.qualityCard}>
        <View style={sm.qualityHeader}>
          <Text style={sm.qualityTitle}>Score de qualité</Text>
          <Text style={[sm.qualityScore, { color: quality.color }]}>{quality.score}/100</Text>
        </View>
        <View style={sm.progressBar}>
          <View style={[sm.progressFill, { width: `${quality.score}%` as any, backgroundColor: quality.color }]} />
        </View>
        <Text style={[sm.qualityLabel, { color: quality.color }]}>{quality.label}</Text>
        {quality.checklist.length > 0 && (
          <View style={sm.checklistWrap}>
            {quality.checklist.map(item => (
              <View key={item} style={sm.checklistRow}>
                <Ionicons name="ellipse-outline" size={12} color={Colors.muted} />
                <Text style={sm.checklistText}>Ajouter : {item}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Résumé */}
      <View style={sm.summaryCard}>
        {form.images[0] && (
          <Image source={{ uri: form.images[0] }} style={sm.coverImg} resizeMode="cover" />
        )}

        <View style={sm.summaryContent}>
          <Text style={sm.productTitle} numberOfLines={2}>{form.title || '(Titre manquant)'}</Text>
          <Text style={sm.productPrice}>{priceLabel}</Text>

          <View style={sm.rows}>
            <SummaryRow icon="pricetag-outline"         label="Catégorie"   value={form.category_label || CAT_LABELS[form.category] || '—'} />
            <SummaryRow icon="shield-outline"           label="État"        value={COND_LABELS[form.condition_label] || '—'} />
            <SummaryRow icon="cube-outline"             label="Quantité"    value={`${form.available_quantity} unité(s)`} />
            <SummaryRow icon="location-outline"         label="Mode remise" value={PICKUP_LABELS[form.pickup_type] || '—'} />
            <SummaryRow icon="map-outline"              label="Ville"       value={form.city || form.locationAddress || '—'} />
            {form.deposit_required && (
              <SummaryRow icon="cash-outline" label="Caution" value={`${form.deposit_amount} €`} />
            )}
            {form.related_spotyou_ids.length > 0 && (
              <SummaryRow icon="pin-outline" label="SpotYou liés" value={`${form.related_spotyou_ids.length} SpotYou`} />
            )}
            <SummaryRow icon="camera-outline" label="Photos" value={`${form.images.length} photo(s)`} color={form.images.length === 0 ? '#EF4444' : undefined} />
          </View>
        </View>
      </View>

      {/* Aperçu */}
      <TouchableOpacity
        style={sm.previewBtn}
        onPress={() => setShowPreview(true)}
        testID="preview-btn"
      >
        <Ionicons name="eye-outline" size={18} color={BLUE} />
        <Text style={sm.previewBtnText}>Voir l'aperçu du produit</Text>
      </TouchableOpacity>

      {/* Conseils avant publication */}
      <View style={sm.adviceCard}>
        <Text style={sm.adviceTitle}>Avant de publier</Text>
        {[
          'Vérifie que les photos sont nettes et lumineuses',
          'Le prix et la caution sont clairement indiqués',
          'Les conditions de retour sont expliquées',
          'Ta localisation est correcte',
        ].map(a => (
          <View key={a} style={sm.adviceRow}>
            <Ionicons name="checkmark-circle-outline" size={14} color={BLUE} />
            <Text style={sm.adviceText}>{a}</Text>
          </View>
        ))}
      </View>

      {/* Modération */}
      <View style={sm.moderationNote}>
        <Ionicons name="time-outline" size={16} color={Colors.muted} />
        <Text style={sm.moderationText}>
          Ton produit sera examiné par un administrateur avant d'être visible dans la boutique. Ce processus prend généralement moins de 24h.
        </Text>
      </View>

      {/* CTAs */}
      <View style={sm.ctaRow}>
        <TouchableOpacity
          style={sm.draftBtn}
          onPress={onSaveDraft}
          disabled={isSubmitting}
          testID="save-draft-btn"
        >
          {isSubmitting ? <ActivityIndicator size="small" color={BLUE} /> : <Ionicons name="save-outline" size={18} color={BLUE} />}
          <Text style={sm.draftBtnText}>Brouillon</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[sm.publishBtn, isSubmitting && { opacity: 0.6 }]}
          onPress={onPublish}
          disabled={isSubmitting}
          testID="publish-btn"
        >
          {isSubmitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send-outline" size={18} color="#fff" />
          )}
          <Text style={sm.publishBtnText}>Soumettre pour validation</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SummaryRow({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <View style={sm.row}>
      <Ionicons name={icon as any} size={14} color={Colors.muted} style={{ width: 18 }} />
      <Text style={sm.rowLabel}>{label}</Text>
      <Text style={[sm.rowValue, color && { color }]}>{value}</Text>
    </View>
  );
}

const sm = StyleSheet.create({
  wrap:           { gap: Spacing.lg, paddingBottom: 20 },
  qualityCard:    { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  qualityHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  qualityTitle:   { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  qualityScore:   { fontSize: 20, fontWeight: '900' },
  qualityLabel:   { fontSize: 12, fontWeight: '700' },
  progressBar:    { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  progressFill:   { height: '100%', borderRadius: 3 },
  checklistWrap:  { gap: 4, marginTop: 4 },
  checklistRow:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
  checklistText:  { fontSize: 11, color: Colors.muted },
  summaryCard:    { backgroundColor: Colors.card, borderRadius: Radius.md, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  coverImg:       { width: '100%', height: 160 },
  summaryContent: { padding: Spacing.md, gap: 10 },
  productTitle:   { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  productPrice:   { fontSize: 20, fontWeight: '900', color: BLUE },
  rows:           { gap: 6 },
  row:            { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel:       { fontSize: 12, color: Colors.muted, flex: 1 },
  rowValue:       { fontSize: 12, fontWeight: '600', color: Colors.foreground },
  previewBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BLUE + '10', borderRadius: Radius.md, paddingVertical: 12, borderWidth: 1, borderColor: BLUE + '40' },
  previewBtnText: { fontSize: 14, fontWeight: '700', color: BLUE },
  adviceCard:     { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: 8 },
  adviceTitle:    { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  adviceRow:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  adviceText:     { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },
  moderationNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  moderationText: { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 17 },
  ctaRow:         { flexDirection: 'row', gap: 10, marginTop: 4 },
  draftBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.full, paddingVertical: 14, borderWidth: 1.5, borderColor: BLUE },
  draftBtnText:   { fontSize: 14, fontWeight: '700', color: BLUE },
  publishBtn:     { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: BLUE, borderRadius: Radius.pill, paddingVertical: 14 },
  publishBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },
});
