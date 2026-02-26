import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

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

  useEffect(() => { loadPoints(); }, []);

  const onRefresh = useCallback(() => { setRefreshing(true); loadPoints(); }, []);

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/tag-point/${item.point_id}` as any)}
      activeOpacity={0.75}
      testID={`my-tp-${item.point_id}`}
    >
      <View style={styles.thumbWrap}>
        {item.images?.[0] ? (
          <Image source={{ uri: item.images[0] }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="location-outline" size={22} color={Colors.muted} />
          </View>
        )}
      </View>
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title || 'Sans titre'}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {item.is_public === false && (
            <View style={styles.badge}>
              <Ionicons name="eye-off-outline" size={11} color={Colors.muted} />
              <Text style={styles.badgeText}>Masqué</Text>
            </View>
          )}
          {item.event_date && (
            <View style={styles.badge}>
              <Ionicons name="calendar-outline" size={11} color={Colors.muted} />
              <Text style={styles.badgeText}>
                {new Date(item.event_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
              </Text>
            </View>
          )}
          {item.participants_count > 0 && (
            <View style={styles.badge}>
              <Ionicons name="people-outline" size={11} color={Colors.muted} />
              <Text style={styles.badgeText}>{item.participants_count}</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Mes TagPoints</Text>
        <TouchableOpacity onPress={() => router.push('/(tabs)/create' as any)} style={styles.headerBtn} testID="add-tagpoint-btn">
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
              <Text style={styles.emptyTitle}>Aucun tagPoint</Text>
              <Text style={styles.emptyText}>Vous n'avez pas encore créé de tagPoint.</Text>
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
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn: { padding: 4 },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: Spacing.md, gap: Spacing.sm,
  },
  thumbWrap: {},
  thumb: { width: 56, height: 56, borderRadius: Radius.md, backgroundColor: Colors.card },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.background, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  badgeText: { fontSize: 11, color: Colors.muted },
  empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground },
  emptyText: { fontSize: 14, color: Colors.muted, textAlign: 'center' },
  createBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 20, paddingVertical: 10, marginTop: 8,
  },
  createBtnText: { color: Colors.background, fontWeight: '700', fontSize: 14 },
});
