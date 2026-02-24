import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { MapViewComponent, MapPin } from '../../components/MapViewComponent';
import { DomainPill } from '../../components/DomainPill';
import { TagPointCard } from '../../components/TagPointCard';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

const { height } = Dimensions.get('window');
const MAP_HEIGHT = height * 0.55;

const DOMAIN_COLORS: Record<string, string> = {
  dom_sport: Colors.sport,
  dom_coaching: Colors.coaching,
  dom_service: Colors.service,
  dom_social: Colors.socialDomain,
};

export default function MapScreen() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [tagPoints, setTagPoints] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<any>(null);

  useEffect(() => {
    initMap();
  }, []);

  useEffect(() => {
    if (location) loadTagPoints();
  }, [location, selectedDomain]);

  const initMap = async () => {
    try {
      // Load domains
      const doms = await api.get('/domains');
      setDomains(doms);

      // Get location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } else {
        // Default: Paris center
        setLocation({ lat: 48.8566, lng: 2.3522 });
      }
    } catch {
      setLocation({ lat: 48.8566, lng: 2.3522 });
    }
  };

  const loadTagPoints = async () => {
    if (!location) return;
    try {
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        radius: '5000',
      });
      if (selectedDomain) params.append('domain_id', selectedDomain);
      const points = await api.get(`/tag-points?${params.toString()}`);
      setTagPoints(points);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadTagPoints();
  }, [location, selectedDomain]);

  const pins: MapPin[] = tagPoints.map((pt) => ({
    id: pt.point_id,
    lat: pt.latitude ?? pt.location?.coordinates?.[1] ?? 0,
    lng: pt.longitude ?? pt.location?.coordinates?.[0] ?? 0,
    title: pt.title,
    color: DOMAIN_COLORS[pt.domain_id] || Colors.primary,
  }));

  const handlePinPress = (id: string) => {
    const found = tagPoints.find((p) => p.point_id === id);
    if (found) setSelectedPoint(found);
  };

  return (
    <View style={styles.container} testID="map-screen">
      {/* Map */}
      <View style={[styles.mapWrap, { height: MAP_HEIGHT }]}>
        {location ? (
          <MapViewComponent
            centerLat={location.lat}
            centerLng={location.lng}
            zoom={14}
            pins={pins}
            searchRadius={5000}
            showUserMarker
            onPinPress={handlePinPress}
            style={styles.map}
          />
        ) : (
          <View style={styles.mapPlaceholder}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>{t('loadingMap')}</Text>
          </View>
        )}

        {/* Domain filter bar floating on map */}
        <View style={styles.domainBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.domainScroll}
          >
            <TouchableOpacity
              style={[styles.allPill, !selectedDomain && styles.allPillActive]}
              onPress={() => setSelectedDomain(null)}
              testID="domain-all"
            >
              <Ionicons 
                name="globe-outline" 
                size={16} 
                color={!selectedDomain ? Colors.foreground : Colors.muted} 
              />
              <Text style={[styles.allPillText, !selectedDomain && styles.allPillTextActive]}>
                Tout
              </Text>
            </TouchableOpacity>
            {domains.map((d) => (
              <DomainPill
                key={d.domain_id}
                domain={d}
                selected={selectedDomain === d.domain_id}
                onPress={() => setSelectedDomain(selectedDomain === d.domain_id ? null : d.domain_id)}
                lang={lang}
              />
            ))}
          </ScrollView>
        </View>
      </View>

      {/* Selected pin card */}
      {selectedPoint && (
        <TouchableOpacity
          style={styles.selectedCard}
          onPress={() => router.push(`/tag-point/${selectedPoint.point_id}`)}
          activeOpacity={0.9}
          testID={`selected-point-card`}
        >
          <View style={styles.selectedCardContent}>
            <View
              style={[
                styles.selectedDot,
                { backgroundColor: DOMAIN_COLORS[selectedPoint.domain_id] || Colors.primary }
              ]}
            />
            <View style={styles.selectedInfo}>
              <Text style={styles.selectedTitle} numberOfLines={1}>{selectedPoint.title}</Text>
              {selectedPoint.description && (
                <Text style={styles.selectedDesc} numberOfLines={1}>{selectedPoint.description}</Text>
              )}
            </View>
            <TouchableOpacity
              onPress={() => setSelectedPoint(null)}
              style={styles.closeBtn}
              testID="close-selected-card"
            >
              <Ionicons name="close" size={20} color={Colors.muted} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}

      {/* TagPoints list */}
      <SafeAreaView style={styles.listArea} edges={['bottom']}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>
            {t('nearYou')} · {tagPoints.length} {t('results')}
          </Text>
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
            }
          >
            {tagPoints.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="location-outline" size={48} color={Colors.muted} />
                <Text style={styles.emptyText}>{t('noPoints')}</Text>
              </View>
            ) : (
              tagPoints.map((pt) => (
                <TagPointCard key={pt.point_id} point={pt} lang={lang} />
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  mapWrap: { position: 'relative', overflow: 'hidden' },
  map: { flex: 1 },
  mapPlaceholder: { 
    flex: 1, 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: Colors.card, 
    gap: 12 
  },
  loadingText: { color: Colors.muted, fontSize: 14 },
  domainBar: {
    position: 'absolute',
    top: 12,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.md,
  },
  domainScroll: { paddingHorizontal: 0, gap: 8 },
  allPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    marginRight: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  allPillActive: { backgroundColor: Colors.header },
  allPillText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  allPillTextActive: { color: Colors.foreground },
  selectedCard: {
    marginHorizontal: Spacing.md,
    marginTop: -20,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    zIndex: 10,
  },
  selectedCardContent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectedDot: { width: 12, height: 12, borderRadius: 6 },
  selectedInfo: { flex: 1 },
  selectedTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  selectedDesc: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  closeBtn: { padding: 6 },
  listArea: { flex: 1 },
  listHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingHorizontal: Spacing.md, 
    paddingTop: Spacing.sm, 
    paddingBottom: 4 
  },
  listTitle: { fontSize: 13, fontWeight: '700', color: Colors.muted },
  list: { paddingHorizontal: Spacing.md, paddingBottom: 20 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  empty: { alignItems: 'center', padding: Spacing.xl, gap: 12 },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
});
