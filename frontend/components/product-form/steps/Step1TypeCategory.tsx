/**
 * Step 1 — Type de produit + Catégorie + Tags (max 5)
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagPickerField } from '../../TagPickerField';

const BLUE = '#3B82F6';
const MAX_TAGS = 5;

const PRODUCT_TYPES = [
  { key: 'rental'  as const, label: 'Location', desc: 'Louez votre matériel à la journée ou à la session', icon: 'key-outline',   available: true },
  { key: 'sale'    as const, label: 'Vente',    desc: "Vendez votre matériel d'occasion",                  icon: 'cart-outline',  available: false },
  { key: 'digital' as const, label: 'Digital',  desc: 'PDF, programme, vidéo…',                            icon: 'cloud-outline', available: false },
] as const;

interface TagItem     { tag_id: string; name: string; label_fr: string; icon?: string }
interface CategoryItem { category_id: string; name: string; label_fr: string; icon: string; domain_id: string; tags: TagItem[] }

export function Step1TypeCategory() {
  const { form, set } = useProductForm();
  const [categories, setCategories]   = useState<CategoryItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

  useEffect(() => {
    api.get('/tags/categories?entity_type=product')
      .then((data: CategoryItem[]) => setCategories(data || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // selectedCat et availableTags maintenant gérés par TagPickerField

  const selectCategory = (cid: string) => {
    // Réinitialise les tags quand la catégorie change
    set({ category: cid, tag_ids: [], category_label: categories.find(c => c.category_id === cid)?.label_fr ?? '' });
  };

  const domains = Array.from(new Set(categories.map(c => c.domain_id))).map(did => ({
    domain_id: did,
    label: did === 'dom_sport' ? 'Sport & Outdoor' : did === 'dom_services_locaux' ? 'Services locaux' : did,
  }));
  const filteredCats = domainFilter ? categories.filter(c => c.domain_id === domainFilter) : categories;
  const selectedCount = (form.tag_ids ?? []).length;

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

      {/* ── Catégorie ──────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.label}>Catégorie du matériel *</Text>

        {/* Si catégorie sélectionnée → badge compact avec bouton "Changer" */}
        {form.category !== '' ? (
          <TouchableOpacity
            style={s.selectedCatBadge}
            onPress={() => set({ category: '', tag_ids: [] })}
            testID="change-category-btn"
            activeOpacity={0.7}
          >
            {(() => {
              const cat = categories.find(c => c.category_id === form.category);
              return (
                <>
                  <Ionicons name={(cat?.icon || 'grid-outline') as any} size={18} color={BLUE} />
                  <Text style={s.selectedCatLabel}>{cat?.label_fr ?? form.category}</Text>
                  <View style={s.changePill}>
                    <Text style={s.changeText}>Changer</Text>
                  </View>
                </>
              );
            })()}
          </TouchableOpacity>
        ) : (
          /* Grille complète si aucune catégorie sélectionnée */
          <>
            {domains.length > 1 && (
              <View style={s.domainRow}>
                <TouchableOpacity
                  style={[s.domainChip, !domainFilter && s.domainChipActive]}
                  onPress={() => setDomainFilter(null)}
                >
                  <Text style={[s.domainChipText, !domainFilter && { color: BLUE }]}>Tout</Text>
                </TouchableOpacity>
                {domains.map(d => (
                  <TouchableOpacity
                    key={d.domain_id}
                    style={[s.domainChip, domainFilter === d.domain_id && s.domainChipActive]}
                    onPress={() => setDomainFilter(domainFilter === d.domain_id ? null : d.domain_id)}
                    testID={`product-domain-${d.domain_id}`}
                  >
                    <Text style={[s.domainChipText, domainFilter === d.domain_id && { color: BLUE }]}>{d.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {loading ? (
              <ActivityIndicator color={BLUE} style={{ marginTop: 12 }} />
            ) : (
              <View style={s.catGrid}>
                {filteredCats.map(c => {
                  const active = form.category === c.category_id;
                  return (
                    <TouchableOpacity
                      key={c.category_id}
                      style={[s.catChip, active && s.catChipActive]}
                      onPress={() => selectCategory(c.category_id)}
                      testID={`category-${c.category_id}`}
                    >
                      <Ionicons name={(c.icon || 'grid-outline') as any} size={18} color={active ? BLUE : Colors.muted} />
                      <Text style={[s.catLabel, active && { color: BLUE }]} numberOfLines={1}>
                        {c.label_fr}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
                {filteredCats.length === 0 && !loading && (
                  <Text style={{ color: Colors.muted, fontSize: 13 }}>Aucune catégorie disponible</Text>
                )}
              </View>
            )}
          </>
        )}
      </View>

      {/* ── Tags (visible quand catégorie sélectionnée) ──────────────────── */}
      {form.category !== '' && (
        <View style={s.section}>
          <TagPickerField
            entityType="product"
            filterCategoryId={form.category}
            selectedTagIds={form.tag_ids ?? []}
            onChangeTagIds={(ids) => set({ tag_ids: ids })}
            maxSelect={MAX_TAGS}
            accentColor={BLUE}
            label="TAGS"
            required
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
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap:             { gap: Spacing.xl },
  section:          { gap: 10 },
  label:            { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },

  // Product types
  typeRow:          { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  typeRowActive:    { borderColor: BLUE, backgroundColor: BLUE + '08' },
  typeRowDisabled:  { opacity: 0.4 },
  typeIcon:         { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.border },
  typeLabelRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeLabel:        { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  typeDesc:         { fontSize: 12, color: Colors.muted, marginTop: 2 },
  soonBadge:        { backgroundColor: Colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  soonText:         { fontSize: 10, color: Colors.muted, fontWeight: '600' },

  // Domain filter
  domainRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  domainChip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  domainChipActive: { borderColor: BLUE, backgroundColor: BLUE + '10' },
  domainChipText:   { fontSize: 13, fontWeight: '600', color: Colors.muted },

  // Category grid
  catGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border },
  catChipActive:    { borderColor: BLUE, backgroundColor: BLUE + '10' },
  catLabel:         { fontSize: 13, fontWeight: '600', color: Colors.muted },

  // Selected category badge
  selectedCatBadge: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: BLUE + '10', borderRadius: Radius.md, borderWidth: 1.5, borderColor: BLUE + '40', paddingHorizontal: 14, paddingVertical: 12 },
  selectedCatLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: BLUE },
  changePill:       { backgroundColor: BLUE, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  changeText:       { fontSize: 12, fontWeight: '700', color: '#fff' },

  // Tags
  tagHeader:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tagCounter:       { fontSize: 12, fontWeight: '600', color: Colors.muted },
  tagCounterFull:   { color: BLUE },
  tagGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip:          { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: Colors.card, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border },
  tagChipSelected:  { borderColor: BLUE, backgroundColor: BLUE + '12' },
  tagChipDisabled:  { opacity: 0.4 },
  tagLabel:         { fontSize: 13, fontWeight: '500', color: Colors.muted },
  tagLabelSelected: { color: BLUE, fontWeight: '600' },
  emptyTags:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  emptyTagsText:    { fontSize: 13, color: Colors.muted, fontStyle: 'italic' },
  clearTags:        { alignSelf: 'flex-start', marginTop: 4 },
  clearTagsText:    { fontSize: 12, color: Colors.muted, textDecorationLine: 'underline' },
  visibilityCard:   { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '25', marginTop: 4 },
  visibilityText:   { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 18 },
});
