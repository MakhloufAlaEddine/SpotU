/**
 * Step 6 — Lien avec SpotYou
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../../../constants/Colors';
import { useProductForm } from '../ProductFormContext';
import { api } from '../../../lib/api';
import { TagImage } from '../../TagImage';

const VIOLET = '#8B5CF6';

export function Step6SpotYouLink() {
  const { form, set } = useProductForm();
  const [spots, setSpots]     = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/tag-points/mine')
      .then((d: any) => setSpots(d.points || []))
      .catch(() => setSpots([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    const ids = form.related_spotyou_ids;
    if (ids.includes(id)) {
      set({ related_spotyou_ids: ids.filter(i => i !== id) });
    } else {
      set({ related_spotyou_ids: [...ids, id] });
    }
  };

  return (
    <View style={sv.wrap}>
      {/* Explication */}
      <View style={sv.infoCard}>
        <Ionicons name="pin-outline" size={18} color={VIOLET} />
        <Text style={sv.infoText}>
          Lier ton produit à un SpotYou permet aux bonnes personnes de le trouver directement dans la boutique du SpotYou.
        </Text>
      </View>

      <Text style={sv.label}>Tes SpotYou{spots.length > 0 ? ` (${spots.length})` : ''}</Text>

      {loading && <ActivityIndicator color={VIOLET} />}

      {!loading && spots.length === 0 && (
        <View style={sv.emptyCard}>
          <Ionicons name="map-outline" size={32} color={Colors.muted} />
          <Text style={sv.emptyText}>Tu n'as pas encore créé de SpotYou.</Text>
          <Text style={sv.emptyHint}>Tu peux passer cette étape — ton produit sera visible dans le marketplace global.</Text>
        </View>
      )}

      {spots.map(s => {
        const selected = form.related_spotyou_ids.includes(s.point_id);
        return (
          <TouchableOpacity
            key={s.point_id}
            style={[sv.spotRow, selected && sv.spotRowActive]}
            onPress={() => toggle(s.point_id)}
            testID={`spot-${s.point_id}`}
          >
            <TagImage uri={s.image_url} tagIds={s.tag_ids || []} style={sv.spotImg} />
            <View style={{ flex: 1 }}>
              <Text style={[sv.spotTitle, selected && { color: VIOLET }]} numberOfLines={1}>{s.title}</Text>
              <Text style={sv.spotSub} numberOfLines={1}>{s.address || s.city || ''}</Text>
            </View>
            <View style={[sv.checkbox, selected && sv.checkboxActive]}>
              {selected && <Ionicons name="checkmark" size={14} color="#fff" />}
            </View>
          </TouchableOpacity>
        );
      })}

      {/* Skip option */}
      <View style={sv.skipCard}>
        <Text style={sv.skipText}>Tu peux sauter cette étape si ton produit n'est pas lié à un SpotYou particulier.</Text>
      </View>
    </View>
  );
}

const sv = StyleSheet.create({
  wrap:         { gap: Spacing.lg },
  infoCard:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: VIOLET + '0D', borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: VIOLET + '30' },
  infoText:     { flex: 1, fontSize: 13, color: Colors.foreground, lineHeight: 19 },
  label:        { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  emptyCard:    { alignItems: 'center', gap: 8, padding: Spacing.xl, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  emptyText:    { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  emptyHint:    { fontSize: 12, color: Colors.muted, textAlign: 'center', lineHeight: 17 },
  spotRow:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  spotRowActive:{ borderColor: VIOLET, backgroundColor: VIOLET + '08' },
  spotImg:      { width: 48, height: 48, borderRadius: 10 },
  spotTitle:    { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  spotSub:      { fontSize: 12, color: Colors.muted, marginTop: 2 },
  checkbox:     { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive:{ backgroundColor: VIOLET, borderColor: VIOLET },
  skipCard:     { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  skipText:     { fontSize: 12, color: Colors.muted, lineHeight: 17 },
});
