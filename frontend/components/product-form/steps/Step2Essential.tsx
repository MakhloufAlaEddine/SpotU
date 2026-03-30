/**
 * Step 2 — L'essentiel : Titre, État, Quantité, Marque (optionnel)
 * Champs obligatoires uniquement + 1 champ optionnel — pas de scroll.
 */
import React, { useRef } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, ConditionLabel } from '../ProductFormContext';
import { useFlowScroll } from '../FlowScrollContext';

const BLUE = '#3B82F6';

const CONDITIONS: { key: ConditionLabel; label: string; emoji: string; color: string }[] = [
  { key: 'new',        label: 'Neuf',      emoji: '✨', color: '#22C55E' },
  { key: 'very_good',  label: 'Très bon',  emoji: '👍', color: BLUE      },
  { key: 'good',       label: 'Bon',       emoji: '👌', color: '#F59E0B' },
  { key: 'acceptable', label: 'Acceptable', emoji: '⚠', color: '#EF4444' },
];

export function Step2Essential() {
  const { form, set } = useProductForm();
  const scrollRef     = useFlowScroll();
  const descRef       = useRef<View>(null);

  const scrollToDesc = () => {
    if (!scrollRef?.current || !descRef.current) return;
    descRef.current.measure((_x, _y, _w, _h, _px, pageY) => {
      scrollRef.current?.scrollTo({ y: Math.max(0, pageY - 120), animated: true });
    });
  };

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
        />
        <Text style={s.counter}>{form.title.length}/80</Text>
      </View>

      {/* ── État du matériel ──────────────────────────────────────────── */}
      <View style={s.field}>
        <Text style={s.label}>ÉTAT DU MATÉRIEL <Text style={s.req}>*</Text></Text>
        <View style={s.condRow}>
          {CONDITIONS.slice(0, 2).map(c => {
            const active = form.condition_label === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.condChip, active && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                onPress={() => set({ condition_label: c.key })}
                testID={`condition-${c.key}`}
                activeOpacity={0.75}
              >
                <Text style={[s.condLabel, active && { color: c.color }]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={s.condRow}>
          {CONDITIONS.slice(2).map(c => {
            const active = form.condition_label === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[s.condChip, active && { borderColor: c.color, backgroundColor: c.color + '18' }]}
                onPress={() => set({ condition_label: c.key })}
                testID={`condition-${c.key}`}
                activeOpacity={0.75}
              >
                <Text style={[s.condLabel, active && { color: c.color }]}>{c.label}</Text>
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

      {/* ── Description — obligatoire min 30 car. ────────────────────── */}
      <View ref={descRef} style={s.field}>
        <Text style={s.label}>DESCRIPTION <Text style={s.req}>*</Text></Text>
        {(() => {
          const len = (form.description || '').trim().length;
          const ok  = len >= 30;
          return (
            <>
              <TextInput
                style={[s.input, s.textarea, !ok && len > 0 && s.inputError]}
                value={form.description}
                onChangeText={v => set({ description: v })}
                onFocus={scrollToDesc}
                placeholder="État détaillé, usage recommandé, accessoires inclus, dimensions…"
                placeholderTextColor={Colors.muted}
                multiline
                numberOfLines={4}
                textAlignVertical="top"
                maxLength={1000}
                testID="product-desc-input"
              />
              <View style={s.counterRow}>
                {len < 30 ? (
                  <Text style={s.counterWarn}>{len}/30 caractères minimum</Text>
                ) : (
                  <Text style={s.counterOk}>✓ {len} caractères</Text>
                )}
              </View>
            </>
          );
        })()}
        <Text style={s.hint}>Soyez précis : état, taille, usage, équipements fournis…</Text>
      </View>

    </View>
  );
}

const s = StyleSheet.create({
  wrap:        { gap: 14 },
  field:       { gap: 6 },
  label:       { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  req:         { color: '#EF4444' },
  optional:    { color: Colors.muted, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  hint:        { fontSize: 11, color: Colors.muted },
  counter:     { fontSize: 11, color: Colors.muted, textAlign: 'right' },
  counterRow:  { flexDirection: 'row', justifyContent: 'flex-end' },
  counterWarn: { fontSize: 11, color: '#EF4444', fontWeight: '600' },
  counterOk:   { fontSize: 11, color: '#22C55E', fontWeight: '600' },
  input:       { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  inputError:  { borderColor: '#EF444466' },
  textarea:    { minHeight: 90, paddingTop: 12, fontSize: 14 },

  condRow:     { flexDirection: 'row', marginBottom: 8 },
  condChip:    { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, marginHorizontal: 4 },
  condLabel:   { fontSize: 13, fontWeight: '700', color: Colors.muted },

  qtyRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', alignSelf: 'flex-start' },
  qtyBtn:      { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyInput:    { width: 56, height: 44, fontSize: 18, fontWeight: '800', color: Colors.foreground, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border },
});
