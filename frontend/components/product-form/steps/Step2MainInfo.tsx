/**
 * Step 2 — Informations principales (titre, description, prix, quantité)
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, ConditionLabel, PricingType } from '../ProductFormContext';

const VIOLET = '#8B5CF6';

const CONDITIONS: { key: ConditionLabel; label: string; desc: string; color: string }[] = [
  { key: 'new',        label: 'Neuf',        desc: 'Jamais utilisé',          color: '#22C55E' },
  { key: 'very_good',  label: 'Très bon',    desc: 'Utilisé quelques fois',   color: VIOLET    },
  { key: 'good',       label: 'Bon',         desc: 'Normal, avec traces',     color: '#F59E0B' },
  { key: 'acceptable', label: 'Acceptable',  desc: 'Visible usure, fonctionne', color: '#EF4444' },
];

const PRICING: { key: PricingType; label: string; icon: string }[] = [
  { key: 'day',     label: 'Par jour',    icon: 'calendar-outline' },
  { key: 'session', label: 'Par séance',  icon: 'time-outline'     },
];

function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={f.label}>{label}</Text>
        {required && <Text style={{ color: '#EF4444', fontSize: 13 }}>*</Text>}
      </View>
      {children}
      {hint && <Text style={f.hint}>{hint}</Text>}
    </View>
  );
}

export function Step2MainInfo() {
  const { form, set } = useProductForm();

  return (
    <View style={f.wrap}>
      {/* Titre */}
      <Field label="Titre de l'annonce" hint="Sois précis : 'Location vélo de route carbone 28 pouces'" required>
        <TextInput
          style={f.input}
          value={form.title}
          onChangeText={v => set({ title: v })}
          placeholder="ex: Location raquettes de padel"
          placeholderTextColor={Colors.muted}
          maxLength={80}
          testID="product-title-input"
        />
        <Text style={f.charCount}>{form.title.length}/80</Text>
      </Field>

      {/* Description courte */}
      <Field label="Résumé rapide" hint="1-2 phrases pour convaincre en un coup d'œil">
        <TextInput
          style={f.input}
          value={form.short_description}
          onChangeText={v => set({ short_description: v })}
          placeholder="ex: Raquettes Bullpadel neuves, idéales pour débutants"
          placeholderTextColor={Colors.muted}
          maxLength={120}
          testID="product-short-desc-input"
        />
      </Field>

      {/* Description détaillée */}
      <Field label="Description complète" hint="Explique ce qui est inclus, l'état réel, les spécificités">
        <TextInput
          style={[f.input, f.textarea]}
          value={form.description}
          onChangeText={v => set({ description: v })}
          placeholder="Décris le matériel en détail : modèle, taille, état, ce qui est inclus dans la location..."
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          maxLength={1000}
          testID="product-desc-input"
        />
        <Text style={f.charCount}>{form.description.length}/1000</Text>
      </Field>

      {/* État */}
      <Field label="État du matériel" required>
        <View style={f.rowWrap}>
          {CONDITIONS.map(c => {
            const active = form.condition_label === c.key;
            return (
              <TouchableOpacity
                key={c.key}
                style={[f.condChip, active && { borderColor: c.color, backgroundColor: c.color + '15' }]}
                onPress={() => set({ condition_label: c.key })}
                testID={`condition-${c.key}`}
              >
                <Text style={[f.condLabel, active && { color: c.color }]}>{c.label}</Text>
                <Text style={[f.condDesc, active && { color: c.color + 'CC' }]}>{c.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Field>

      {/* Ce qui est inclus */}
      <Field label="Ce qui est inclus" hint="ex: Casque, pompe, antivol…">
        <TextInput
          style={f.input}
          value={form.included_items}
          onChangeText={v => set({ included_items: v })}
          placeholder="Détaille tout ce que le locataire reçoit"
          placeholderTextColor={Colors.muted}
          testID="product-included-input"
        />
      </Field>

      {/* Marque / modèle */}
      <Field label="Marque / Modèle" hint="Optionnel — aide à rassurer les locataires">
        <TextInput
          style={f.input}
          value={form.brand_model}
          onChangeText={v => set({ brand_model: v })}
          placeholder="ex: Decathlon Riverside 500, HEAD Graphene"
          placeholderTextColor={Colors.muted}
          testID="product-brand-input"
        />
      </Field>

      {/* Prix + type */}
      <View style={f.rowBetween}>
        <Field label="Prix" required>
          <View style={f.priceRow}>
            <TextInput
              style={[f.input, f.priceInput]}
              value={form.price}
              onChangeText={v => set({ price: v.replace(/[^0-9.,]/g, '') })}
              placeholder="0"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
              testID="product-price-input"
            />
            <Text style={f.priceCurrency}>€</Text>
          </View>
        </Field>

        <Field label="Tarification" required>
          <View style={f.rowWrap}>
            {PRICING.map(p => {
              const active = form.pricing_type === p.key;
              return (
                <TouchableOpacity
                  key={p.key}
                  style={[f.pricingChip, active && f.pricingChipActive]}
                  onPress={() => set({ pricing_type: p.key })}
                  testID={`pricing-${p.key}`}
                >
                  <Ionicons name={p.icon as any} size={14} color={active ? VIOLET : Colors.muted} />
                  <Text style={[f.pricingLabel, active && { color: VIOLET }]}>{p.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Field>
      </View>

      {/* Quantité */}
      <Field label="Quantité disponible" hint="Combien d'exemplaires pouvez-vous louer simultanément ?" required>
        <View style={f.qtyRow}>
          <TouchableOpacity
            style={f.qtyBtn}
            onPress={() => set({ available_quantity: String(Math.max(1, parseInt(form.available_quantity || '1', 10) - 1)) })}
            testID="qty-minus"
          >
            <Ionicons name="remove" size={18} color={Colors.foreground} />
          </TouchableOpacity>
          <TextInput
            style={f.qtyInput}
            value={form.available_quantity}
            onChangeText={v => set({ available_quantity: v.replace(/[^0-9]/g, '') || '1' })}
            keyboardType="number-pad"
            textAlign="center"
            testID="product-qty-input"
          />
          <TouchableOpacity
            style={f.qtyBtn}
            onPress={() => set({ available_quantity: String(parseInt(form.available_quantity || '1', 10) + 1) })}
            testID="qty-plus"
          >
            <Ionicons name="add" size={18} color={Colors.foreground} />
          </TouchableOpacity>
        </View>
      </Field>
    </View>
  );
}

const f = StyleSheet.create({
  wrap:           { gap: Spacing.lg },
  label:          { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint:           { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  input:          { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 12 },
  textarea:       { minHeight: 100 },
  charCount:      { fontSize: 11, color: Colors.muted, textAlign: 'right', marginTop: 2 },
  rowWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween:     { flexDirection: 'row', gap: 12 },
  condChip:       { flex: 1, minWidth: '45%', backgroundColor: Colors.card, borderRadius: Radius.md, padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 2 },
  condLabel:      { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  condDesc:       { fontSize: 10, color: Colors.muted },
  priceRow:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceInput:     { width: 90 },
  priceCurrency:  { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  pricingChip:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radius.sm, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border },
  pricingChipActive: { borderColor: VIOLET, backgroundColor: VIOLET + '10' },
  pricingLabel:   { fontSize: 13, fontWeight: '600', color: Colors.muted },
  qtyRow:         { flexDirection: 'row', alignItems: 'center', gap: 0, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', alignSelf: 'flex-start' },
  qtyBtn:         { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyInput:       { width: 56, height: 44, fontSize: 16, fontWeight: '700', color: Colors.foreground, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border },
});
