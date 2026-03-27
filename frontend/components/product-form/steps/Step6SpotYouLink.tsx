/**
 * Step 6 — Lien avec SpotYou
 * Règles métier :
 * - Si pricing_modes inclut 'session' → sélectionner au moins 1 SpotYou (obligatoire)
 * - Si pricing_modes inclut 'session' uniquement → afficher avertissement d'ajouter d'autres tarifs
 * - Visibilité : un produit apparaît dans la boutique des SpotYou sélectionnés ET dans la recherche par tags
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagImage } from '../../TagImage';

const BLUE = '#3B82F6';
const ORANGE = '#F59E0B';

export function Step6SpotYouLink() {
  const { form, set } = useProductForm();
  const [spots, setSpots]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const activeModes    = form.pricing_modes ?? [];
  const isSessionOnly  = activeModes.includes('session') && activeModes.length === 1;
  const hasSession     = activeModes.includes('session');
  const selected_ids   = form.related_spotyou_ids ?? [];

  useEffect(() => {
    api.get('/tag-points/mine')
      .then((d: any) => setSpots(d.points || []))
      .catch(() => setSpots([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    if (selected_ids.includes(id)) {
      set({ related_spotyou_ids: selected_ids.filter(i => i !== id) });
    } else {
      set({ related_spotyou_ids: [...selected_ids, id] });
    }
  };

  return (
    <View style={sv.wrap}>

      {/* ── Avertissement mode séance uniquement ─────────────────────── */}
      {isSessionOnly && (
        <View style={sv.warnCard}>
          <Ionicons name="warning-outline" size={18} color={ORANGE} />
          <Text style={sv.warnText}>
            Tu proposes uniquement la tarification par séance. Si aucun créneau n'est disponible sur le SpotYou, la location sera bloquée.{'\n'}
            <Text style={{ fontWeight: '700' }}>Conseillé :</Text> ajoute aussi une tarification par heure ou par jour (étape 2).
          </Text>
        </View>
      )}

      {/* ── Explication de la visibilité ────────────────────────────── */}
      <View style={sv.infoCard}>
        <Ionicons name="information-circle-outline" size={18} color={BLUE} />
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={sv.infoTitle}>Comment fonctionne la visibilité ?</Text>
          <Text style={sv.infoText}>
            Ton produit apparaît automatiquement dans les résultats de recherche des utilisateurs dont les tags correspondent aux tiens.{'\n\n'}
            En le rattachant à un SpotYou, il sera aussi visible directement dans la boutique de ce SpotYou.
          </Text>
          {hasSession && (
            <Text style={[sv.infoText, { color: BLUE, fontWeight: '600', marginTop: 4 }]}>
              Mode séance : au moment de la réservation, l'utilisateur choisira un créneau parmi ceux du SpotYou sélectionné.
            </Text>
          )}
        </View>
      </View>

      {/* ── Obligatoire si séance ────────────────────────────────────── */}
      {hasSession && (
        <View style={sv.requiredBadge}>
          <Ionicons name="alert-circle-outline" size={14} color="#EF4444" />
          <Text style={sv.requiredText}>Obligatoire avec la tarification par séance</Text>
        </View>
      )}

      {/* ── Titre section ────────────────────────────────────────────── */}
      <Text style={sv.label}>
        {spots.length > 0 ? `Tes SpotYou (${spots.length})` : 'Tes SpotYou'}
      </Text>

      {loading && <ActivityIndicator color={BLUE} style={{ marginVertical: 20 }} />}

      {/* ── Pas de SpotYou ───────────────────────────────────────────── */}
      {!loading && spots.length === 0 && (
        <View style={sv.emptyCard}>
          <Ionicons name="map-outline" size={32} color={Colors.muted} />
          <Text style={sv.emptyText}>Tu n'as pas encore créé de SpotYou.</Text>
          {hasSession ? (
            <Text style={[sv.emptyHint, { color: '#EF4444' }]}>
              La tarification par séance nécessite un SpotYou. Crée-en un d'abord, ou retire le mode séance (étape 2).
            </Text>
          ) : (
            <Text style={sv.emptyHint}>
              Cette étape est optionnelle. Ton produit sera trouvable via la recherche par tags.
            </Text>
          )}
        </View>
      )}

      {/* ── Liste des SpotYou ─────────────────────────────────────────── */}
      {spots.map(s => {
        const sel = selected_ids.includes(s.point_id);
        return (
          <TouchableOpacity
            key={s.point_id}
            style={[sv.spotRow, sel && sv.spotRowActive]}
            onPress={() => toggle(s.point_id)}
            testID={`spot-${s.point_id}`}
            activeOpacity={0.75}
          >
            <TagImage uri={s.image_url} tagIds={s.tag_ids || []} style={sv.spotImg} />
            <View style={{ flex: 1 }}>
              <Text style={[sv.spotTitle, sel && { color: BLUE }]} numberOfLines={1}>{s.title}</Text>
              <Text style={sv.spotSub} numberOfLines={1}>{s.address || s.city || ''}</Text>
              {/* Afficher le nombre de créneaux à terme */}
            </View>
            <View style={[sv.checkbox, sel && sv.checkboxActive]}>
              {sel && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          </TouchableOpacity>
        );
      })}

      {/* ── Info skip (seulement si pas mode séance) ─────────────────── */}
      {!hasSession && spots.length > 0 && (
        <View style={sv.skipCard}>
          <Ionicons name="information-circle-outline" size={14} color={Colors.muted} />
          <Text style={sv.skipText}>
            Cette étape est optionnelle. Sans SpotYou lié, ton produit sera trouvable uniquement via la recherche par tags.
          </Text>
        </View>
      )}
    </View>
  );
}

const sv = StyleSheet.create({
  wrap:           { gap: Spacing.md },
  warnCard:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: ORANGE + '12', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: ORANGE + '40' },
  warnText:       { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  infoCard:       { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: BLUE + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: BLUE + '25' },
  infoTitle:      { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 2 },
  infoText:       { fontSize: 12, color: Colors.muted, lineHeight: 18 },
  requiredBadge:  { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEE2E2', borderRadius: Radius.sm, paddingHorizontal: 10, paddingVertical: 6, alignSelf: 'flex-start', borderWidth: 1, borderColor: '#FECACA' },
  requiredText:   { fontSize: 12, fontWeight: '700', color: '#EF4444' },
  label:          { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyCard:      { alignItems: 'center', gap: 8, paddingVertical: 32, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed' },
  emptyText:      { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  emptyHint:      { fontSize: 12, color: Colors.muted, textAlign: 'center', paddingHorizontal: 24, lineHeight: 17 },
  spotRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 12, borderWidth: 1, borderColor: Colors.border },
  spotRowActive:  { borderColor: BLUE, backgroundColor: BLUE + '08' },
  spotImg:        { width: 50, height: 50, borderRadius: Radius.sm },
  spotTitle:      { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  spotSub:        { fontSize: 12, color: Colors.muted, marginTop: 2 },
  checkbox:       { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  checkboxActive: { backgroundColor: BLUE, borderColor: BLUE },
  skipCard:       { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  skipText:       { flex: 1, fontSize: 12, color: Colors.muted, lineHeight: 17 },
});
