/**
 * Step 3 — Tarification + SpotYou (si mode séance)
 *
 * Règles métier :
 * - Au moins un mode de tarification doit être activé
 * - Si "par séance" est sélectionné → sélectionner au moins 1 SpotYou (obligatoire)
 * - Si "par séance" est le seul mode → avertir de compléter avec heure/jour pour éviter blocage
 * - Lier à un SpotYou = les membres pourront louer le produit lors des séances de ce SpotYou
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, PricingMode } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagImage } from '../../TagImage';

const BLUE   = '#3B82F6';
const ORANGE = '#F59E0B';
const RED    = '#EF4444';

const RATE_UNITS: { key: PricingMode; label: string; shortLabel: string; icon: string; hint: string }[] = [
  { key: 'hour',    label: 'Par heure',   shortLabel: '€/h',     icon: 'time-outline',             hint: 'Idéal pour du matériel sportif ou un vélo' },
  { key: 'day',     label: 'Par jour',    shortLabel: '€/24h',   icon: 'calendar-outline',         hint: 'Durée = 24 heures consécutives' },
  { key: 'week',    label: 'Par semaine', shortLabel: '€/sem',   icon: 'calendar-clear-outline',   hint: 'Réservation de 7 jours' },
  { key: 'month',   label: 'Par mois',    shortLabel: '€/mois',  icon: 'calendar-number-outline',  hint: 'Location longue durée' },
  { key: 'session', label: 'Par séance',  shortLabel: '€/séance',icon: 'stopwatch-outline',        hint: 'Disponible uniquement lors des créneaux du SpotYou sélectionné' },
];

export function Step3Pricing() {
  const { form, set } = useProductForm();
  const [spots, setSpots]     = useState<any[]>([]);
  const [loadingSpots, setLoadingSpots] = useState(false);

  const activeModes   = form.pricing_modes ?? ['day'];
  const hasSession    = activeModes.includes('session');
  const isSessionOnly = hasSession && activeModes.length === 1;
  const selected_ids  = form.related_spotyou_ids ?? [];

  // Charger les SpotYou uniquement si mode séance activé
  useEffect(() => {
    if (!hasSession) return;
    setLoadingSpots(true);
    api.get('/tag-points/mine')
      .then((d: any) => setSpots(d.points || []))
      .catch(() => setSpots([]))
      .finally(() => setLoadingSpots(false));
  }, [hasSession]);

  const toggleMode = (mode: PricingMode) => {
    if (activeModes.includes(mode)) {
      if (activeModes.length === 1) return; // au moins un mode requis
      const next = activeModes.filter(m => m !== mode);
      // Si on retire session, vider les SpotYou sélectionnés
      set({ pricing_modes: next, ...(mode === 'session' ? { related_spotyou_ids: [] } : {}) });
    } else {
      set({ pricing_modes: [...activeModes, mode] });
    }
  };

  const getPrice = (mode: PricingMode): string => {
    switch (mode) {
      case 'hour':  return form.price_per_hour  ?? '';
      case 'day':   return form.price_per_day   ?? '';
      case 'week':  return form.price_per_week  ?? '';
      case 'month': return form.price_per_month ?? '';
      default:      return '';
    }
  };

  const setPrice = (mode: PricingMode, val: string) => {
    const clean = val.replace(/[^0-9.,]/g, '');
    switch (mode) {
      case 'hour':  set({ price_per_hour:  clean }); break;
      case 'day':   set({ price_per_day:   clean }); break;
      case 'week':  set({ price_per_week:  clean }); break;
      case 'month': set({ price_per_month: clean }); break;
    }
  };

  const toggleSpot = (id: string) => {
    if (selected_ids.includes(id)) {
      set({ related_spotyou_ids: selected_ids.filter(i => i !== id) });
    } else {
      set({ related_spotyou_ids: [...selected_ids, id] });
    }
  };

  return (
    <View style={s.wrap}>

      {/* ── Section tarification ───────────────────────────────────────── */}
      <Text style={s.sectionLabel}>Tarification *</Text>
      <Text style={s.sectionHint}>Active les unités que tu proposes. Au moins une est obligatoire.</Text>

      <View style={s.ratesWrap}>
        {RATE_UNITS.map(unit => {
          const active    = activeModes.includes(unit.key);
          const isSession = unit.key === 'session';
          return (
            <View key={unit.key} style={[s.rateRow, active && s.rateRowActive]}>
              <TouchableOpacity
                style={s.rateToggle}
                onPress={() => toggleMode(unit.key)}
                testID={`toggle-mode-${unit.key}`}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={24}
                  color={active ? BLUE : Colors.muted}
                />
              </TouchableOpacity>

              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={unit.icon as any} size={14} color={active ? BLUE : Colors.muted} />
                  <Text style={[s.rateLabel, active && { color: BLUE }]}>{unit.label}</Text>
                  <View style={s.shortLabelBadge}>
                    <Text style={s.shortLabelText}>{unit.shortLabel}</Text>
                  </View>
                </View>
                <Text style={s.rateHint} numberOfLines={2}>{unit.hint}</Text>
              </View>

              {/* Saisie prix (pas pour séance) */}
              {active && !isSession && (
                <View style={s.priceInputRow}>
                  <TextInput
                    style={s.priceInput}
                    value={getPrice(unit.key)}
                    onChangeText={v => setPrice(unit.key, v)}
                    placeholder="0"
                    placeholderTextColor={Colors.muted}
                    keyboardType="decimal-pad"
                    testID={`price-input-${unit.key}`}
                  />
                  <Text style={s.priceCurrency}>€</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* ── Avertissement séance seule ─────────────────────────────────── */}
      {isSessionOnly && (
        <View style={s.warnCard}>
          <Ionicons name="warning-outline" size={18} color={ORANGE} />
          <Text style={s.warnText}>
            <Text style={{ fontWeight: '800' }}>Attention :</Text> avec uniquement la tarification par séance, si aucun créneau n'est disponible dans le SpotYou, la location sera bloquée.{'\n'}
            Pense à ajouter une tarification par heure ou par jour comme alternative.
          </Text>
        </View>
      )}

      {/* ── Section SpotYou (visible si mode séance activé) ───────────── */}
      {hasSession && (
        <View style={s.spotSection}>

          <View style={s.spotSectionHeader}>
            <View style={s.requiredBadge}>
              <Ionicons name="alert-circle-outline" size={13} color={RED} />
              <Text style={s.requiredText}>Obligatoire avec la tarification par séance</Text>
            </View>
          </View>

          {/* Explication correcte de la logique */}
          <View style={s.infoCard}>
            <Ionicons name="information-circle-outline" size={18} color={BLUE} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.infoTitle}>Comment fonctionne la tarification par séance ?</Text>
              <Text style={s.infoText}>
                Lier à un SpotYou permet aux membres de cette communauté de <Text style={{ fontWeight: '700', color: Colors.foreground }}>louer ton produit lors des séances proposées dans ce SpotYou.</Text>
              </Text>
              <Text style={[s.infoText, { color: BLUE, fontWeight: '600' }]}>
                Mode location par séance : au moment de la réservation, l'utilisateur choisira un créneau parmi ceux du SpotYou rattaché à ton produit.
              </Text>
            </View>
          </View>

          <Text style={s.sectionLabel}>Tes SpotYou {spots.length > 0 ? `(${spots.length})` : ''}</Text>

          {loadingSpots && <ActivityIndicator color={BLUE} style={{ marginVertical: 12 }} />}

          {/* Pas de SpotYou */}
          {!loadingSpots && spots.length === 0 && (
            <View style={s.emptyCard}>
              <Ionicons name="map-outline" size={32} color={Colors.muted} />
              <Text style={s.emptyText}>Tu n'as pas encore créé de SpotYou.</Text>
              <Text style={[s.emptyHint, { color: RED }]}>
                La tarification par séance nécessite un SpotYou. Crée-en un d'abord, ou ajoute une autre tarification (heure/jour).
              </Text>
            </View>
          )}

          {/* Liste des SpotYou */}
          {spots.map(sp => {
            const sel = selected_ids.includes(sp.point_id);
            return (
              <TouchableOpacity
                key={sp.point_id}
                style={[s.spotRow, sel && s.spotRowActive]}
                onPress={() => toggleSpot(sp.point_id)}
                testID={`spot-${sp.point_id}`}
                activeOpacity={0.75}
              >
                <TagImage uri={sp.image_url} tagIds={sp.tag_ids || []} style={s.spotImg} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.spotTitle, sel && { color: BLUE }]} numberOfLines={1}>{sp.title}</Text>
                  <Text style={s.spotSub} numberOfLines={1}>{sp.address || sp.city || ''}</Text>
                </View>
                <View style={[s.checkbox, sel && s.checkboxActive]}>
                  {sel && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
              </TouchableOpacity>
            );
          })}

          {selected_ids.length > 0 && (
            <View style={s.selectedInfo}>
              <Ionicons name="checkmark-circle" size={14} color={BLUE} />
              <Text style={s.selectedInfoText}>
                {selected_ids.length} SpotYou sélectionné{selected_ids.length > 1 ? 's' : ''}
              </Text>
            </View>
          )}
        </View>
      )}

    </View>
  );
}

const s = StyleSheet.create({
  wrap:             { gap: Spacing.md },
  sectionLabel:     { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionHint:      { fontSize: 12, color: Colors.muted, lineHeight: 16, marginTop: -6 },

  ratesWrap:        { gap: 8 },
  rateRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border },
  rateRowActive:    { borderColor: BLUE, backgroundColor: BLUE + '06' },
  rateToggle:       { width: 28, alignItems: 'center' },
  rateLabel:        { fontSize: 14, fontWeight: '700', color: Colors.muted },
  shortLabelBadge:  { backgroundColor: Colors.border, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  shortLabelText:   { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  rateHint:         { fontSize: 11, color: Colors.muted, lineHeight: 15 },
  priceInputRow:    { flexDirection: 'row', alignItems: 'center', gap: 4 },
  priceInput:       { width: 68, backgroundColor: Colors.background, borderRadius: Radius.sm, borderWidth: 1, borderColor: BLUE + '50', color: Colors.foreground, fontSize: 15, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 8, textAlign: 'center' },
  priceCurrency:    { fontSize: 16, fontWeight: '700', color: BLUE },

  warnCard:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: ORANGE + '12', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: ORANGE + '40' },
  warnText:         { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },

  // SpotYou section
  spotSection:      { gap: Spacing.md, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  spotSectionHeader:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requiredBadge:    { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#FEE2E2', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#FECACA' },
  requiredText:     { fontSize: 12, fontWeight: '700', color: RED },
  infoCard:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '25' },
  infoTitle:        { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  infoText:         { fontSize: 12, color: Colors.muted, lineHeight: 18 },
  emptyCard:        { alignItems: 'center', gap: 8, paddingVertical: 28, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  emptyText:        { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  emptyHint:        { fontSize: 12, textAlign: 'center', paddingHorizontal: 24, lineHeight: 17 },
  spotRow:          { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border },
  spotRowActive:    { borderColor: BLUE, backgroundColor: BLUE + '08' },
  spotImg:          { width: 50, height: 50, borderRadius: Radius.sm },
  spotTitle:        { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  spotSub:          { fontSize: 12, color: Colors.muted, marginTop: 2 },
  checkbox:         { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  checkboxActive:   { backgroundColor: BLUE, borderColor: BLUE },
  selectedInfo:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BLUE + '10', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6 },
  selectedInfoText: { fontSize: 12, fontWeight: '600', color: BLUE },
});
