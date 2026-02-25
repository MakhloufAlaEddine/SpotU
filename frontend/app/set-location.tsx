import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  TextInput, FlatList, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { MapViewComponent } from '../components/MapViewComponent';
import { useLocation } from '../context/LocationContext';

type NominatimResult = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
};

const SAVED_ADDRESSES = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home-outline' as const,
    address: '27 Bis Boulevard de la République, 78360 Montesson',
    lat: 48.9041,
    lng: 2.1499,
  },
  {
    id: 'work',
    label: 'work',
    icon: 'briefcase-outline' as const,
    address: '53 Boulevard Brune, 75014 Paris',
    lat: 48.8232,
    lng: 2.3214,
  },
];

export default function SetLocationScreen() {
  const router = useRouter();
  const { setLocation } = useLocation();
  const [loading, setLoading] = useState(false);
  const [currentAddress, setCurrentAddress] = useState('Paris, France');
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initLocation();
  }, []);

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'Accept-Language': 'fr' } }
      );
      const data = await res.json();
      if (data && data.display_name) {
        setCurrentAddress(data.display_name);
        setSearchQuery('');
      }
    } catch (_) {}
  };

  const initLocation = async () => {
    setLoading(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setSelectedLat(loc.coords.latitude);
        setSelectedLng(loc.coords.longitude);
        await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      }
    } catch (_) {}
    setLoading(false);
  };

  const handleMapPress = async (lat: number, lng: number) => {
    setSelectedLat(lat);
    setSelectedLng(lng);
    setShowResults(false);
    Keyboard.dismiss();
    await reverseGeocode(lat, lng);
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.length < 3) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(text)}&limit=5`,
          { headers: { 'Accept-Language': 'fr' } }
        );
        const data: NominatimResult[] = await res.json();
        setSearchResults(data);
        setShowResults(data.length > 0);
      } catch (_) {
        setSearchResults([]);
      }
      setSearching(false);
    }, 500);
  };

  const handleSelectResult = (result: NominatimResult) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setSelectedLat(lat);
    setSelectedLng(lng);
    setCurrentAddress(result.display_name);
    setSearchQuery('');
    setSearchResults([]);
    setShowResults(false);
    Keyboard.dismiss();
  };

  const handleChoose = async () => {
    await setLocation({
      lat: selectedLat,
      lng: selectedLng,
      address: currentAddress,
      isGPS: false,
    });
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/map' as any);
    }
  };

  const handleSaved = (addr: (typeof SAVED_ADDRESSES)[0]) => {
    setSelectedLat(addr.lat);
    setSelectedLng(addr.lng);
    setCurrentAddress(addr.address);
    setSearchQuery('');
    setShowResults(false);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerSide} testID="cancel-button">
            <Text style={styles.headerAction}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Définir la localisation</Text>
          <TouchableOpacity
            onPress={handleChoose}
            style={[styles.headerSide, { alignItems: 'flex-end' }]}
            testID="choose-button"
          >
            <Text style={[styles.headerAction, styles.headerChoose]}>Choisir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* GPS row */}
        <TouchableOpacity style={styles.gpsRow} onPress={initLocation} testID="gps-button">
          <View style={styles.gpsIcon}>
            <Ionicons name="locate" size={22} color={Colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.gpsTitle}>Localisation actuelle</Text>
            <Text style={styles.gpsSub}>Utiliser le GPS</Text>
          </View>
          {loading && <ActivityIndicator size="small" color={Colors.primary} />}
        </TouchableOpacity>

        {/* Search input */}
        <View style={styles.searchContainer}>
          <View style={styles.searchInputRow}>
            <Ionicons name="search" size={18} color={Colors.muted} style={{ marginRight: Spacing.sm }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Rechercher une adresse…"
              placeholderTextColor={Colors.muted}
              value={searchQuery}
              onChangeText={handleSearchChange}
              returnKeyType="search"
              clearButtonMode="while-editing"
              testID="address-search-input"
            />
            {searching && <ActivityIndicator size="small" color={Colors.primary} />}
          </View>

          {/* Search results dropdown */}
          {showResults && (
            <View style={styles.resultsDropdown}>
              <FlatList
                data={searchResults}
                keyExtractor={(item) => String(item.place_id)}
                scrollEnabled={false}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resultItem}
                    onPress={() => handleSelectResult(item)}
                    testID={`search-result-${item.place_id}`}
                  >
                    <Ionicons name="location-outline" size={16} color={Colors.primary} style={{ marginRight: Spacing.sm }} />
                    <Text style={styles.resultText} numberOfLines={2}>
                      {item.display_name}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}
        </View>

        {/* Map */}
        <View style={styles.mapContainer}>
          <MapViewComponent
            centerLat={selectedLat}
            centerLng={selectedLng}
            zoom={15}
            selectable
            showUserMarker={false}
            pins={[
              {
                id: 'selected',
                lat: selectedLat,
                lng: selectedLng,
                title: 'Position sélectionnée',
                color: '#E53E3E',
              },
            ]}
            onMapPress={handleMapPress}
          />
        </View>

        {/* Current address bar */}
        <View style={styles.addressRow} testID="current-address-bar">
          <Ionicons name="location" size={18} color={Colors.primary} />
          <Text style={styles.addressText} numberOfLines={2} testID="current-address-text">
            {currentAddress}
          </Text>
        </View>

        {/* Saved addresses */}
        <View style={styles.savedSection}>
          <Text style={styles.savedTitle}>Adresses enregistrées</Text>
          {SAVED_ADDRESSES.map((addr) => (
            <TouchableOpacity
              key={addr.id}
              style={styles.savedRow}
              onPress={() => handleSaved(addr)}
              testID={`saved-address-${addr.id}`}
            >
              <View style={styles.savedIcon}>
                <Ionicons name={addr.icon} size={20} color={Colors.foreground} />
              </View>
              <View style={styles.savedInfo}>
                <Text style={styles.savedLabel}>{addr.label}</Text>
                <Text style={styles.savedAddress} numberOfLines={1}>
                  {addr.address}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.muted} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  safeHeader: { backgroundColor: Colors.header },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  headerSide: { width: 80 },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
  },
  headerAction: { fontSize: 15, color: Colors.muted, fontWeight: '500' },
  headerChoose: { color: Colors.primary, textAlign: 'right' },

  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  gpsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gpsTitle: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  gpsSub: { fontSize: 13, color: Colors.muted, marginTop: 2 },

  searchContainer: {
    marginHorizontal: Spacing.md,
    marginTop: Spacing.md,
    zIndex: 10,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
    paddingVertical: 4,
  },
  resultsDropdown: {
    backgroundColor: Colors.card,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 4,
    overflow: 'hidden',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  resultText: {
    flex: 1,
    fontSize: 13,
    color: Colors.foreground,
    lineHeight: 18,
  },

  mapContainer: {
    height: 240,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.md,
    borderRadius: Radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },

  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  addressText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },

  savedSection: { paddingHorizontal: Spacing.md, marginTop: Spacing.lg },
  savedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: Spacing.sm,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  savedIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedInfo: { flex: 1 },
  savedLabel: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  savedAddress: { fontSize: 13, color: Colors.muted, marginTop: 2 },
});
