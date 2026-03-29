import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';

const BLUE = '#3B82F6';

export function Step7Rules() {
  const { form, set } = useProductForm();

  return (
    <View style={r.wrap}>

      <View style={r.headerNote}>
        <Ionicons name="information-circle-outline" size={15} color={BLUE} />
        <Text style={r.headerNoteText}>
          Ces champs sont optionnels. Des règles claires réduisent les malentendus et améliorent ton score.
        </Text>
      </View>

      {/* ── Consignes de remise ───────────────────────────────────────── */}
      <View style={r.field}>
        <Text style={r.label}>CONSIGNES DE REMISE <Text style={r.optional}>(optionnel)</Text></Text>
        <TextInput
          style={[r.input, r.textarea]}
          value={form.pickup_notes}
          onChangeText={v => set({ pickup_notes: v })}
          placeholder="ex: RDV devant le club de padel, sonnez au 2e…"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="pickup-notes-input"
        />
      </View>

      {/* ── Règles de retour ──────────────────────────────────────────── */}
      <View style={r.field}>
        <Text style={r.label}>RÈGLES DE RETOUR <Text style={r.optional}>(optionnel)</Text></Text>
        <TextInput
          style={[r.input, r.textarea]}
          value={form.return_rules}
          onChangeText={v => set({ return_rules: v })}
          placeholder="ex: Matériel à rendre propre et en bon état avant 20h le dernier jour…"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="return-rules-input"
        />
      </View>

      {/* ── Conditions d'annulation ───────────────────────────────────── */}
      <View style={r.field}>
        <Text style={r.label}>CONDITIONS D'ANNULATION <Text style={r.optional}>(optionnel)</Text></Text>
        <TextInput
          style={[r.input, r.textarea]}
          value={form.cancellation_rules}
          onChangeText={v => set({ cancellation_rules: v })}
          placeholder="ex: Annulation gratuite jusqu'à 48h avant la date de début…"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="cancellation-rules-input"
        />
      </View>

    </View>
  );
}

const r = StyleSheet.create({
  wrap:           { gap: 14 },
  headerNote:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(59,130,246,0.10)', borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: 'rgba(59,130,246,0.22)' },
  headerNoteText: { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  field:          { gap: 6 },
  label:          { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  optional:       { color: Colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  input:          { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 11 },
  textarea:       { minHeight: 72, paddingTop: 11 },
});
