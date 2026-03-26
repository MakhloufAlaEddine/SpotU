/**
 * Step 1 — Type de produit + Catégorie
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';

const BLUE = '#8B5CF6';

/* ── Catégories ────────────────────────────────────────────────────────── */
const CATEGORIES = [
  { key: 'velo',      label: 'Vélo / Trottinette',    icon: 'bicycle-outline'      },
  { key: 'raquette',  label: 'Raquette / Padel',       icon: 'tennisball-outline'   },
  { key: 'fitness',   label: 'Fitness / Musculation',  icon: 'barbell-outline'      },
  { key: 'yoga',      label: 'Yoga / Tapis',           icon: 'body-outline'         },
  { key: 'ballon',    label: 'Ballon / Sports collectifs', icon: 'football-outline' },
  { key: 'natation',  label: 'Natation',               icon: 'water-outline'        },
  { key: 'glisse',    label: 'Ski / Snowboard',        icon: 'snow-outline'         },
  { key: 'running',   label: 'Running / Trail',        icon: 'walk-outline'         },
  { key: 'accessoire',label: 'Accessoires sport',      icon: 'bag-outline'          },
  { key: 'autre',     label: 'Autre matériel',         icon: 'grid-outline'         },
] as const;

/* ── Types de produit (extensible) ─────────────────────────────────────── */
const PRODUCT_TYPES = [
  {
    key: 'rental' as const,
    label: 'Location',
    desc: 'Louez votre matériel à la journée ou à la session',
    icon: 'key-outline',
    available: true,
  },
  {
    key: 'sale' as const,
    label: 'Vente',
    desc: 'Vendez votre matériel d\'occasion',
    icon: 'cart-outline',
    available: false,
  },
  {
    key: 'digital' as const,
    label: 'Digital',
    desc: 'PDF, programme, vidéo…',
    icon: 'cloud-outline',
    available: false,
  },
] as const;

export function Step1TypeCategory() {
  const { form, set } = useProductForm();

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

      {/* Catégorie */}
      <View style={s.section}>
        <Text style={s.label}>Catégorie du matériel *</Text>
        <View style={s.catGrid}>
          {CATEGORIES.map(c => {
            const active = form.category === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.catChip, active && s.catChipActive]}
                onPress={() => set({ category: c.key })}
                testID={`category-${c.key}`}
              >
                <Ionicons name={c.icon as any} size={18} color={active ? BLUE : Colors.muted} />
                <Text style={[s.catLabel, active && { color: BLUE }]} numberOfLines={1}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:           { gap: Spacing.xl },
  section:        { gap: 10 },
  label:          { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  typeRow:        { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  typeRowActive:  { borderColor: BLUE, backgroundColor: BLUE + '08' },
  typeRowDisabled:{ opacity: 0.4 },
  typeIcon:       { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.border },
  typeLabelRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeLabel:      { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  typeDesc:       { fontSize: 12, color: Colors.muted, marginTop: 2 },
  soonBadge:      { backgroundColor: Colors.border, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  soonText:       { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  catGrid:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  catChip:        { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: Colors.border },
  catChipActive:  { borderColor: BLUE, backgroundColor: BLUE + '10' },
  catLabel:       { fontSize: 13, fontWeight: '600', color: Colors.muted },
});
