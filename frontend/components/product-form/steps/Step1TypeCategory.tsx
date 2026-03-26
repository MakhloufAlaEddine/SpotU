/**
 * Step 1 — Type de produit + Catégorie (dynamique via API entity_type=product)
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';
import { api } from '../../../services/api';

const BLUE = '#3B82F6';

/* ── Types de produit ───────────────────────────────────────────────────── */
const PRODUCT_TYPES = [
  { key: 'rental' as const,  label: 'Location', desc: 'Louez votre matériel à la journée ou à la session', icon: 'key-outline',   available: true },
  { key: 'sale'   as const,  label: 'Vente',    desc: 'Vendez votre matériel d\'occasion',                  icon: 'cart-outline',  available: false },
  { key: 'digital' as const, label: 'Digital',  desc: 'PDF, programme, vidéo…',                             icon: 'cloud-outline', available: false },
] as const;

interface CategoryItem { category_id: string; name: string; label_fr: string; icon: string; domain_id: string; }

export function Step1TypeCategory() {
  const { form, set } = useProductForm();
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [domainFilter, setDomainFilter] = useState<string | null>(null);

  useEffect(() => {
    api.get('/tags/categories?entity_type=product').then((data: CategoryItem[]) => {
      setCategories(data || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // Domaines distincts présents dans les catégories produit
  const domains = Array.from(new Set(categories.map(c => c.domain_id))).map(did => ({
    domain_id: did,
    label: did === 'dom_sport' ? 'Sport & Outdoor' : did === 'dom_services_locaux' ? 'Services locaux' : did,
  }));

  const filteredCats = domainFilter ? categories.filter(c => c.domain_id === domainFilter) : categories;

  return (
    <View style={s.wrap}>
      {/* Type de produit */}
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

      {/* Catégorie — dynamique API */}
      <View style={s.section}>
        <Text style={s.label}>Catégorie du matériel *</Text>

        {/* Filtre domaine */}
        {domains.length > 1 && (
          <View style={s.domainRow}>
            <TouchableOpacity style={[s.domainChip, !domainFilter && s.domainChipActive]}
              onPress={() => setDomainFilter(null)}>
              <Text style={[s.domainChipText, !domainFilter && { color: BLUE }]}>Tout</Text>
            </TouchableOpacity>
            {domains.map(d => (
              <TouchableOpacity key={d.domain_id} style={[s.domainChip, domainFilter === d.domain_id && s.domainChipActive]}
                onPress={() => setDomainFilter(domainFilter === d.domain_id ? null : d.domain_id)}
                testID={`product-domain-${d.domain_id}`}>
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
                  onPress={() => set({ category: c.category_id })}
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
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:             { gap: Spacing.xl },
  section:          { gap: 10 },
  label:            { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  typeRow:          { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  typeRowActive:    { borderColor: BLUE, backgroundColor: BLUE + '08' },
  typeRowDisabled:  { opacity: 0.4 },
  typeIcon:         { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.border },
  typeLabelRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeLabel:        { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  typeDesc:         { fontSize: 12, color: Colors.muted, marginTop: 2 },
  soonBadge:        { backgroundColor: Colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  soonText:         { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  domainRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  domainChip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  domainChipActive: { borderColor: BLUE, backgroundColor: BLUE + '10' },
  domainChipText:   { fontSize: 13, fontWeight: '600', color: Colors.muted },
  catGrid:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip:          { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border },
  catChipActive:    { borderColor: BLUE, backgroundColor: BLUE + '10' },
  catLabel:         { fontSize: 13, fontWeight: '600', color: Colors.muted },
});
