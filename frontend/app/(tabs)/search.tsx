import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, ScrollView,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { TagPointCard } from '../../components/TagPointCard';
import { CoachCard } from '../../components/CoachCard';
import { DomainPill } from '../../components/DomainPill';
import { api } from '../../lib/api';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const RADII = [1000, 5000, 10000, 25000, 50000];
const RADIUS_LABELS = ['1km', '5km', '10km', '25km', '50km'];

type SearchTab = 'tagpoints' | 'coaches';

export default function SearchScreen() {
  const { t, lang } = useLang();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<SearchTab>('tagpoints');
  const [radiusIdx, setRadiusIdx] = useState(1);
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [tagPoints, setTagPoints] = useState<any[]>([]);
  const [coaches, setCoaches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    api.get('/domains').then(setDomains).catch(() => {});
    Location.requestForegroundPermissionsAsync().then(({ status }) => {
      if (status === 'granted') {
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then((loc) => {
          setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
        });
      } else {
        setLocation({ lat: 48.8566, lng: 2.3522 });
      }
    });
  }, []);

  useEffect(() => {
    if (location) doSearch();
  }, [location, radiusIdx, selectedDomain]);

  const doSearch = useCallback(async () => {
    if (!location) return;
    setLoading(true);
    try {
      const radius = RADII[radiusIdx];
      const params = new URLSearchParams({
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        radius: radius.toString(),
      });
      if (selectedDomain) params.append('domain_id', selectedDomain);

      const [pts, svcs] = await Promise.all([
        api.get(`/tag-points?${params.toString()}`),
        api.get(`/services?${params.toString()}`),
      ]);
      setTagPoints(pts);
      setCoaches(svcs);
    } catch {}
    finally { setLoading(false); }
  }, [location, radiusIdx, selectedDomain]);

  const filteredPoints = query
    ? tagPoints.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()))
    : tagPoints;

  const filteredCoaches = query
    ? coaches.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()) || c.coach?.name?.toLowerCase().includes(query.toLowerCase()))
    : coaches;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={Colors.muted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          onSubmitEditing={doSearch}
          testID="search-input"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} testID="clear-search">
            <Text style={styles.clearBtn}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Radius selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.radiusRow} contentContainerStyle={styles.radiusContent}>
        <Text style={styles.radiusLabel}>📍 Rayon :</Text>
        {RADII.map((r, i) => (
          <TouchableOpacity
            key={r}
            style={[styles.radiusBtn, radiusIdx === i && styles.radiusBtnActive]}
            onPress={() => setRadiusIdx(i)}
            testID={`radius-${RADIUS_LABELS[i]}`}
          >
            <Text style={[styles.radiusBtnText, radiusIdx === i && styles.radiusBtnTextActive]}>
              {RADIUS_LABELS[i]}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Domain filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.domainRow} contentContainerStyle={styles.domainContent}>
        <TouchableOpacity
          style={[styles.allPill, !selectedDomain && styles.allPillActive]}
          onPress={() => setSelectedDomain(null)}
          testID="search-domain-all"
        >
          <Text style={[styles.allText, !selectedDomain && styles.allTextActive]}>Tout</Text>
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

      {/* Tabs */}
      <View style={styles.tabs}>
        {(['tagpoints', 'coaches'] as SearchTab[]).map((tabKey) => (
          <TouchableOpacity
            key={tabKey}
            style={[styles.tabBtn, tab === tabKey && styles.tabBtnActive]}
            onPress={() => setTab(tabKey)}
            testID={`search-tab-${tabKey}`}
          >
            <Text style={[styles.tabText, tab === tabKey && styles.tabTextActive]}>
              {tabKey === 'tagpoints' ? `📍 ${t('tagPoints')}` : `🎯 ${t('coaches')}`}
            </Text>
            <View style={[styles.tabBadge, tab === tabKey && styles.tabBadgeActive]}>
              <Text style={[styles.tabBadgeText, tab === tabKey && styles.tabBadgeTextActive]}>
                {tabKey === 'tagpoints' ? filteredPoints.length : filteredCoaches.length}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Results */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.results} showsVerticalScrollIndicator={false}>
          {tab === 'tagpoints' && (
            filteredPoints.length === 0
              ? <View style={styles.empty}><Text style={styles.emptyIcon}>📍</Text><Text style={styles.emptyText}>{t('noResults')}</Text></View>
              : filteredPoints.map((pt) => <TagPointCard key={pt.point_id} point={pt} lang={lang} />)
          )}
          {tab === 'coaches' && (
            filteredCoaches.length === 0
              ? <View style={styles.empty}><Text style={styles.emptyIcon}>🎯</Text><Text style={styles.emptyText}>{t('noResults')}</Text></View>
              : filteredCoaches.map((svc) => <CoachCard key={svc.service_id} service={svc} lang={lang} />)
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.secondary,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  searchIcon: { fontSize: 16 },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: Colors.foreground },
  clearBtn: { fontSize: 14, color: Colors.muted, padding: 4 },
  radiusRow: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  radiusContent: { paddingHorizontal: Spacing.md, paddingVertical: 8, gap: 8, alignItems: 'center' },
  radiusLabel: { fontSize: 13, color: Colors.muted, marginRight: 4 },
  radiusBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background },
  radiusBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  radiusBtnText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  radiusBtnTextActive: { color: '#fff' },
  domainRow: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  domainContent: { paddingHorizontal: Spacing.md, paddingVertical: 8, gap: 8, alignItems: 'center' },
  allPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background },
  allPillActive: { backgroundColor: Colors.foreground, borderColor: Colors.foreground },
  allText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  allTextActive: { color: '#fff' },
  tabs: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: Radius.lg, borderWidth: 1.5,
    borderColor: Colors.border, gap: 6, backgroundColor: Colors.background,
  },
  tabBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },
  tabBadge: { backgroundColor: Colors.secondary, borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  tabBadgeActive: { backgroundColor: Colors.primary },
  tabBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  tabBadgeTextActive: { color: '#fff' },
  results: { padding: Spacing.md, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  empty: { alignItems: 'center', padding: Spacing.xl, gap: 12 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
});
