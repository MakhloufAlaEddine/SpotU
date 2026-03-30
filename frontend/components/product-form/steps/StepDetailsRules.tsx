/**
 * StepDetailsRules — Étape fusionnée (anciens Step3Details + Step7Rules).
 * Tous les champs sont optionnels. Auto-scroll vers le champ focalisé.
 */
import React, { useRef } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';
import { useFlowScroll } from '../FlowScrollContext';

const BLUE = '#3B82F6';

export function StepDetailsRules() {
  const { form, set } = useProductForm();
  const scrollRef    = useFlowScroll();

  // Refs sur chaque wrapper View pour mesurer la position
  const pickupRef = useRef<View>(null);
  const returnRef = useRef<View>(null);
  const cancelRef = useRef<View>(null);

  const scrollToField = (fieldRef: React.RefObject<View>) => {
    if (!scrollRef?.current || !fieldRef.current) return;
    fieldRef.current.measure((_x, _y, _w, _h, _px, pageY) => {
      // pageY = position absolue depuis le haut de l'écran
      // On scroll pour montrer le champ avec 120px de marge en haut
      scrollRef.current?.scrollTo({ y: Math.max(0, pageY - 120), animated: true });
    });
  };

  return (
    <View style={s.wrap}>

      <View style={s.headerNote}>
        <Ionicons name="information-circle-outline" size={15} color={BLUE} />
        <Text style={s.headerNoteText}>
          Tous ces champs sont optionnels mais augmentent la confiance des locataires et améliorent votre score.
        </Text>
      </View>

      {/* ── Résumé rapide ─────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>CONTENU DE L'ANNONCE</Text>

        <View style={s.field}>
          <Text style={s.label}>RÉSUMÉ RAPIDE <Text style={s.opt}>(optionnel)</Text></Text>
          <TextInput
            style={s.input}
            value={form.short_description}
            onChangeText={v => set({ short_description: v })}
            placeholder="1-2 phrases pour convaincre en un coup d'œil…"
            placeholderTextColor={Colors.muted}
            maxLength={120}
            testID="product-short-desc-input"
          />
          <Text style={s.counter}>{(form.short_description || '').length}/120</Text>
        </View>

        <View style={s.field}>
          <Text style={s.label}>CE QUI EST INCLUS <Text style={s.opt}>(optionnel)</Text></Text>
          <TextInput
            style={s.input}
            value={form.included_items}
            onChangeText={v => set({ included_items: v })}
            placeholder="ex: Casque, pompe, antivol, sac de transport…"
            placeholderTextColor={Colors.muted}
            testID="product-included-input"
          />
        </View>
      </View>

      {/* ── Règles ────────────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>RÈGLES & CONSIGNES</Text>

        <View ref={pickupRef} style={s.field}>
          <Text style={s.label}>CONSIGNES DE REMISE <Text style={s.opt}>(optionnel)</Text></Text>
          <TextInput
            style={[s.input, s.textarea]}
            value={form.pickup_notes}
            onChangeText={v => set({ pickup_notes: v })}
            onFocus={() => scrollToField(pickupRef)}
            placeholder="ex: RDV devant le club de padel, sonnez au 2e…"
            placeholderTextColor={Colors.muted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            testID="product-pickup-notes-input"
          />
        </View>

        <View ref={returnRef} style={s.field}>
          <Text style={s.label}>RÈGLES DE RETOUR <Text style={s.opt}>(optionnel)</Text></Text>
          <TextInput
            style={[s.input, s.textarea]}
            value={form.return_rules}
            onChangeText={v => set({ return_rules: v })}
            onFocus={() => scrollToField(returnRef)}
            placeholder="ex: Matériel à rendre propre et en bon état avant 20h le dernier jour…"
            placeholderTextColor={Colors.muted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            testID="product-return-rules-input"
          />
        </View>

        <View ref={cancelRef} style={s.field}>
          <Text style={s.label}>CONDITIONS D'ANNULATION <Text style={s.opt}>(optionnel)</Text></Text>
          <TextInput
            style={[s.input, s.textarea]}
            value={form.cancellation_rules}
            onChangeText={v => set({ cancellation_rules: v })}
            onFocus={() => scrollToField(cancelRef)}
            placeholder="ex: Annulation gratuite jusqu'à 48h avant la date de début…"
            placeholderTextColor={Colors.muted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            testID="product-cancel-rules-input"
          />
        </View>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  wrap:            { gap: 20 },
  headerNote:      { flexDirection: 'row', gap: 8, backgroundColor: BLUE + '12', borderRadius: Radius.md, borderWidth: 1, borderColor: BLUE + '30', padding: 12, alignItems: 'flex-start' },
  headerNoteText:  { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 18 },

  section:         { gap: 14 },
  sectionTitle:    { fontSize: 10, fontWeight: '800', color: BLUE, letterSpacing: 1.5, marginBottom: 2 },

  field:           { gap: 6 },
  label:           { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  opt:             { color: Colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  counter:         { fontSize: 11, color: Colors.muted, textAlign: 'right' },

  input:           { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 11 },
  textarea:        { minHeight: 80, paddingTop: 11 },
});
