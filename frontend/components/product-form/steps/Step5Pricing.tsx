/**
 * Step 5 — Tarification redesign
 * - Modes : grille 2 colonnes compacte, séance en pleine largeur
 * - Prix  : liste épurée label + input inline sans fond lourd
 * - SpotYou : carte riche avec photo, membres, prochain créneau (adapté de SpotYouCard)
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm, PricingMode } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagImage, DOMAIN_ICONS } from '../../TagImage';
import { formatNextDate, sc as SpotSc } from '../../SpotYouCard';

const BLUE   = '#3B82F6';
const ORANGE = '#F59E0B';

const GRID_MODES: { key: PricingMode; label: string; unit: string }[] = [
  { key: 'hour',  label: 'À l\'heure',   unit: '€ / h'    },
  { key: 'day',   label: 'À la journée', unit: '€ / jour' },
  { key: 'week',  label: 'À la semaine', unit: '€ / sem'  },
  { key: 'month', label: 'Au mois',      unit: '€ / mois' },
];
const SESSION_MODE = { key: 'session' as PricingMode, label: 'À la séance', unit: 'Créneaux SpotYou' };

// ── Mini-carte SpotYou sélectionnable ──────────────────────────────────────
function SpotSelectionCard({
  spot, selected, onPress,
}: { spot: any; selected: boolean; onPress: () => void }) {
  const isRecurring = !!spot.event_schedule;
  const nextLabel   = formatNextDate(spot.next_session_date, spot.event_date, spot.event_schedule);
  const members     = spot.participants_count ?? 0;
  const imgUri      = spot.images?.[0] || spot.image_url;

  // Compter les créneaux hebdomadaires
  const slotCount = (() => {
    if (!spot.event_schedule?.schedule) return null;
    const sched = spot.event_schedule.schedule;
    const total = Object.values(sched as Record<string, any[]>)
      .reduce((acc: number, slots: any[]) => acc + (slots?.length || 0), 0);
    return total > 0 ? total : null;
  })();

  return (
    <TouchableOpacity
      style={[p.spotCard, selected && p.spotCardActive]}
      onPress={onPress}
      testID={`spot-${spot.point_id}`}
      activeOpacity={0.82}
    >
      {/* Header: photo + infos */}
      <View style={p.spotCardHeader}>
        {/* Photo */}
        {imgUri ? (
          <TagImage uri={imgUri} domainId={spot.domain_id} style={p.spotThumb} iconSize={24} />
        ) : (
          <View style={[p.spotThumb, p.spotThumbEmpty]}>
            <Ionicons name={DOMAIN_ICONS[spot.domain_id] || 'location-outline'} size={22} color={Colors.muted} />
          </View>
        )}

        {/* Infos */}
        <View style={{ flex: 1 }}>
          {/* Titre + badge récurrent */}
          <View style={p.spotTitleRow}>
            <Text style={[p.spotTitle, selected && { color: BLUE }]} numberOfLines={1}>{spot.title}</Text>
            {isRecurring && (
              <View style={SpotSc.typeBadgeRecurring}>
                <Ionicons name="repeat" size={9} color={Colors.primary} />
                <Text style={[SpotSc.typeBadgeText, { color: Colors.primary }]}>Récurrent</Text>
              </View>
            )}
          </View>

          {/* Membres + créneaux */}
          <View style={p.spotMeta}>
            <View style={SpotSc.membersChip}>
              <Ionicons name="people-outline" size={10} color={Colors.primary} />
              <Text style={SpotSc.membersChipText}>{Math.max(members, 1)} membre{Math.max(members, 1) > 1 ? 's' : ''}</Text>
            </View>
            {slotCount && (
              <View style={p.slotChip}>
                <Ionicons name="time-outline" size={10} color={Colors.muted} />
                <Text style={p.slotChipText}>{slotCount} créneau{slotCount > 1 ? 'x' : ''} / sem</Text>
              </View>
            )}
          </View>
        </View>

        {/* Checkbox */}
        <View style={[p.check, selected && p.checkActive]}>
          {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
        </View>
      </View>

      {/* Prochain créneau */}
      {nextLabel ? (
        <View style={[SpotSc.eventSection, { paddingTop: 8, paddingBottom: 8 }]}>
          <View style={SpotSc.eventDateRow}>
            <View style={SpotSc.eventIconBox}>
              <Ionicons name={isRecurring ? 'repeat' : 'calendar'} size={13} color={Colors.primary} />
            </View>
            <View>
              <Text style={SpotSc.eventLabel}>Prochain créneau</Text>
              <Text style={SpotSc.eventDate}>{nextLabel}</Text>
            </View>
          </View>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

export function Step5Pricing() {
  const { form, set } = useProductForm();
  const [spots, setSpots]     = useState<any[]>([]);
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
      set({ pricing_modes: activeModes.filter(m => m !== mode), ...(mode === 'session' ? { related_spotyou_ids: [] } : {}) });
    } else {
      set({ pricing_modes: [...activeModes, mode] });
    }
  };

  const getPriceField = (mode: PricingMode): string => {
    if (mode === 'hour')  return form.price_per_hour    || '';
    if (mode === 'day')   return form.price_per_day     || '';
    if (mode === 'week')  return form.price_per_week    || '';
    if (mode === 'month') return form.price_per_month   || '';
    if (mode === 'session') return form.price_per_session || '';
    return '';
  };

  const setPriceField = (mode: PricingMode, val: string) => {
    const clean = val.replace(/[^0-9.,]/g, '');
    if (mode === 'hour')    set({ price_per_hour: clean });
    if (mode === 'day')     set({ price_per_day: clean });
    if (mode === 'week')    set({ price_per_week: clean });
    if (mode === 'month')   set({ price_per_month: clean });
    if (mode === 'session') set({ price_per_session: clean });
  };

  const toggleSpot = (id: string) => {
    const cur = form.related_spotyou_ids ?? [];
    set({ related_spotyou_ids: cur.includes(id) ? cur.filter(i => i !== id) : [...cur, id] });
  };

  // Extraire la ville depuis l'adresse (ex: "Forêt de Rambouillet, 78120 Rambouillet" → "Rambouillet")
  const extractCity = (address: string): string => {
    if (!address) return '';
    const parts = address.split(',');
    // Chercher la partie qui contient un code postal 5 chiffres
    for (const p of parts) {
      const match = p.trim().match(/^\d{5}\s+(.+)$/);
      if (match) return match[1].trim();
    }
    // Fallback: dernière partie non vide
    return parts[parts.length - 1]?.trim() || address;
  };

  const activeGridModes = GRID_MODES.filter(m => activeModes.includes(m.key));
  const allPriceModes   = [...activeGridModes, ...(sessionEnabled ? [SESSION_MODE] : [])];

  return (
    <View style={p.wrap}>

      {/* ── Modes de tarification ───────────────────────────────────────── */}
      <View style={p.section}>
        <Text style={p.sectionTitle}>MODES DE TARIFICATION <Text style={p.req}>*</Text></Text>
        <Text style={p.sectionHint}>Active les modes que tu proposes — au moins un obligatoire</Text>

        {/* Grille 2 colonnes pour les 4 modes standards */}
        <View style={p.modeGrid}>
          {GRID_MODES.map(m => {
            const active = activeModes.includes(m.key);
            return (
              <TouchableOpacity
                key={m.key}
                style={[p.modeCell, active && p.modeCellActive]}
                onPress={() => toggleMode(m.key)}
                testID={`toggle-mode-${m.key}`}
                activeOpacity={0.75}
              >
                {active && (
                  <View style={p.modeCheck}>
                    <Ionicons name="checkmark" size={10} color="#fff" />
                  </View>
                )}
                <Text style={[p.modeName, active && p.modeNameActive]}>{m.label}</Text>
                <Text style={[p.modeUnit, active && p.modeUnitActive]}>{m.unit}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Mode séance — pleine largeur */}
        {(() => {
          const active = activeModes.includes('session');
          return (
            <TouchableOpacity
              style={[p.sessionCell, active && p.sessionCellActive]}
              onPress={() => toggleMode('session')}
              testID="toggle-mode-session"
              activeOpacity={0.75}
            >
              <View style={{ flex: 1 }}>
                <Text style={[p.modeName, active && p.modeNameActive]}>{SESSION_MODE.label}</Text>
                <Text style={[p.modeUnit, active && p.modeUnitActive]}>{SESSION_MODE.unit}</Text>
              </View>
              {active && (
                <View style={p.modeCheck}>
                  <Ionicons name="checkmark" size={10} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
          );
        })()}
      </View>

      {/* ── Saisie des prix ─────────────────────────────────────────────── */}
      {allPriceModes.length > 0 && (
        <View style={p.priceBlock}>
          <Text style={[p.sectionTitle, { paddingHorizontal: 16, paddingTop: 12 }]}>TARIFS</Text>
          {allPriceModes.map((m, idx) => (
            <View key={m.key} style={[p.priceRow, idx < allPriceModes.length - 1 && p.priceRowBorder]}>
              <View style={{ flex: 1 }}>
                <Text style={p.priceLabel}>{m.label}</Text>
                <Text style={p.priceUnit}>{m.unit}</Text>
              </View>
              <View style={p.inputWrap}>
                <TextInput
                  style={p.input}
                  value={getPriceField(m.key)}
                  onChangeText={v => setPriceField(m.key, v)}
                  placeholder="0"
                  placeholderTextColor={Colors.muted}
                  keyboardType="decimal-pad"
                  testID={`price-input-${m.key}`}
                />
                <Text style={p.euro}>€</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Section SpotYou (si séance activé) ──────────────────────────── */}
      {sessionEnabled && (
        <View style={p.section}>
          {sessionOnly && (
            <View style={p.warnRow}>
              <Ionicons name="warning-outline" size={14} color={ORANGE} />
              <Text style={p.warnText}>
                Sans autre mode, la location sera bloquée si aucun créneau n'est disponible.
              </Text>
            </View>
          )}

          <View style={p.spotHeader}>
            <Text style={p.sectionTitle}>RATTACHER UN SPOTYOU</Text>
            <View style={p.reqBadge}><Text style={p.reqBadgeText}>Obligatoire</Text></View>
          </View>
          <Text style={p.sectionHint}>Les membres du SpotYou pourront louer sur ses créneaux</Text>

          {loading && <ActivityIndicator color={BLUE} style={{ marginVertical: 16 }} />}

          {!loading && spots.length === 0 && (
            <View style={p.emptySpots}>
              <Ionicons name="map-outline" size={22} color={Colors.muted} />
              <Text style={p.emptyText}>Aucun SpotYou</Text>
              <Text style={p.emptyHint}>Crée un SpotYou d'abord, ou désactive le mode séance.</Text>
            </View>
          )}

          {spots.map(s => (
            <SpotSelectionCard
              key={s.point_id}
              spot={s}
              selected={(form.related_spotyou_ids ?? []).includes(s.point_id)}
              onPress={() => toggleSpot(s.point_id)}
            />
          ))}
        </View>
      )}

    </View>
  );
}

const p = StyleSheet.create({
  wrap:           { gap: 16 },
  section:        { gap: 10 },
  sectionTitle:   { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionHint:    { fontSize: 12, color: Colors.muted, lineHeight: 17, marginTop: -4 },
  req:            { color: '#EF4444' },

  // Grille modes
  modeGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeCell:       { width: '47.5%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, gap: 2, position: 'relative' },
  modeCellActive: { borderColor: BLUE, backgroundColor: BLUE + '14' },
  sessionCell:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, gap: 10 },
  sessionCellActive:{ borderColor: BLUE, backgroundColor: BLUE + '14' },
  modeCheck:      { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  modeName:       { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  modeNameActive: { color: BLUE },
  modeUnit:       { fontSize: 11, color: Colors.muted, marginTop: 1 },
  modeUnitActive: { color: BLUE + 'BB' },

  // Prix
  priceBlock:     { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  priceRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  priceRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  priceLabel:     { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  priceUnit:      { fontSize: 11, color: Colors.muted, marginTop: 1 },
  inputWrap:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input:          { minWidth: 70, textAlign: 'right', fontSize: 18, fontWeight: '700', color: Colors.foreground, paddingVertical: 4, paddingHorizontal: 6 },
  euro:           { fontSize: 16, fontWeight: '700', color: BLUE },

  // SpotYou section header
  spotHeader:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqBadge:       { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#FECACA' },
  reqBadgeText:   { fontSize: 11, fontWeight: '700', color: '#EF4444' },
  warnRow:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F59E0B12', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#F59E0B40' },
  warnText:       { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },
  emptySpots:     { alignItems: 'center', gap: 5, paddingVertical: 18, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  emptyText:      { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  emptyHint:      { fontSize: 11, color: Colors.muted, textAlign: 'center' },
  // SpotYou selection cards
  spotCard:       { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  spotCardActive: { borderColor: BLUE, backgroundColor: BLUE + '08' },
  spotCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  spotThumb:      { width: 60, height: 60, borderRadius: 10 },
  spotThumbEmpty: { backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  spotTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' },
  spotTitle:      { fontSize: 13, fontWeight: '700', color: Colors.foreground, flex: 1 },
  spotMeta:       { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  slotChip:       { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.background, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: Colors.border },
  slotChipText:   { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  check:          { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  checkActive:    { backgroundColor: BLUE, borderColor: BLUE },
});
