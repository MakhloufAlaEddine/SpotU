/**
 * Step 3 — Détails : Description, résumé, contenu inclus (tous optionnels)
 * Étape légère — aucun champ obligatoire.
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';

const BLUE = '#3B82F6';

export function Step3Details() {
  const { form, set } = useProductForm();

  return (
    <View style={d.wrap}>

      <View style={d.headerNote}>
        <Ionicons name="information-circle-outline" size={15} color={BLUE} />
        <Text style={d.headerNoteText}>
          Ces informations sont optionnelles mais augmentent la confiance des locataires.
        </Text>
      </View>

      {/* ── Résumé rapide ─────────────────────────────────────────────── */}
      <View style={d.field}>
        <Text style={d.label}>RÉSUMÉ RAPIDE <Text style={d.optional}>(optionnel)</Text></Text>
        <TextInput
          style={d.input}
          value={form.short_description}
          onChangeText={v => set({ short_description: v })}
          placeholder="1-2 phrases pour convaincre en un coup d'œil…"
          placeholderTextColor={Colors.muted}
          maxLength={120}
          testID="product-short-desc-input"
        />
        <Text style={d.counter}>{(form.short_description || '').length}/120</Text>
      </View>

      {/* ── Description complète ──────────────────────────────────────── */}
      <View style={d.field}>
        <Text style={d.label}>DESCRIPTION COMPLÈTE <Text style={d.optional}>(optionnel)</Text></Text>
        <TextInput
          style={[d.input, d.textarea]}
          value={form.description}
          onChangeText={v => set({ description: v })}
          placeholder="Modèle, taille, état détaillé, usage recommandé…"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={1000}
          testID="product-desc-input"
        />
        <Text style={d.counter}>{(form.description || '').length}/1000</Text>
      </View>

      {/* ── Ce qui est inclus ─────────────────────────────────────────── */}
      <View style={d.field}>
        <Text style={d.label}>CE QUI EST INCLUS <Text style={d.optional}>(optionnel)</Text></Text>
        <TextInput
          style={d.input}
          value={form.included_items}
          onChangeText={v => set({ included_items: v })}
          placeholder="ex: Casque, pompe, antivol, sac de transport…"
          placeholderTextColor={Colors.muted}
          testID="product-included-input"
        />
      </View>

    </View>
  );
}

const d = StyleSheet.create({
  wrap:           { gap: 14 },
  headerNote:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(59,130,246,0.10)', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: 'rgba(59,130,246,0.22)' },
  headerNoteText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  field:          { gap: 6 },
  label:          { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  optional:       { color: Colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  counter:        { fontSize: 11, color: Colors.muted, textAlign: 'right' },
  input:          { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 11 },
  textarea:       { minHeight: 90, paddingTop: 11 },
});
