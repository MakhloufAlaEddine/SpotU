/**
 * Step 1 — Type de produit + Tags (max 5, tous les tags produit regroupés par catégorie)
 */
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';
import { TagPickerField } from '../../TagPickerField';

const BLUE = '#3B82F6';
const MAX_TAGS = 5;

const PRODUCT_TYPES = [
  { key: 'rental'  as const, label: 'Location', desc: 'Louez votre matériel à la journée ou à la session', icon: 'key-outline',   available: true },
  { key: 'sale'    as const, label: 'Vente',    desc: "Vendez votre matériel d'occasion",                  icon: 'cart-outline',  available: false },
  { key: 'digital' as const, label: 'Digital',  desc: 'PDF, programme, vidéo…',                            icon: 'cloud-outline', available: false },
] as const;

export function Step1TypeCategory() {
  const { form, set } = useProductForm();
  // Map des tags chargés par TagPickerField pour auto-déduire la catégorie
  const [allTagsMap, setAllTagsMap] = useState<Record<string, { label_fr: string; category_id: string }>>({});

  const handleTagsChange = (ids: string[]) => {
    set({ tag_ids: ids });
    // Auto-déduire la catégorie depuis le premier tag sélectionné
    if (ids.length > 0 && allTagsMap[ids[0]]?.category_id) {
      set({ category: allTagsMap[ids[0]].category_id });
    } else if (ids.length === 0) {
      set({ category: '' });
    }
  };

  return (
    <View style={s.wrap}>

      {/* ── Type de produit ────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.label}>Type de produit</Text>
        {PRODUCT_TYPES.map(t => {
          const active = form.product_type === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[s.typeRow, active && s.typeRowActive, !t.available && s.typeRowDisabled]}
              onPress={() => t.available && set({ product_type: t.key })}
              disabled={!t.available}
              testID={`product-type-${t.key}`}
            >
              <View style={[s.typeIcon, active && { backgroundColor: BLUE + '22' }]}>
                <Ionicons name={t.icon as any} size={22} color={active ? BLUE : Colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={s.typeLabelRow}>
                  <Text style={[s.typeLabel, active && { color: BLUE }]}>{t.label}</Text>
                  {!t.available && (
                    <View style={s.soonBadge}><Text style={s.soonText}>Bientôt</Text></View>
                  )}
                </View>
                <Text style={s.typeDesc} numberOfLines={1}>{t.desc}</Text>
              </View>
              {active && <Ionicons name="checkmark-circle" size={22} color={BLUE} />}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Tags — tous les tags produit, regroupés par catégorie ──────── */}
      <View style={s.section}>
        <TagPickerField
          entityType="product"
          showDomains
          selectedTagIds={form.tag_ids ?? []}
          onChangeTagIds={handleTagsChange}
          onTagsLoaded={(tags) =>
            setAllTagsMap(Object.fromEntries(tags.map(t => [t.tag_id, t])))
          }
          maxSelect={MAX_TAGS}
          accentColor={BLUE}
          label="Tags"
          hint={`Sélectionne jusqu'à ${MAX_TAGS} tags pour aider les locataires à te trouver`}
        />
        {(form.tag_ids ?? []).length > 0 && (
          <View style={s.visibilityCard}>
            <Ionicons name="information-circle-outline" size={16} color={BLUE} />
            <Text style={s.visibilityText}>
              Ton produit apparaît automatiquement dans la boutique des SpotYou dont les tags correspondent aux tiens et dans la boutique globale.
            </Text>
          </View>
        )}
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  wrap:            { gap: Spacing.xl },
  section:         { gap: 10 },
  label:           { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },

  // Product types
  typeRow:         { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  typeRowActive:   { borderColor: BLUE, backgroundColor: BLUE + '08' },
  typeRowDisabled: { opacity: 0.4 },
  typeIcon:        { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.border },
  typeLabelRow:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeLabel:       { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  typeDesc:        { fontSize: 12, color: Colors.muted, marginTop: 2 },
  soonBadge:       { backgroundColor: Colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  soonText:        { fontSize: 10, color: Colors.muted, fontWeight: '600' },

  // Visibility info card
  visibilityCard:  { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '25', marginTop: 4 },
  visibilityText:  { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 18 },
});
