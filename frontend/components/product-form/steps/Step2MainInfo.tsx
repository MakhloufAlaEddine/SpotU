/**
 * Step 2 — Informations principales + Tarification multi-unité
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, ConditionLabel, PricingMode } from '../ProductFormContext';

const BLUE = '#3B82F6';

const CONDITIONS: { key: ConditionLabel; label: string; desc: string; color: string }[] = [
  { key: 'new',        label: 'Neuf',        desc: 'Jamais utilisé',            color: '#22C55E' },
  { key: 'very_good',  label: 'Très bon',    desc: 'Utilisé quelques fois',     color: BLUE      },
  { key: 'good',       label: 'Bon',         desc: 'Normal, avec traces',       color: '#F59E0B' },
  { key: 'acceptable', label: 'Acceptable',  desc: 'Usure visible, fonctionne', color: '#EF4444' },
];

const RATE_UNITS: { key: PricingMode; label: string; shortLabel: string; icon: string; hint: string }[] = [
  { key: 'hour',  label: 'Par heure',   shortLabel: '€/h',     icon: 'time-outline',          hint: 'Idéal pour matériel sport ou vélo' },
  { key: 'day',   label: 'Par jour',    shortLabel: '€/24h',   icon: 'calendar-outline',      hint: 'Durée = 24 heures' },
  { key: 'week',  label: 'Par semaine', shortLabel: '€/sem.',  icon: 'calendar-clear-outline', hint: 'Réductions incluses' },
  { key: 'month', label: 'Par mois',    shortLabel: '€/mois',  icon: 'calendar-number-outline', hint: 'Abonnement longue durée' },
  { key: 'session', label: 'Par séance', shortLabel: '€/séance', icon: 'stopwatch-outline',  hint: 'Rattacher à un SpotYou avec créneaux' },
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

  const toggleMode = (mode: PricingMode) => {
    const current = form.pricing_modes ?? [];
    if (current.includes(mode)) {
      // Ne pas retirer si c'est le seul mode actif
      if (current.length === 1) return;
      set({ pricing_modes: current.filter(m => m !== mode) });
    } else {
      set({ pricing_modes: [...current, mode] });
    }
  };

  const getPriceField = (mode: PricingMode): string => {
    switch (mode) {
      case 'hour':  return form.price_per_hour;
      case 'day':   return form.price_per_day;
      case 'week':  return form.price_per_week;
      case 'month': return form.price_per_month;
      default:      return '';
    }
  };

  const setPriceField = (mode: PricingMode, val: string) => {
    const clean = val.replace(/[^0-9.,]/g, '');
    switch (mode) {
      case 'hour':  set({ price_per_hour: clean }); break;
      case 'day':   set({ price_per_day: clean }); break;
      case 'week':  set({ price_per_week: clean }); break;
      case 'month': set({ price_per_month: clean }); break;
    }
  };

  const activeModes = form.pricing_modes ?? ['day'];
  const sessionEnabled = activeModes.includes('session');

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
          placeholder="ex: Raquettes Bullpadel neuves, idéales débutants"
          placeholderTextColor={Colors.muted}
          maxLength={120}
          testID="product-short-desc-input"
        />
      </Field>

      {/* Description détaillée */}
      <Field label="Description complète" hint="Modèle, taille, état, ce qui est inclus…">
        <TextInput
          style={[f.input, f.textarea]}
          value={form.description}
          onChangeText={v => set({ description: v })}
          placeholder="Décris le matériel : modèle, état, contenu de la location..."
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

      {/* Inclus */}
      <Field label="Ce qui est inclus" hint="ex: Casque, pompe, antivol…">
        <TextInput
          style={f.input}
          value={form.included_items}
          onChangeText={v => set({ included_items: v })}
          placeholder="Tout ce que le locataire reçoit"
          placeholderTextColor={Colors.muted}
          testID="product-included-input"
        />
      </Field>

      {/* Marque */}
      <Field label="Marque / Modèle" hint="Optionnel — rassure les locataires">
        <TextInput
          style={f.input}
          value={form.brand_model}
          onChangeText={v => set({ brand_model: v })}
          placeholder="ex: Decathlon Riverside 500, HEAD Graphene"
          placeholderTextColor={Colors.muted}
          testID="product-brand-input"
        />
      </Field>

      {/* ── TARIFICATION MULTI-UNITÉ ─────────────────────────────────── */}
      <Field label="Tarification" hint="Active les unités que tu proposes — au moins une est obligatoire" required>
        <View style={f.ratesWrap}>
          {RATE_UNITS.map(unit => {
            const active = activeModes.includes(unit.key);
            const isSession = unit.key === 'session';
            return (
              <View key={unit.key} style={[f.rateRow, active && f.rateRowActive]} testID={`rate-row-${unit.key}`}>
                {/* Toggle */}
                <TouchableOpacity
                  style={[f.rateToggle, active && f.rateToggleActive]}
                  onPress={() => toggleMode(unit.key)}
                  testID={`toggle-mode-${unit.key}`}
                >
                  <Ionicons
                    name={active ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={active ? BLUE : Colors.muted}
                  />
                </TouchableOpacity>

                {/* Label + hint */}
                <View style={f.rateInfo}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name={unit.icon as any} size={14} color={active ? BLUE : Colors.muted} />
                    <Text style={[f.rateLabel, active && { color: BLUE }]}>{unit.label}</Text>
                    <Text style={f.rateShort}>{unit.shortLabel}</Text>
                  </View>
                  <Text style={f.rateHint} numberOfLines={1}>{unit.hint}</Text>
                </View>

                {/* Saisie prix (pas pour séance) */}
                {active && !isSession && (
                  <View style={f.ratePriceRow}>
                    <TextInput
                      style={f.ratePriceInput}
                      value={getPriceField(unit.key)}
                      onChangeText={v => setPriceField(unit.key, v)}
                      placeholder="0"
                      placeholderTextColor={Colors.muted}
                      keyboardType="decimal-pad"
                      testID={`price-input-${unit.key}`}
                    />
                    <Text style={f.rateCurrency}>€</Text>
                  </View>
                )}

                {/* Badge "Séance" */}
                {isSession && active && (
                  <View style={f.sessionBadge}>
                    <Ionicons name="link-outline" size={13} color={BLUE} />
                    <Text style={f.sessionBadgeText}>Lier SpotYou</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* Info séance */}
        {sessionEnabled && (
          <View style={f.sessionInfo}>
            <Ionicons name="information-circle-outline" size={16} color={BLUE} />
            <Text style={f.sessionInfoText}>
              Le mode séance nécessite de rattacher ce produit à un SpotYou avec des créneaux (étape 6). Le locataire choisira le SpotYou et le créneau au moment de la réservation.
            </Text>
          </View>
        )}
      </Field>

      {/* Quantité */}
      <Field label="Quantité disponible" hint="Combien d'exemplaires simultanément ?" required>
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
  condChip:       { flex: 1, minWidth: '45%', backgroundColor: Colors.card, borderRadius: Radius.md, padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 2 },
  condLabel:      { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  condDesc:       { fontSize: 10, color: Colors.muted },

  // Rates
  ratesWrap:        { gap: 8 },
  rateRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border },
  rateRowActive:    { borderColor: BLUE, backgroundColor: BLUE + '06' },
  rateToggle:       { width: 28, alignItems: 'center' },
  rateToggleActive: {},
  rateInfo:         { flex: 1, gap: 2 },
  rateLabel:        { fontSize: 14, fontWeight: '700', color: Colors.muted },
  rateShort:        { fontSize: 11, color: Colors.muted, backgroundColor: Colors.border, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  rateHint:         { fontSize: 11, color: Colors.muted },
  ratePriceRow:     { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratePriceInput:   { width: 72, backgroundColor: Colors.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: BLUE + '50', color: Colors.foreground, fontSize: 15, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 8, textAlign: 'center' },
  rateCurrency:     { fontSize: 16, fontWeight: '700', color: BLUE },
  sessionBadge:     { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: BLUE + '12', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  sessionBadgeText: { fontSize: 11, fontWeight: '600', color: BLUE },
  sessionInfo:      { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '30', marginTop: 4 },
  sessionInfoText:  { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },

  // Qty
  qtyRow:     { flexDirection: 'row', alignItems: 'center', gap: 0, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', alignSelf: 'flex-start' },
  qtyBtn:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  qtyInput:   { width: 56, height: 44, fontSize: 16, fontWeight: '700', color: Colors.foreground, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.border },
});
