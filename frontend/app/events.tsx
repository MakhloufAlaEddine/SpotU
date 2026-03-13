import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { useLocation } from '../context/LocationContext';
import { haversineDistance, formatDistance } from '../utils/distance';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { useGuardedRouter } from '../hooks/useGuardedRouter';

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

interface EventPoint {
  point_id: string;
  title: string;
  image_url?: string;
  images?: string[];
  latitude?: number;
  longitude?: number;
  event_date?: string;
  event_schedule?: { type: string; day: number; time: string };
  joined_at?: string;
}

function formatEventDate(d: string) {
  const date = new Date(d);
  const now = new Date();
  const diff = Math.floor((date.getTime() - now.getTime()) / 86400000);
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  if (diff === 0) return `Aujourd'hui à ${time}`;
  if (diff === 1) return `Demain à ${time}`;
  if (diff === -1) return `Hier à ${time}`;
  if (diff < 0) return `${dateStr} à ${time}`;
  if (diff < 7) {
    const dayName = date.toLocaleDateString('fr-FR', { weekday: 'long' });
    return `${dayName.charAt(0).toUpperCase() + dayName.slice(1)} à ${time}`;
  }
  return `${dateStr} à ${time}`;
}

function formatRecurring(schedule: { type: string; day: number; time: string }) {
  return `Chaque ${DAYS_FULL[schedule.day]} à ${schedule.time}`;
}

function isUpcoming(item: EventPoint) {
  if (item.event_schedule) return true; // Recurring = always upcoming
  if (item.event_date) return new Date(item.event_date) >= new Date();
  return true;
}

function EventCard({ item, onLeave }: { item: EventPoint; onLeave: () => void }) {
  const { location } = useLocation();
  const dist = item.latitude != null && item.longitude != null
    ? formatDistance(haversineDistance(location.lat, location.lng, item.latitude, item.longitude))
    : null;

  const isRecurring = !!item.event_schedule;
  const router = useGuardedRouter();

  return (
    <TouchableOpacity
      style={card.container}
      onPress={() => router.push(`/spot-you/${item.point_id}` as any)}
      activeOpacity={0.8}
      testID={`event-card-${item.point_id}`}
    >
      {/* Bande colorée gauche */}
      <View style={[card.accent, isRecurring && card.accentRecurring]} />

      <View style={card.imageWrap}>
        {item.images?.[0]
          ? <Image source={{ uri: item.images[0] }} style={card.image} resizeMode="cover" />
          : <View style={card.imageFallback}><Ionicons name="calendar-outline" size={24} color={Colors.muted} /></View>}
      </View>

      <View style={card.info}>
        <Text style={card.title} numberOfLines={1}>{item.title}</Text>
        <View style={card.dateRow}>
          <Ionicons
            name={isRecurring ? 'repeat-outline' : 'calendar-outline'}
            size={13} color={isRecurring ? Colors.primaryLight : Colors.primary}
          />
          <Text style={[card.dateText, isRecurring && { color: Colors.primaryLight }]}>
            {isRecurring
              ? formatRecurring(item.event_schedule!)
              : item.event_date ? formatEventDate(item.event_date) : 'Date non définie'}
          </Text>
        </View>
        {dist && (
          <View style={card.distRow}>
            <Ionicons name="location-outline" size={11} color={Colors.muted} />
            <Text style={card.distText}>{dist}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={card.leaveBtn}
        onPress={onLeave}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        testID={`leave-btn-${item.point_id}`}
      >
        <Ionicons name="close-circle-outline" size={22} color={Colors.muted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const card = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  accent: { width: 4, alignSelf: 'stretch', backgroundColor: Colors.primary },
  accentRecurring: { backgroundColor: Colors.primaryLight },
  imageWrap: { width: 80, height: 80, backgroundColor: Colors.border },
  image: { width: '100%', height: '100%' },
  imageFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.card },
  info: { flex: 1, padding: Spacing.sm, gap: 4 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  distText: { fontSize: 11, color: Colors.muted },
  leaveBtn: { padding: Spacing.md, alignSelf: 'center' },
});

export default function EventsScreen() {
  const router = useGuardedRouter();
  const [items, setItems] = useState<EventPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const data = await api.get('/users/me/events');
      setItems(data || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => {
    setLoading(true);
    load();
  }, []));

  const handleLeave = async (pointId: string) => {
    Alert.alert('Se retirer', 'Retirer ce SpotYou de votre planning ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Retirer', style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/tag-points/${pointId}/leave`);
            setItems(prev => prev.filter(p => p.point_id !== pointId));
          } catch {}
        }
      }
    ]);
  };

  const upcoming = items.filter(isUpcoming);
  const past = items.filter(i => !isUpcoming(i));

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Mon Planning</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={s.center} testID="events-empty-state">
          <View style={s.emptyIcon}>
            <Ionicons name="calendar-outline" size={48} color={Colors.muted} />
          </View>
          <Text style={s.emptyTitle}>Aucun événement</Text>
          <Text style={s.emptySubtitle}>
            Cliquez sur "Rejoindre" dans un SpotYou pour l'ajouter à votre planning.
          </Text>
          <TouchableOpacity style={s.exploreBtn} onPress={() => router.push('/(tabs)/search' as any)} testID="explore-btn">
            <Text style={s.exploreBtnText}>Explorer les SpotYou</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={[]}
          keyExtractor={() => ''}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          renderItem={() => null}
          ListHeaderComponent={
            <>
              {upcoming.length > 0 && (
                <>
                  <View style={s.sectionHeader}>
                    <Ionicons name="calendar" size={15} color={Colors.primary} />
                    <Text style={s.sectionTitle}>À venir · {upcoming.length}</Text>
                  </View>
                  {upcoming.map(item => (
                    <EventCard key={item.point_id} item={item} onLeave={() => handleLeave(item.point_id)} />
                  ))}
                </>
              )}
              {past.length > 0 && (
                <>
                  <View style={s.sectionHeader}>
                    <Ionicons name="time-outline" size={15} color={Colors.muted} />
                    <Text style={[s.sectionTitle, { color: Colors.muted }]}>Passés · {past.length}</Text>
                  </View>
                  {past.map(item => (
                    <EventCard key={item.point_id} item={item} onLeave={() => handleLeave(item.point_id)} />
                  ))}
                </>
              )}
            </>
          }
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  backBtn: { padding: 4, width: 40 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  list: { padding: Spacing.md, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 0.5 },
  emptyIcon: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.lg,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: Spacing.sm, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, color: Colors.muted, textAlign: 'center', lineHeight: 20, marginBottom: Spacing.xl },
  exploreBtn: { backgroundColor: Colors.primary, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.sm + 4, borderRadius: Radius.full },
  exploreBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
