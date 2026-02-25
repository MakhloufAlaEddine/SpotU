import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { MapViewComponent } from '../components/MapViewComponent';
import { useLocation } from '../context/LocationContext';

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

  useEffect(() => {
    initLocation();
  }, []);

  const initLocation = async () => {
    setLoading(true);
    try {
      // Dynamic import to avoid web issues
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setSelectedLat(loc.coords.latitude);
        setSelectedLng(loc.coords.longitude);
        const results = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (results[0]) {
          const g = results[0];
          const parts = [g.street, g.city, g.postalCode].filter(Boolean);
          setCurrentAddress(parts.join(', '));
        }
      }
    } catch (_) {}
    setLoading(false);
  };

  const handleChoose = async () => {
    // Met à jour le contexte React ET persiste — tous les écrans se rafraîchissent instantanément
    await setLocation({
      lat: selectedLat,
      lng: selectedLng,
      address: currentAddress,
      isGPS: false,
    });
    router.back();
  };

  const handleSaved = (addr: (typeof SAVED_ADDRESSES)[0]) => {
    setSelectedLat(addr.lat);
    setSelectedLng(addr.lng);
    setCurrentAddress(addr.address);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <SafeAreaView edges={['top']} style={styles.safeHeader}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerSide}>
            <Text style={styles.headerAction}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Set global location</Text>
          <TouchableOpacity
            onPress={handleChoose}
            style={[styles.headerSide, { alignItems: 'flex-end' }]}
          >
            <Text style={[styles.headerAction, styles.headerChoose]}>Choisir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* GPS row */}
        <TouchableOpacity style={styles.gpsRow} onPress={initLocation}>
          <View style={styles.gpsIcon}>
            <Ionicons name="locate" size={22} color={Colors.foreground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.gpsTitle}>Localisation actuelle</Text>
            <Text style={styles.gpsSub}>Using GPS</Text>
          </View>
          {loading && <ActivityIndicator size="small" color={Colors.primary} />}
        </TouchableOpacity>

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
            onMapPress={(lat, lng) => {
              setSelectedLat(lat);
              setSelectedLng(lng);
            }}
          />
        </View>

        {/* Current address bar */}
        <View style={styles.addressRow}>
          <Ionicons name="location" size={18} color={Colors.primary} />
          <Text style={styles.addressText} numberOfLines={2}>
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
