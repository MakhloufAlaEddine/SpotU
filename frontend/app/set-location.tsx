import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, Platform, ActivityIndicator, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { storage } from '../lib/storage';

const { width: W } = Dimensions.get('window');

const SAVED_ADDRESSES = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home-outline' as const,
    address: '27 Bis Boulevard de la République, 78360 Montesson, France',
    lat: 48.9041, lng: 2.1499,
  },
  {
    id: 'work',
    label: 'work',
    icon: 'briefcase-outline' as const,
    address: '53 Boulevard Brune, 75014 Paris, France',
    lat: 48.8232, lng: 2.3214,
  },
];

export default function SetLocationScreen() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentAddress, setCurrentAddress] = useState('Localisation en cours...');
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);
  const [useGPS, setUseGPS] = useState(true);

  // Lazy-load MapView only on native to avoid web issues
  const [MapView, setMapView] = useState<any>(null);
  const [Marker, setMarker] = useState<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      const maps = require('react-native-maps');
      setMapView(() => maps.default);
      setMarker(() => maps.Marker);
    }
    initLocation();
  }, []);

  const initLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setSelectedLat(loc.coords.latitude);
        setSelectedLng(loc.coords.longitude);
        // Reverse geocode
        const [geo] = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (geo) {
          const parts = [geo.street, geo.city, geo.postalCode, geo.country].filter(Boolean);
          setCurrentAddress(parts.join(', '));
        }
      }
    } catch {}
    setLoading(false);
  };

  const handleChoose = async () => {
    await storage.set('winek_global_location', JSON.stringify({
      lat: selectedLat,
      lng: selectedLng,
      address: currentAddress,
      useGPS,
    }));
    router.back();
  };

  const handleSavedAddress = (addr: typeof SAVED_ADDRESSES[0]) => {
    setSelectedLat(addr.lat);
    setSelectedLng(addr.lng);
    setCurrentAddress(addr.address);
    setUseGPS(false);
  };

  const handleGPS = () => {
    setUseGPS(true);
    initLocation();
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerSide}>
            <Text style={styles.headerAction}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Set global location</Text>
          <TouchableOpacity onPress={handleChoose} style={styles.headerSide}>
            <Text style={[styles.headerAction, styles.headerActionRight]}>Choisir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Search bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Chercher une adresse"
          placeholderTextColor={Colors.muted}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {/* GPS row */}
      <TouchableOpacity style={styles.gpsRow} onPress={handleGPS}>
        <View style={styles.gpsIcon}>
          <Ionicons name="locate" size={22} color={Colors.foreground} />
        </View>
        <View>
          <Text style={styles.gpsTitle}>Localisation actuelle</Text>
          <Text style={styles.gpsSub}>Using GPS</Text>
        </View>
      </TouchableOpacity>

      {/* Map */}
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.mapPlaceholder}>
            <ActivityIndicator color={Colors.primary} size="large" />
          </View>
        ) : Platform.OS === 'web' || !MapView ? (
          <View style={[styles.mapPlaceholder, { backgroundColor: '#1a3a3a' }]}>
            <Ionicons name="map" size={48} color={Colors.muted} />
            <Text style={{ color: Colors.muted, marginTop: 8, fontSize: 13 }}>Carte disponible sur mobile</Text>
          </View>
        ) : (
          <MapView
            style={styles.map}
            region={{
              latitude: selectedLat,
              longitude: selectedLng,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
            onPress={(e: any) => {
              const { latitude, longitude } = e.nativeEvent.coordinate;
              setSelectedLat(latitude);
              setSelectedLng(longitude);
              setUseGPS(false);
              Location.reverseGeocodeAsync({ latitude, longitude }).then(([geo]) => {
                if (geo) {
                  const parts = [geo.street, geo.city, geo.postalCode].filter(Boolean);
                  setCurrentAddress(parts.join(', '));
                }
              });
            }}
          >
            {Marker && (
              <Marker coordinate={{ latitude: selectedLat, longitude: selectedLng }} pinColor="red" />
            )}
          </MapView>
        )}
      </View>

      {/* Current address */}
      <View style={styles.addressRow}>
        <Ionicons name="location" size={18} color={Colors.primary} />
        <Text style={styles.addressText} numberOfLines={1}>{currentAddress}</Text>
      </View>

      {/* Saved addresses */}
      <View style={styles.savedSection}>
        <Text style={styles.savedTitle}>Adresses enregistrées</Text>
        {SAVED_ADDRESSES.map(addr => (
          <TouchableOpacity key={addr.id} style={styles.savedRow} onPress={() => handleSavedAddress(addr)}>
            <View style={styles.savedIcon}>
              <Ionicons name={addr.icon} size={20} color={Colors.foreground} />
            </View>
            <View style={styles.savedInfo}>
              <Text style={styles.savedLabel}>{addr.label}</Text>
              <Text style={styles.savedAddress} numberOfLines={1}>{addr.address}</Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Colors.foreground },
  headerAction: { fontSize: 15, color: Colors.primary, fontWeight: '500' },
  headerActionRight: { textAlign: 'right' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.md,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.foreground },

  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  gpsIcon: {
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  gpsTitle: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  gpsSub: { fontSize: 13, color: Colors.muted, marginTop: 2 },

  mapContainer: { height: 220, marginHorizontal: Spacing.md, borderRadius: Radius.md, overflow: 'hidden' },
  map: { width: '100%', height: '100%' },
  mapPlaceholder: {
    width: '100%', height: '100%',
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },

  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    marginHorizontal: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
  },
  addressText: { flex: 1, fontSize: 14, color: Colors.foreground },

  savedSection: { paddingHorizontal: Spacing.md, marginTop: Spacing.lg },
  savedTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: Spacing.md },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  savedIcon: {
    width: 40, height: 40, borderRadius: Radius.sm,
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  savedInfo: { flex: 1 },
  savedLabel: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  savedAddress: { fontSize: 13, color: Colors.muted, marginTop: 2 },
});
