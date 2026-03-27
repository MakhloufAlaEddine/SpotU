/**
 * Step 5 — Tarification : Pills de mode + inputs conditionnels + SpotYou (si séance)
 * Design épuré : les inputs de prix s'affichent uniquement pour les modes actifs.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, PricingMode } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagImage } from '../../TagImage';

const BLUE   = '#3B82F6';
const ORANGE = '#F59E0B';

const MODES: { key: PricingMode; label: string; short: string }[] = [
  { key: 'hour',    label: 'Par heure',    short: '€/h'    },
  { key: 'day',     label: 'Par jour',     short: '€/j'    },
  { key: 'week',    label: 'Par semaine',  short: '€/sem'  },
  { key: 'month',   label: 'Par mois',     short: '€/mois' },
  { key: 'session', label: 'Par séance',   short: 'créneaux' },
];

export function Step5Pricing() {
  const { form, set } = useProductForm();

  const [spots, setSpots]   = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const activeModes    = form.pricing_modes ?? ['day'];
  const sessionEnabled = activeModes.includes('session');
  const sessionOnly    = sessionEnabled && activeModes.length === 1;

  useEffect(() => {
    if (!sessionEnabled) return;
    setLoading(true);
    api.get('/tag-points/mine')
      .then((d: any) => setSpots(Array.isArray(d) ? d : (d.points || [])))
      .catch(() => setSpots([]))
      .finally(() => setLoading(false));
  }, [sessionEnabled]);

  const toggleMode = (mode: PricingMode) => {
    if (activeModes.includes(mode)) {
      if (activeModes.length === 1) return;
      const next = activeModes.filter(m => m !== mode);
      set({ pricing_modes: next, ...(mode === 'session' ? { related_spotyou_ids: [] } : {}) });
    } else {
      set({ pricing_modes: [...activeModes, mode] });
    }
  };

  const getPriceField = (mode: PricingMode): string => {
    switch (mode) {
      case 'hour':  return form.price_per_hour || '';
      case 'day':   return form.price_per_day  || '';
      case 'week':  return form.price_per_week || '';
      case 'month': return form.price_per_month || '';
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

  const toggleSpot = (id: string) => {
    const cur = form.related_spotyou_ids ?? [];
    set({ related_spotyou_ids: cur.includes(id) ? cur.filter(i => i !== id) : [...cur, id] });
  };

  return (
    <View style={p.wrap}>

      {/* ── Sélection des modes ─────────────────────────────────────────── */}
      <View style={p.field}>
        <Text style={p.label}>MODES DE TARIFICATION <Text style={p.req}>*</Text></Text>
        <Text style={p.sublabel}>Active les modes que tu proposes — au moins un obligatoire</Text>
        <View style={p.pillsRow}>
          {MODES.map(m => {
            const active = activeModes.includes(m.key);
            return (
              <TouchableOpacity
                key={m.key}
                style={[p.pill, active && p.pillActive]}
                onPress={() => toggleMode(m.key)}
                testID={`toggle-mode-${m.key}`}
                activeOpacity={0.75}
              >
                <Text style={[p.pillLabel, active && p.pillLabelActive]}>{m.label}</Text>
                <Text style={[p.pillShort, active && p.pillShortActive]}>{m.short}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* ── Inputs de prix (un par mode actif, sauf séance) ─────────────── */}
      {activeModes.filter(m => m !== 'session').map(mode => {
        const info = MODES.find(m => m.key === mode)!;
        return (
          <View key={mode} style={p.priceRow}>
            <Text style={p.priceLabel}>{info.label}</Text>
            <View style={p.priceInputWrap}>
              <TextInput
                style={p.priceInput}
                value={getPriceField(mode)}
                onChangeText={v => setPriceField(mode, v)}
                placeholder="0.00"
                placeholderTextColor={Colors.muted}
                keyboardType="decimal-pad"
                testID={`price-input-${mode}`}
              />
              <Text style={p.priceCurrency}>€</Text>
            </View>
          </View>
        );
      })}

      {/* ── Section SpotYou (si séance activé) ──────────────────────────── */}
      {sessionEnabled && (
        <View style={p.spotSection}>

          {/* Avertissement séance uniquement */}
          {sessionOnly && (
            <View style={p.warnRow}>
              <Ionicons name="warning-outline" size={15} color={ORANGE} />
              <Text style={p.warnText}>
                Sans autre mode de tarification, la location sera bloquée si aucun créneau n'est disponible dans le SpotYou.
              </Text>
            </View>
          )}

          <View style={p.spotHeader}>
            <Text style={p.label}>RATTACHER UN SPOTYOU</Text>
            <View style={p.reqBadge}>
              <Text style={p.reqBadgeText}>Obligatoire</Text>
            </View>
          </View>
          <Text style={p.sublabel}>
            Les membres du SpotYou pourront louer ce produit sur ses créneaux
          </Text>

          {loading && <ActivityIndicator color={BLUE} style={{ marginVertical: 16 }} />}

          {!loading && spots.length === 0 && (
            <View style={p.emptySpots}>
              <Ionicons name="map-outline" size={24} color={Colors.muted} />
              <Text style={p.emptyText}>Aucun SpotYou créé</Text>
              <Text style={p.emptyHint}>Crée un SpotYou d'abord, ou désactive le mode séance.</Text>
            </View>
          )}

          {spots.map(s => {
            const sel = (form.related_spotyou_ids ?? []).includes(s.point_id);
            return (
              <TouchableOpacity
                key={s.point_id}
                style={[p.spotRow, sel && p.spotRowActive]}
                onPress={() => toggleSpot(s.point_id)}
                testID={`spot-${s.point_id}`}
                activeOpacity={0.75}
              >
                <TagImage uri={s.image_url} tagIds={s.tag_ids || []} style={p.spotImg} />
                <View style={{ flex: 1 }}>
                  <Text style={[p.spotTitle, sel && { color: BLUE }]} numberOfLines={1}>{s.title}</Text>
                  <Text style={p.spotSub} numberOfLines={1}>{s.address || s.city || ''}</Text>
                </View>
                <View style={[p.check, sel && p.checkActive]}>
                  {sel && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

    </View>
  );
}

const p = StyleSheet.create({
  wrap:           { gap: Spacing.xl },
  field:          { gap: 10 },
  label:          { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  sublabel:       { fontSize: 12, color: Colors.muted, lineHeight: 16, marginTop: -4 },
  req:            { color: '#EF4444' },

  pillsRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill:           { paddingHorizontal: 14, paddingVertical: 10, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', gap: 2 },
  pillActive:     { borderColor: BLUE, backgroundColor: BLUE },
  pillLabel:      { fontSize: 13, fontWeight: '600', color: Colors.muted },
  pillLabelActive:{ color: '#fff' },
  pillShort:      { fontSize: 10, color: Colors.muted },
  pillShortActive:{ color: 'rgba(255,255,255,0.75)' },

  priceRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  priceLabel:     { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  priceInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  priceInput:     { width: 80, textAlign: 'right', fontSize: 16, fontWeight: '700', color: Colors.foreground, backgroundColor: Colors.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: BLUE + '50', paddingHorizontal: 10, paddingVertical: 8 },
  priceCurrency:  { fontSize: 16, fontWeight: '700', color: BLUE, width: 16 },

  spotSection:    { gap: 12, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.lg },
  spotHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqBadge:       { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#FECACA' },
  reqBadgeText:   { fontSize: 11, fontWeight: '700', color: '#EF4444' },

  warnRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F59E0B12', borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: '#F59E0B40' },
  warnText:       { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },

  emptySpots:     { alignItems: 'center', gap: 6, paddingVertical: 24, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  emptyText:      { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  emptyHint:      { fontSize: 12, color: Colors.muted, textAlign: 'center' },

  spotRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border },
  spotRowActive:  { borderColor: BLUE, backgroundColor: BLUE + '08' },
  spotImg:        { width: 44, height: 44, borderRadius: 8 },
  spotTitle:      { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  spotSub:        { fontSize: 12, color: Colors.muted, marginTop: 1 },
  check:          { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkActive:    { backgroundColor: BLUE, borderColor: BLUE },
});
