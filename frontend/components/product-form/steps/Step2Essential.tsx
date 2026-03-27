/**
 * Step 2 — L'essentiel : Titre, État, Quantité, Marque (optionnel)
 * Champs obligatoires uniquement + 1 champ optionnel — pas de scroll.
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, ConditionLabel } from '../ProductFormContext';

const BLUE = '#3B82F6';

const CONDITIONS: { key: ConditionLabel; label: string; emoji: string; color: string }[] = [
  { key: 'new',        label: 'Neuf',      emoji: '✨', color: '#22C55E' },
  { key: 'very_good',  label: 'Très bon',  emoji: '👍', color: BLUE      },
  { key: 'good',       label: 'Bon',       emoji: '👌', color: '#F59E0B' },
  { key: 'acceptable', label: 'Acceptable', emoji: '⚠', color: '#EF4444' },
];

export function Step2Essential() {
  const { form, set } = useProductForm();

  return (
    <View style={s.wrap}>

      {/* ── Titre ─────────────────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={s.label}>TITRE DE L'ANNONCE <Text style={s.req}>*</Text></Text>
        <TextInput
          style={s.input}
          value={form.title}
          onChangeText={v => set({ title: v })}
          placeholder='ex: Location vélo de route carbone 28"'
          placeholderTextColor={Colors.muted}
          maxLength={80}
          testID="product-title-input"
          autoFocus
        />
        <Text style={s.counter}>{form.title.length}/80</Text>
      </View>

      {/* ── État du matériel ──────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={s.label}>ÉTAT DU MATÉRIEL <Text style={s.req}>*</Text></Text>
        <View style={s.condGrid}>
          {CONDITIONS.map(c => {
            const active = form.condition_label === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.condChip, active && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                onPress={() => set({ condition_label: c.key })}
                testID={`condition-${c.key}`}
                activeOpacity={0.75}
              >
                <Text style={[s.condLabel, active && { color: c.color }]}>
                  {c.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Quantité disponible ───────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={s.label}>QUANTITÉ DISPONIBLE <Text style={s.req}>*</Text></Text>
        <View style={s.qtyRow}>
          <TouchableOpacity
            style={s.qtyBtn}
            onPress={() => set({ available_quantity: String(Math.max(1, parseInt(form.available_quantity || '1', 10) - 1)) })}
            testID="qty-minus"
          >
            <Ionicons name="remove" size={18} color={Colors.foreground} />
          </TouchableOpacity>
          <TextInput
            style={s.qtyInput}
            value={form.available_quantity}
            onChangeText={v => set({ available_quantity: v.replace(/[^0-9]/g, '') || '1' })}
            keyboardType="number-pad"
            textAlign="center"
            testID="product-qty-input"
          />
          <TouchableOpacity
            style={s.qtyBtn}
            onPress={() => set({ available_quantity: String(parseInt(form.available_quantity || '1', 10) + 1) })}
            testID="qty-plus"
          >
            <Ionicons name="add" size={18} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
        <Text style={s.hint}>Nombre d'exemplaires disponibles simultanément</Text>
      </View>

      {/* ── Marque / Modèle — optionnel ───────────────────────────────── */}
      <View style={s.field}>
        <Text style={s.label}>MARQUE / MODÈLE <Text style={s.optional}>(optionnel)</Text></Text>
        <TextInput
          style={s.input}
          value={form.brand_model}
          onChangeText={v => set({ brand_model: v })}
          placeholder="ex: Decathlon Riverside 500, HEAD Graphene 360"
          placeholderTextColor={Colors.muted}
          testID="product-brand-input"
        />
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  wrap:      { gap: Spacing.xl },
  field:     { gap: 8 },
  label:     { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  req:       { color: '#EF4444' },
  optional:  { color: Colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  hint:      { fontSize: 11, color: Colors.muted },
  counter:   { fontSize: 11, color: Colors.muted, textAlign: 'right' },
  input:     { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 15, paddingHorizontal: 14, paddingVertical: 13 },

  condGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  condChip:  { flex: 1, minWidth: '45%', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border },
  condLabel: { fontSize: 13, fontWeight: '700', color: Colors.muted },

  qtyRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', alignSelf: 'flex-start' },
  qtyBtn:    { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  qtyInput:  { width: 64, height: 48, fontSize: 18, fontWeight: '800', color: Colors.foreground, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border },
});
