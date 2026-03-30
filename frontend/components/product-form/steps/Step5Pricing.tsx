/**
 * Step 5 — Tarification redesign
 * - Modes : grille 2 colonnes compacte, séance en pleine largeur
 * - Prix  : liste épurée label + input inline sans fond lourd
 * - SpotYou : filtre 20km, distance affichée, propriétaire en premier
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, TouchableOpacity, ActivityIndicator,
  Modal, FlatList, SafeAreaView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../../constants/Colors';
import { useProductForm, PricingMode } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagImage, DOMAIN_ICONS } from '../../TagImage';

const BLUE   = '#3B82F6';
const ORANGE = '#F59E0B';
const GREEN  = '#22C55E';
const MAX_KM = 20;

/** Calcul de distance Haversine en km */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

/** Durée de la première séance trouvée dans l'event_schedule */
function getSessionDurationLabel(spot: any): string | null {
  const sched = spot.event_schedule?.schedule;
  if (!sched) return null;
  for (const day of Object.values(sched as Record<string, any[]>)) {
    if (Array.isArray(day) && day.length > 0) {
      const slot = day[0];
      if (slot?.start && slot?.end) {
        const [sh, sm] = slot.start.split(':').map(Number);
        const [eh, em] = slot.end.split(':').map(Number);
        const mins = (eh * 60 + em) - (sh * 60 + sm);
        if (mins > 0) {
          if (mins < 60) return `${mins} min`;
          const h = Math.floor(mins / 60);
          const m = mins % 60;
          return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
        }
      }
    }
  }
  return null;
}

const GRID_MODES: { key: PricingMode; label: string; unit: string }[] = [
  { key: 'hour',  label: 'À l\'heure',   unit: '€ / h'    },
  { key: 'day',   label: 'À la journée', unit: '€ / jour' },
  { key: 'week',  label: 'À la semaine', unit: '€ / sem'  },
  { key: 'month', label: 'Au mois',      unit: '€ / mois' },
];
const SESSION_MODE = { key: 'session' as PricingMode, label: 'À la séance', unit: 'Créneaux SpotYou' };

// ── Ligne compacte dans la modal ──────────────────────────────────────────
function SpotRow({
  spot, selected, onPress,
}: { spot: any; selected: boolean; onPress: () => void }) {
  const imgUri   = spot.images?.[0] || spot.image_url;
  const duration = getSessionDurationLabel(spot);
  const members  = spot.participants_count ?? 0;

  return (
    <TouchableOpacity
      style={[p.spotRow, selected && p.spotRowActive]}
      onPress={onPress}
      testID={`spot-row-${spot.point_id}`}
      activeOpacity={0.8}
    >
      {/* Miniature */}
      {imgUri ? (
        <TagImage uri={imgUri} domainId={spot.domain_id} style={p.rowThumb} iconSize={18} />
      ) : (
        <View style={[p.rowThumb, p.rowThumbEmpty]}>
          <Ionicons name={DOMAIN_ICONS[spot.domain_id] || 'location-outline'} size={16} color={Colors.muted} />
        </View>
      )}

      {/* Contenu */}
      <View style={{ flex: 1 }}>
        <Text style={[p.rowTitle, selected && { color: BLUE }]} numberOfLines={1}>{spot.title}</Text>
        <View style={p.rowMeta}>
          {spot.isOwn && (
            <View style={p.ownChip}>
              <Text style={p.ownChipText}>Mon SpotYou</Text>
            </View>
          )}
          <View style={p.rowChip}>
            <Ionicons name="people-outline" size={9} color={Colors.muted} />
            <Text style={p.rowChipText}>{Math.max(members, 1)}</Text>
          </View>
          {duration && (
            <View style={[p.rowChip, { borderColor: ORANGE + '40', backgroundColor: ORANGE + '12' }]}>
              <Ionicons name="hourglass-outline" size={9} color={ORANGE} />
              <Text style={[p.rowChipText, { color: ORANGE }]}>{duration}</Text>
            </View>
          )}
          {spot.distKm != null && (
            <View style={[p.rowChip, { borderColor: BLUE + '30', backgroundColor: BLUE + '10' }]}>
              <Ionicons name="navigate-outline" size={9} color={BLUE} />
              <Text style={[p.rowChipText, { color: BLUE }]}>{formatDist(spot.distKm)}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Checkbox */}
      <View style={[p.check, selected && p.checkActive]}>
        {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
      </View>
    </TouchableOpacity>
  );
}

// ── Chip de sélection (dans le step) ──────────────────────────────────────
function SelectedChip({ spot, onRemove }: { spot: any; onRemove: () => void }) {
  return (
    <View style={p.chip}>
      <Text style={p.chipText} numberOfLines={1}>{spot.title}</Text>
      <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}>
        <Ionicons name="close-circle" size={15} color={Colors.muted} />
      </TouchableOpacity>
    </View>
  );
}

export function Step5Pricing() {
  const { form, set } = useProductForm();
  const [spots, setSpots]           = useState<any[]>([]);
  const [loading, setLoading]       = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch]         = useState('');

  const activeModes    = form.pricing_modes ?? ['day'];
  const sessionEnabled = activeModes.includes('session');
  const sessionOnly    = sessionEnabled && activeModes.length === 1;
  const productLat     = form.selectedLat;
  const productLng     = form.selectedLng;
  const hasLocation    = !!(productLat && productLng);
  const tagIdsKey      = (form.tag_ids ?? []).join(',');

  useEffect(() => {
    if (!sessionEnabled) { setSpots([]); return; }
    setLoading(true);

    const p1 = api.get('/tag-points/mine')
      .then((d: any) => Array.isArray(d) ? d : (d.points ?? []))
      .catch(() => [] as any[]);

    let p2: Promise<any[]> = Promise.resolve([]);
    if (hasLocation) {
      const tagParam = form.tag_ids.length > 0 ? `&tag_ids=${encodeURIComponent(tagIdsKey)}` : '';
      p2 = api.get(`/tag-points?lat=${productLat}&lng=${productLng}&radius=${MAX_KM * 1000}${tagParam}`)
        .then((d: any) => Array.isArray(d) ? d : (d.points ?? []))
        .catch(() => [] as any[]);
    }

    Promise.all([p1, p2]).then(([mine, others]) => {
      const mySpots = (mine as any[])
        .map(s => ({
          ...s,
          distKm: hasLocation ? haversineKm(productLat, productLng, s.latitude ?? 0, s.longitude ?? 0) : null,
          isOwn: true,
        }))
        .filter(s => !hasLocation || (s.distKm ?? 0) <= MAX_KM)
        .sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0));

      const otherSpots = (others as any[])
        .map(s => ({
          ...s,
          distKm: s.distance != null
            ? s.distance / 1000
            : (hasLocation ? haversineKm(productLat, productLng, s.latitude ?? 0, s.longitude ?? 0) : null),
          isOwn: false,
        }))
        .sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0));

      setSpots([...mySpots, ...otherSpots]);
    }).finally(() => setLoading(false));
  }, [sessionEnabled, tagIdsKey, productLat, productLng]);

  const toggleMode = (mode: PricingMode) => {
    if (activeModes.includes(mode)) {
      if (activeModes.length === 1) return;
      set({ pricing_modes: activeModes.filter(m => m !== mode), ...(mode === 'session' ? { related_spotyou_ids: [] } : {}) });
    } else {
      set({ pricing_modes: [...activeModes, mode] });
    }
  };

  const getPriceField = (mode: PricingMode): string => {
    if (mode === 'hour')    return form.price_per_hour    || '';
    if (mode === 'day')     return form.price_per_day     || '';
    if (mode === 'week')    return form.price_per_week    || '';
    if (mode === 'month')   return form.price_per_month   || '';
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

  const toggleSpot = useCallback((id: string) => {
    const cur = form.related_spotyou_ids ?? [];
    set({ related_spotyou_ids: cur.includes(id) ? cur.filter(i => i !== id) : [...cur, id] });
  }, [form.related_spotyou_ids, set]);

  const selectedIds   = form.related_spotyou_ids ?? [];
  const selectedSpots = spots.filter(s => selectedIds.includes(s.point_id));
  const filteredSpots = search.trim()
    ? spots.filter(s => s.title.toLowerCase().includes(search.toLowerCase()))
    : spots;

  const activeGridModes = GRID_MODES.filter(m => activeModes.includes(m.key));
  const allPriceModes   = [...activeGridModes, ...(sessionEnabled ? [SESSION_MODE] : [])];

  return (
    <View style={p.wrap}>

      {/* ── Modes de tarification ───────────────────────────────────────── */}
      <View style={p.section}>
        <Text style={p.sectionTitle}>MODES DE TARIFICATION <Text style={p.req}>*</Text></Text>
        <Text style={p.sectionHint}>Active les modes que tu proposes — au moins un obligatoire</Text>

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
                {active && <View style={p.modeCheck}><Ionicons name="checkmark" size={10} color="#fff" /></View>}
                <Text style={[p.modeName, active && p.modeNameActive]}>{m.label}</Text>
                <Text style={[p.modeUnit, active && p.modeUnitActive]}>{m.unit}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

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
              {active && <View style={p.modeCheck}><Ionicons name="checkmark" size={10} color="#fff" /></View>}
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

      {/* ── Section SpotYou ─────────────────────────────────────────────── */}
      {sessionEnabled && (
        <View style={p.section}>
          {sessionOnly && (
            <View style={p.warnRow}>
              <Ionicons name="warning-outline" size={14} color={ORANGE} />
              <Text style={p.warnText}>Sans autre mode, la location sera bloquée si aucun créneau n'est disponible.</Text>
            </View>
          )}

          <View style={p.spotHeader}>
            <Text style={p.sectionTitle}>RATTACHER UN SPOTYOU</Text>
            <View style={p.reqBadge}><Text style={p.reqBadgeText}>Obligatoire</Text></View>
          </View>
          <Text style={p.sectionHint}>Les membres du SpotYou pourront louer sur ses créneaux</Text>

          {/* Bannière */}
          {!loading && spots.length > 0 && (
            <View style={p.foundBanner}>
              <Ionicons name="location" size={14} color={BLUE} />
              <Text style={p.foundBannerText}>
                {spots.length} SpotYou trouvé{spots.length > 1 ? 's' : ''} à moins de {MAX_KM} km
              </Text>
            </View>
          )}

          {/* Bouton ouvrir modal */}
          <TouchableOpacity
            style={[p.pickerBtn, selectedIds.length > 0 && p.pickerBtnActive]}
            onPress={() => setPickerOpen(true)}
            testID="open-spot-picker"
            disabled={loading}
            activeOpacity={0.8}
          >
            <Ionicons
              name={loading ? 'hourglass-outline' : 'add-circle-outline'}
              size={18}
              color={loading ? Colors.muted : (selectedIds.length > 0 ? BLUE : Colors.foreground)}
            />
            <Text style={[p.pickerBtnText, selectedIds.length > 0 && { color: BLUE }]}>
              {loading
                ? 'Chargement…'
                : selectedIds.length === 0
                  ? 'Choisir des SpotYou'
                  : `${selectedIds.length} SpotYou sélectionné${selectedIds.length > 1 ? 's' : ''}`}
            </Text>
            {spots.length > 0 && !loading && (
              <View style={p.countBadge}><Text style={p.countBadgeText}>{spots.length}</Text></View>
            )}
            <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
          </TouchableOpacity>

          {/* Chips sélectionnés */}
          {selectedSpots.length > 0 && (
            <View style={p.chipRow}>
              {selectedSpots.map(s => (
                <SelectedChip key={s.point_id} spot={s} onRemove={() => toggleSpot(s.point_id)} />
              ))}
            </View>
          )}

          {/* État vide */}
          {!loading && spots.length === 0 && (
            <View style={p.emptySpots}>
              <Ionicons name="map-outline" size={22} color={Colors.muted} />
              <Text style={p.emptyText}>Aucun SpotYou à proximité</Text>
              <Text style={p.emptyHint}>
                {hasLocation
                  ? `Aucun SpotYou avec ces tags dans un rayon de ${MAX_KM} km.`
                  : 'Renseignez la localisation (étape précédente) pour voir les SpotYou proches.'}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* ══ Modal sélecteur SpotYou ══════════════════════════════════════ */}
      <Modal
        visible={pickerOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPickerOpen(false)}
      >
        <SafeAreaView style={p.modal}>
          {/* Header */}
          <View style={p.modalHeader}>
            <View>
              <Text style={p.modalTitle}>Choisir des SpotYou</Text>
              <Text style={p.modalSub}>
                {spots.length} disponible{spots.length > 1 ? 's' : ''} · rayon {MAX_KM} km
              </Text>
            </View>
            <TouchableOpacity onPress={() => setPickerOpen(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Ionicons name="close" size={22} color={Colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Barre de recherche */}
          <View style={p.searchBar}>
            <Ionicons name="search-outline" size={16} color={Colors.muted} />
            <TextInput
              style={p.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Rechercher un SpotYou…"
              placeholderTextColor={Colors.muted}
              clearButtonMode="while-editing"
              testID="spot-search-input"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={16} color={Colors.muted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Liste virtualisée */}
          <FlatList
            data={filteredSpots}
            keyExtractor={item => item.point_id}
            renderItem={({ item }) => (
              <SpotRow
                spot={item}
                selected={selectedIds.includes(item.point_id)}
                onPress={() => toggleSpot(item.point_id)}
              />
            )}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120, gap: 8, paddingTop: 8 }}
            ListEmptyComponent={
              <View style={p.emptySpots}>
                <Ionicons name="search-outline" size={22} color={Colors.muted} />
                <Text style={p.emptyText}>Aucun résultat</Text>
              </View>
            }
            initialNumToRender={15}
            maxToRenderPerBatch={20}
            windowSize={5}
            showsVerticalScrollIndicator={false}
          />

          {/* Footer confirmer */}
          <View style={p.modalFooter}>
            <TouchableOpacity
              style={[p.confirmBtn, selectedIds.length === 0 && p.confirmBtnDisabled]}
              onPress={() => setPickerOpen(false)}
              testID="confirm-spot-selection"
              activeOpacity={0.85}
            >
              <Text style={[p.confirmBtnText, selectedIds.length === 0 && { color: Colors.muted }]}>
                {selectedIds.length === 0
                  ? 'Sélectionner au moins 1'
                  : `Confirmer (${selectedIds.length} sélectionné${selectedIds.length > 1 ? 's' : ''})`}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

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
  modeGrid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modeCell:         { width: '47.5%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, gap: 2, position: 'relative' },
  modeCellActive:   { borderColor: BLUE, backgroundColor: BLUE + '14' },
  sessionCell:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, gap: 10 },
  sessionCellActive:{ borderColor: BLUE, backgroundColor: BLUE + '14' },
  modeCheck:        { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  modeName:         { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  modeNameActive:   { color: BLUE },
  modeUnit:         { fontSize: 11, color: Colors.muted, marginTop: 1 },
  modeUnitActive:   { color: BLUE + 'BB' },

  // Prix
  priceBlock:       { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  priceRow:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  priceRowBorder:   { borderBottomWidth: 1, borderBottomColor: Colors.border },
  priceLabel:       { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  priceUnit:        { fontSize: 11, color: Colors.muted, marginTop: 1 },
  inputWrap:        { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input:            { minWidth: 70, textAlign: 'right', fontSize: 18, fontWeight: '700', color: Colors.foreground, paddingVertical: 4, paddingHorizontal: 6 },
  euro:             { fontSize: 16, fontWeight: '700', color: BLUE },

  // SpotYou section header
  spotHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reqBadge:         { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#FECACA' },
  reqBadgeText:     { fontSize: 11, fontWeight: '700', color: '#EF4444' },
  warnRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#F59E0B12', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#F59E0B40' },
  warnText:         { flex: 1, fontSize: 12, color: Colors.foreground, lineHeight: 17 },
  foundBanner:      { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: BLUE + '10', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: BLUE + '30' },
  foundBannerText:  { flex: 1, fontSize: 12, color: BLUE, fontWeight: '700' },

  // Bouton ouvrir modal
  pickerBtn:        { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.border, padding: 14 },
  pickerBtnActive:  { borderColor: BLUE, backgroundColor: BLUE + '08' },
  pickerBtnText:    { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground },
  countBadge:       { backgroundColor: Colors.background, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderColor: Colors.border },
  countBadgeText:   { fontSize: 11, fontWeight: '700', color: Colors.muted },

  // Chips sélectionnés
  chipRow:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:             { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: BLUE + '12', borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: BLUE + '30', maxWidth: 200 },
  chipText:         { fontSize: 12, fontWeight: '600', color: BLUE, flex: 1 },

  // État vide
  emptySpots:       { alignItems: 'center', gap: 5, paddingVertical: 18, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  emptyText:        { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  emptyHint:        { fontSize: 11, color: Colors.muted, textAlign: 'center', paddingHorizontal: 12 },

  // Modal
  modal:            { flex: 1, backgroundColor: Colors.background },
  modalHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle:       { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  modalSub:         { fontSize: 12, color: Colors.muted, marginTop: 2 },

  // Recherche
  searchBar:        { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginVertical: 10, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 12, paddingVertical: 8 },
  searchInput:      { flex: 1, fontSize: 14, color: Colors.foreground, paddingVertical: 0 },

  // Lignes compactes (modal)
  spotRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 10 },
  spotRowActive:    { borderColor: BLUE, backgroundColor: BLUE + '08' },
  rowThumb:         { width: 44, height: 44, borderRadius: 8 },
  rowThumbEmpty:    { backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  rowTitle:         { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 3 },
  rowMeta:          { flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  rowChip:          { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.background, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: Colors.border },
  rowChipText:      { fontSize: 10, color: Colors.muted, fontWeight: '600' },
  ownChip:          { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: GREEN + '18', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: GREEN + '40' },
  ownChipText:      { fontSize: 10, color: GREEN, fontWeight: '700' },
  check:            { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkActive:      { backgroundColor: BLUE, borderColor: BLUE },

  // Footer modal
  modalFooter:      { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 20, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border },
  confirmBtn:       { backgroundColor: BLUE, borderRadius: 14, padding: 16, alignItems: 'center' },
  confirmBtnDisabled:{ backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  confirmBtnText:   { fontSize: 15, fontWeight: '700', color: '#fff' },
});
