import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { MapViewComponent, MapPin } from '../../components/MapViewComponent';
import { DomainPill } from '../../components/DomainPill';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

const DOMAIN_COLORS: Record<string, string> = {
  dom_sport: Colors.sport,
  dom_coaching: Colors.coaching,
  dom_service: Colors.service,
  dom_social: Colors.social,
};

export default function MapScreen() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [tagPoints, setTagPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [userLat, setUserLat] = useState(48.8566);
  const [userLng, setUserLng] = useState(2.3522);
  const [hasLocation, setHasLocation] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDomains();
    requestLocation();
  }, []);

  useEffect(() => {
    loadMapData();
  }, [userLat, userLng, selectedDomain]);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
        setHasLocation(true);
      }
    } catch {}
  };

  const loadDomains = async () => {
    try {
      const data = await api.get('/domains');
      setDomains(data);
    } catch {}
  };

  const loadMapData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        lat: userLat.toString(), lng: userLng.toString(), radius: '10000',
        ...(selectedDomain ? { domain_id: selectedDomain } : {}),
      });
      const [pts, svcs] = await Promise.all([
        api.get(`/tag-points?${params}`),
        api.get(`/services?lat=${userLat}&lng=${userLng}&radius=10000${selectedDomain === 'dom_coaching' ? '' : ''}`),
      ]);
      setTagPoints(pts);
      setServices(svcs);
    } catch {} finally {
      setLoading(false);
    }
  }, [userLat, userLng, selectedDomain]);

  const pins: MapPin[] = [
    ...tagPoints.map((pt) => ({
      id: pt.point_id,
      lat: pt.location?.coordinates?.[1] ?? 0,
      lng: pt.location?.coordinates?.[0] ?? 0,
      title: pt.title,
      color: DOMAIN_COLORS[pt.domain_id] || Colors.primary,
      type: 'tagpoint',
    })),
    ...services.map((svc) => ({
      id: `svc_${svc.service_id}`,
      lat: svc.location?.coordinates?.[1] ?? 0,
      lng: svc.location?.coordinates?.[0] ?? 0,
      title: svc.title,
      color: Colors.coaching,
      type: 'service',
    })),
  ].filter((p) => p.lat && p.lng);

  const handlePinPress = (id: string) => {
    if (id.startsWith('svc_')) {
      const serviceId = id.replace('svc_', '');
      const svc = services.find((s) => s.service_id === serviceId);
      if (svc?.coach?.user_id) router.push(`/coach/${svc.coach.user_id}?service_id=${serviceId}`);
    } else {
      router.push(`/tag-point/${id}`);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>WINEK</Text>
        <TouchableOpacity testID="refresh-map-btn" onPress={loadMapData} style={styles.refreshBtn}>
          <Text style={styles.refreshIcon}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* Domain filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.domainsScroll} contentContainerStyle={styles.domainsContent}>
        <TouchableOpacity
          testID="domain-all-btn"
          style={[styles.allPill, !selectedDomain && styles.allPillActive]}
          onPress={() => setSelectedDomain(null)}
        >
          <Text style={[styles.allText, !selectedDomain && styles.allTextActive]}>🌍 Tout</Text>
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

      {/* Map */}
      <View style={styles.mapContainer} testID="map-container">
        <MapViewComponent
          pins={pins}
          centerLat={userLat}
          centerLng={userLng}
          zoom={13}
          showUserMarker={hasLocation}
          onPinPress={handlePinPress}
          style={styles.map}
        />
        {/* Stats overlay */}
        <View style={styles.statsOverlay}>
          <Text style={styles.statsText}>📍 {tagPoints.length} points · 🎯 {services.length} coachs</Text>
        </View>
        {/* Create FAB */}
        <TouchableOpacity
          testID="create-fab"
          style={styles.fab}
          onPress={() => router.push('/(tabs)/create')}
          activeOpacity={0.85}
        >
          <Text style={styles.fabText}>＋</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  logo: { fontSize: 20, fontWeight: '900', color: Colors.foreground, letterSpacing: 3 },
  refreshBtn: { width: 36, height: 36, borderRadius: Radius.full, backgroundColor: Colors.secondary, alignItems: 'center', justifyContent: 'center' },
  refreshIcon: { fontSize: 18, color: Colors.foreground },
  domainsScroll: { maxHeight: 48 },
  domainsContent: { paddingHorizontal: Spacing.lg, paddingBottom: 4 },
  allPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, marginRight: Spacing.sm },
  allPillActive: { backgroundColor: Colors.foreground, borderColor: Colors.foreground },
  allText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  allTextActive: { color: '#fff' },
  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },
  statsOverlay: {
    position: 'absolute', top: 12, left: 16, right: 16,
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: Radius.full,
    paddingHorizontal: 14, paddingVertical: 7,
    alignItems: 'center', ...Shadow.soft,
  },
  statsText: { fontSize: 12, color: Colors.foreground, fontWeight: '600' },
  fab: {
    position: 'absolute', bottom: 24, right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    ...Shadow.floating,
  },
  fabText: { fontSize: 28, color: '#fff', marginTop: -2 },
});
