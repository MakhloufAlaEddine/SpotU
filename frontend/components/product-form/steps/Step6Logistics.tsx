/**
 * Step 6 — Logistique : Mode de remise + Durée max (cond.) + Caution (cond.)
 * Champs conditionnels pour garder l'écran léger.
 */
import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, PickupType } from '../ProductFormContext';

const BLUE = '#3B82F6';

const PICKUP_OPTS: { key: PickupType; label: string; desc: string; icon: string }[] = [
  { key: 'local_pickup',    label: 'Sur place',           desc: 'Le locataire vient chercher',   icon: 'location-outline' },
  { key: 'creator_handoff', label: 'Remise en main propre', desc: 'Tu apportes le matériel',      icon: 'person-outline'   },
];

export function Step6Logistics() {
  const { form, set } = useProductForm();

  const needsDuration = (form.pricing_modes ?? []).some(m => ['day', 'week', 'month'].includes(m));

  return (
    <View style={l.wrap}>

      {/* ── Mode de remise ────────────────────────────────────────────── */}
      <View style={l.field}>
        <Text style={l.label}>MODE DE REMISE <Text style={l.req}>*</Text></Text>
        <View style={l.pickupRow}>
          {PICKUP_OPTS.map(o => {
            const active = form.pickup_type === o.key;
            return (
              <TouchableOpacity
                key={o.key}
                style={[l.pickupCard, active && l.pickupCardActive]}
                onPress={() => set({ pickup_type: o.key })}
                testID={`pickup-${o.key}`}
                activeOpacity={0.75}
              >
                <View style={[l.pickupIcon, active && { backgroundColor: BLUE + '22' }]}>
                  <Ionicons name={o.icon as any} size={22} color={active ? BLUE : Colors.muted} />
                </View>
                <Text style={[l.pickupLabel, active && { color: BLUE }]}>{o.label}</Text>
                <Text style={l.pickupDesc} numberOfLines={1}>{o.desc}</Text>
                {active && (
                  <View style={l.pickupCheck}>
                    <Ionicons name="checkmark" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Durée maximale (conditionnel: si mode jour/semaine/mois) ──── */}
      {needsDuration && (
        <View style={l.field}>
          <Text style={l.label}>DURÉE MAXIMALE DE LOCATION <Text style={l.req}>*</Text></Text>
          <View style={l.inlineRow}>
            <TextInput
              style={[l.input, { width: 90 }]}
              value={form.max_duration_days}
              onChangeText={v => set({ max_duration_days: v.replace(/[^0-9]/g, '') })}
              placeholder="7"
              placeholderTextColor={Colors.muted}
              keyboardType="number-pad"
              testID="max-days-input"
            />
            <Text style={l.unit}>jours consécutifs maximum</Text>
          </View>
        </View>
      )}

      {/* ── Caution ───────────────────────────────────────────────────── */}
      <View style={l.switchCard}>
        <View style={{ flex: 1 }}>
          <Text style={l.switchLabel}>Caution requise</Text>
          <Text style={l.switchDesc}>Montant retenu jusqu'au retour du matériel</Text>
        </View>
        <Switch
          value={form.deposit_required}
          onValueChange={v => set({ deposit_required: v, deposit_amount: v ? form.deposit_amount : '' })}
          thumbColor={form.deposit_required ? BLUE : Colors.muted}
          trackColor={{ false: Colors.border, true: BLUE + '60' }}
          testID="deposit-switch"
        />
      </View>

      {form.deposit_required && (
        <View style={l.field}>
          <Text style={l.label}>MONTANT DE LA CAUTION <Text style={l.req}>*</Text></Text>
          <View style={l.inlineRow}>
            <TextInput
              style={[l.input, { width: 110 }]}
              value={form.deposit_amount}
              onChangeText={v => set({ deposit_amount: v.replace(/[^0-9.,]/g, '') })}
              placeholder="50"
              placeholderTextColor={Colors.muted}
              keyboardType="decimal-pad"
              testID="deposit-amount-input"
            />
            <Text style={l.currency}>€</Text>
          </View>
        </View>
      )}

    </View>
  );
}

const l = StyleSheet.create({
  wrap:          { gap: 14 },
  field:         { gap: 8 },
  label:         { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  req:           { color: '#EF4444' },
  input:         { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, color: Colors.foreground, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  inlineRow:     { flexDirection: 'row', alignItems: 'center', gap: 12 },
  unit:          { fontSize: 13, color: Colors.muted, flex: 1 },
  currency:      { fontSize: 18, fontWeight: '700', color: BLUE },

  pickupRow:     { flexDirection: 'row', gap: 10 },
  pickupCard:    { flex: 1, alignItems: 'center', gap: 6, padding: 14, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, position: 'relative' },
  pickupCardActive: { borderColor: BLUE, backgroundColor: BLUE + '08' },
  pickupIcon:    { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  pickupLabel:   { fontSize: 13, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  pickupDesc:    { fontSize: 11, color: Colors.muted, textAlign: 'center' },
  pickupCheck:   { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },

  switchCard:    { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, padding: 14, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  switchLabel:   { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  switchDesc:    { fontSize: 12, color: Colors.muted, marginTop: 2 },
});
