import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

function formatDistance(d: number | null): string {
  if (d == null) return '---';
  if (d < 1000) return `${Math.round(d)} m`;
  return `${(d / 1000).toFixed(1)} km`;
}

function Stars({ rating }: { rating: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons key={i} name={i <= Math.round(rating) ? 'star' : 'star-outline'} size={12} color="#F59E0B" />
      ))}
    </View>
  );
}

export default function MyTagPointsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [points, setPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPoints = async () => {
    try {
      const data = await api.get('/tag-points/mine');
      setPoints(data || []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { loadPoints(); }, []));

  const onRefresh = useCallback(() => { setRefreshing(true); loadPoints(); }, []);

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/tag-point/${item.point_id}` as any)}
      activeOpacity={0.75}
      testID={`my-tp-${item.point_id}`}
    >
      <View style={styles.cardLeft}>
        {item.images?.[0] || item.image_url ? (
          <View style={[styles.thumb, { backgroundColor: Colors.card }]}>
            {/* Image from React Native */}
            <Text style={styles.thumbPlaceholder}>{item.title?.[0]?.toUpperCase()}</Text>
          </View>
        ) : (
          <View style={[styles.thumb, { backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="image-outline" size={22} color={Colors.muted} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title || 'Sans titre'}</Text>
        <Stars rating={item.rating || 0} />
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
          {item.is_public === false && (
            <View style={styles.badge}>
              <Ionicons name="eye-off-outline" size={11} color={Colors.muted} />
              <Text style={styles.badgeText}>Masqué</Text>
            </View>
          )}
          {item.event_date && (
            <View style={styles.badge}>
              <Ionicons name="calendar-outline" size={11} color={Colors.muted} />
              <Text style={styles.badgeText}>{new Date(item.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mes TagPoints</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/create' as any)} style={styles.headerAdd} testID="add-tagpoint-btn">
          <Ionicons name="add" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
      ) : (
        <FlatList
          data={points}
          keyExtractor={item => item.point_id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: Spacing.md, gap: 10, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="location-outline" size={48} color={Colors.muted} />
              <Text style={styles.emptyText}>Vous n'avez pas encore créé de tagPoint</Text>
              <TouchableOpacity style={styles.createBtn} onPress={() => router.push('/(tabs)/create' as any)}>
                <Text style={styles.createBtnText}>Créer mon premier TagPoint</Text>
              </TouchableOpacity>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerBack: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerAdd: { padding: 4 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.sm },
  cardLeft: {},
  thumb: { width: 56, height: 56, borderRadius: Radius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbPlaceholder: { fontSize: 22, fontWeight: '700', color: Colors.muted },
  cardBody: { flex: 1, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.background, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { fontSize: 11, color: Colors.muted },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
  createBtn: { backgroundColor: Colors.primary, borderRadius: Radius.full, paddingHorizontal: 20, paddingVertical: 10, marginTop: 8 },
  createBtnText: { color: Colors.background, fontWeight: '700', fontSize: 14 },
});
