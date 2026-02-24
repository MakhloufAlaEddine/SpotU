import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { TagPointCard } from '../../components/TagPointCard';
import { CoachCard } from '../../components/CoachCard';
import { DomainPill } from '../../components/DomainPill';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

type Tab = 'tagpoints' | 'coaches';

export default function SearchScreen() {
  const { t, lang } = useLang();
  const [activeTab, setActiveTab] = useState<Tab>('tagpoints');
  const [query, setQuery] = useState('');
  const [radius, setRadius] = useState(5);
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [tagPoints, setTagPoints] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [userLat, setUserLat] = useState(48.8566);
  const [userLng, setUserLng] = useState(2.3522);

  useEffect(() => {
    loadDomains();
    getLocation();
  }, []);

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLat(loc.coords.latitude);
        setUserLng(loc.coords.longitude);
      }
    } catch {}
  };

  const loadDomains = async () => {
    try {
      const data = await api.get('/domains');
      setDomains(data);
    } catch {}
  };

  const handleSearch = async () => {
    setLoading(true);
    try {
      const radiusM = radius * 1000;
      const params = `lat=${userLat}&lng=${userLng}&radius=${radiusM}${selectedDomain ? `&domain_id=${selectedDomain}` : ''}`;
      const [pts, svcs] = await Promise.all([
        api.get(`/tag-points?${params}`),
        api.get(`/services?${params}`),
      ]);
      const filteredPts = query ? pts.filter((p: any) => p.title?.toLowerCase().includes(query.toLowerCase()) || p.description?.toLowerCase().includes(query.toLowerCase())) : pts;
      const filteredSvcs = query ? svcs.filter((s: any) => s.title?.toLowerCase().includes(query.toLowerCase()) || s.description?.toLowerCase().includes(query.toLowerCase())) : svcs;
      setTagPoints(filteredPts);
      setServices(filteredSvcs);
    } catch {} finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    handleSearch();
  }, [userLat, userLng, selectedDomain, radius]);

  const RADII = [1, 5, 10, 20, 50];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} stickyHeaderIndices={[0]}>
        {/* Sticky search header */}
        <View style={styles.searchHeader}>
          <View style={styles.searchBar}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              testID="search-input"
              style={styles.searchInput}
              placeholder={t('searchPlaceholder')}
              placeholderTextColor={Colors.muted}
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
          </View>
          {/* Radius */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.radiusScroll}>
            {RADII.map((r) => (
              <TouchableOpacity
                key={r}
                testID={`radius-${r}km-btn`}
                style={[styles.radiusPill, radius === r && styles.radiusPillActive]}
                onPress={() => setRadius(r)}
              >
                <Text style={[styles.radiusText, radius === r && styles.radiusTextActive]}>{r}km</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {/* Domain filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.domainsScroll} contentContainerStyle={{ paddingRight: 16 }}>
            <TouchableOpacity
              style={[styles.allPill, !selectedDomain && styles.allPillActive]}
              onPress={() => setSelectedDomain(null)}
            >
              <Text style={[styles.allText, !selectedDomain && styles.allTextActive]}>Tout</Text>
            </TouchableOpacity>
            {domains.map((d) => (
              <DomainPill key={d.domain_id} domain={d} selected={selectedDomain === d.domain_id} onPress={() => setSelectedDomain(d.domain_id === selectedDomain ? null : d.domain_id)} lang={lang} />
            ))}
          </ScrollView>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity testID="tab-tagpoints" style={[styles.tab, activeTab === 'tagpoints' && styles.tabActive]} onPress={() => setActiveTab('tagpoints')}>
            <Text style={[styles.tabText, activeTab === 'tagpoints' && styles.tabTextActive]}>📍 {t('tagPoints')} ({tagPoints.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="tab-coaches" style={[styles.tab, activeTab === 'coaches' && styles.tabActive]} onPress={() => setActiveTab('coaches')}>
            <Text style={[styles.tabText, activeTab === 'coaches' && styles.tabTextActive]}>🎯 {t('coaches')} ({services.length})</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : (
          <View style={styles.results}>
            {activeTab === 'tagpoints' && (
              tagPoints.length === 0
                ? <View style={styles.empty}><Text style={styles.emptyText}>{t('noResults')}</Text></View>
                : tagPoints.map((pt) => <TagPointCard key={pt.point_id} point={pt} lang={lang} />)
            )}
            {activeTab === 'coaches' && (
              services.length === 0
                ? <View style={styles.empty}><Text style={styles.emptyText}>{t('noResults')}</Text></View>
                : services.map((svc) => <CoachCard key={svc.service_id} service={svc} lang={lang} />)
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  searchHeader: { backgroundColor: Colors.background, paddingTop: Spacing.sm, paddingBottom: Spacing.sm, borderBottomWidth: 1, borderBottomColor: Colors.border },
  searchBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.lg, backgroundColor: Colors.secondary, borderRadius: Radius.full, paddingHorizontal: Spacing.md, marginBottom: Spacing.sm },
  searchIcon: { fontSize: 16, marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: Spacing.sm + 2, fontSize: 15, color: Colors.foreground },
  radiusScroll: { paddingLeft: Spacing.lg, marginBottom: Spacing.sm },
  radiusPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, marginRight: 8 },
  radiusPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  radiusText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  radiusTextActive: { color: '#fff' },
  domainsScroll: { paddingLeft: Spacing.lg },
  allPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, marginRight: 8 },
  allPillActive: { backgroundColor: Colors.foreground, borderColor: Colors.foreground },
  allText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  allTextActive: { color: '#fff' },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: Spacing.sm + 2, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },
  results: { padding: Spacing.md },
  empty: { alignItems: 'center', paddingTop: Spacing.xl },
  emptyText: { fontSize: 15, color: Colors.muted },
});
