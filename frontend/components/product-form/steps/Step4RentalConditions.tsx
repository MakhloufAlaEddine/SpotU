/**
 * Step 4 — Conditions de location
 */
import React from 'react';
import { View, Text, TextInput, Switch, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, PickupType } from '../ProductFormContext';

const VIOLET = '#8B5CF6';

const PICKUP_OPTS: { key: PickupType; label: string; desc: string; icon: string }[] = [
  { key: 'local_pickup',    label: 'Récupération sur place', desc: 'Le locataire vient chercher le matériel', icon: 'location-outline' },
  { key: 'creator_handoff', label: 'Remise en main propre',  desc: 'Tu apportes le matériel au locataire',    icon: 'person-outline'   },
];

function Field({ label, hint, children, required }: { label: string; hint?: string; children: React.ReactNode; required?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={r.label}>{label}</Text>
        {required && <Text style={{ color: '#EF4444', fontSize: 13 }}>*</Text>}
      </View>
      {children}
      {hint && <Text style={r.hint}>{hint}</Text>}
    </View>
  );
}

export function Step4RentalConditions() {
  const { form, set } = useProductForm();

  return (
    <View style={r.wrap}>
      {/* Mode de remise */}
      <Field label="Mode de remise du matériel" required>
        {PICKUP_OPTS.map(o => {
          const active = form.pickup_type === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              style={[r.pickupRow, active && r.pickupRowActive]}
              onPress={() => set({ pickup_type: o.key })}
              testID={`pickup-${o.key}`}
            >
              <View style={[r.pickupIcon, active && { backgroundColor: VIOLET + '20' }]}>
                <Ionicons name={o.icon as any} size={20} color={active ? VIOLET : Colors.muted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[r.pickupLabel, active && { color: VIOLET }]}>{o.label}</Text>
                <Text style={r.pickupDesc}>{o.desc}</Text>
              </View>
              {active && <Ionicons name="checkmark-circle" size={20} color={VIOLET} />}
            </TouchableOpacity>
          );
        })}
      </Field>

      {/* Notes remise */}
      <Field label="Consignes de remise" hint="Précise où / comment se retrouver (adresse, code porte…)">
        <TextInput
          style={[r.input, r.textarea]}
          value={form.pickup_notes}
          onChangeText={v => set({ pickup_notes: v })}
          placeholder="ex: RDV devant l'entrée du club de padel, sonnez au 2ème"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="pickup-notes-input"
        />
      </Field>

      {/* Durée max (location au jour) */}
      {form.pricing_type === 'day' && (
        <Field label="Durée maximale de location" hint="En nombre de jours" required>
          <View style={r.rowInput}>
            <TextInput
              style={[r.input, { width: 80 }]}
              value={form.max_duration_days}
              onChangeText={v => set({ max_duration_days: v.replace(/[^0-9]/g, '') })}
              placeholder="7"
              placeholderTextColor={Colors.muted}
              keyboardType="number-pad"
              testID="max-days-input"
            />
            <Text style={r.unitLabel}>jours</Text>
          </View>
        </Field>
      )}

      {/* Caution */}
      <View style={r.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={r.switchLabel}>Caution requise</Text>
          <Text style={r.switchDesc}>Montant retenu jusqu'au retour du matériel</Text>
        </View>
        <Switch
          value={form.deposit_required}
          onValueChange={v => set({ deposit_required: v, deposit_amount: v ? form.deposit_amount : '' })}
          thumbColor={form.deposit_required ? VIOLET : Colors.muted}
          trackColor={{ false: Colors.border, true: VIOLET + '60' }}
          testID="deposit-switch"
        />
      </View>

      {form.deposit_required && (
        <Field label="Montant de la caution" required>
          <View style={r.priceRow}>
            <TextInput
              style={[r.input, { width: 100 }]}
              value={form.deposit_amount}
              onChangeText={v => set({ deposit_amount: v.replace(/[^0-9.,]/g, '') })}
              placeholder="50"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
              testID="deposit-amount-input"
            />
            <Text style={r.priceCurrency}>€</Text>
          </View>
        </Field>
      )}

      {/* Règles de retour */}
      <Field label="Règles de retour" hint="Comment et quand le matériel doit être rendu ?">
        <TextInput
          style={[r.input, r.textarea]}
          value={form.return_rules}
          onChangeText={v => set({ return_rules: v })}
          placeholder="ex: Matériel à rendre propre et en bon état le dernier jour avant 20h"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          testID="return-rules-input"
        />
      </Field>

      {/* Conditions d'annulation */}
      <Field label="Conditions d'annulation" hint="ex: Remboursement complet si annulation 48h avant">
        <TextInput
          style={[r.input, r.textarea]}
          value={form.cancellation_rules}
          onChangeText={v => set({ cancellation_rules: v })}
          placeholder="ex: Annulation gratuite jusqu'à 48h avant la date de début"
          placeholderTextColor={Colors.muted}
          multiline
          numberOfLines={2}
          textAlignVertical="top"
          testID="cancellation-rules-input"
        />
      </Field>

      {/* Conseil qualité */}
      <View style={r.qualityCard}>
        <Ionicons name="shield-checkmark-outline" size={18} color={VIOLET} />
        <Text style={r.qualityText}>Des conditions claires réduisent les annulations et les litiges. Sois précis et honnête.</Text>
      </View>
    </View>
  );
}

const r = StyleSheet.create({
  wrap:           { gap: Spacing.lg },
  label:          { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  hint:           { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  input:          { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 12 },
  textarea:       { minHeight: 80 },
  rowInput:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unitLabel:      { fontSize: 14, color: Colors.muted },
  pickupRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  pickupRowActive:{ borderColor: VIOLET, backgroundColor: VIOLET + '08' },
  pickupIcon:     { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  pickupLabel:    { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  pickupDesc:     { fontSize: 12, color: Colors.muted, marginTop: 1 },
  switchRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  switchLabel:    { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  switchDesc:     { fontSize: 12, color: Colors.muted, marginTop: 1 },
  priceRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceCurrency:  { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  qualityCard:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: VIOLET + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: VIOLET + '30' },
  qualityText:    { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
});
