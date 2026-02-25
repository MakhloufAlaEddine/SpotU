import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { Colors, Spacing, Radius } from '../constants/Colors';
import { storage } from '../lib/storage';
import MapViewComponent from '../components/MapViewComponent';

const SAVED_ADDRESSES = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home-outline' as const,
    address: '27 Bis Boulevard de la République, 78360 Montesson',
    lat: 48.9041, lng: 2.1499,
  },
  {
    id: 'work',
    label: 'work',
    icon: 'briefcase-outline' as const,
    address: '53 Boulevard Brune, 75014 Paris',
    lat: 48.8232, lng: 2.3214,
  },
];

export default function SetLocationScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentAddress, setCurrentAddress] = useState('Localisation en cours...');
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);

  useEffect(() => { initLocation(); }, []);

  const initLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setSelectedLat(loc.coords.latitude);
        setSelectedLng(loc.coords.longitude);
        await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      }
    } catch {}
    setLoading(false);
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (geo) {
        const parts = [geo.street, geo.city, geo.postalCode].filter(Boolean);
        setCurrentAddress(parts.join(', '));
      }
    } catch {}
  };

  const handleMapPress = (lat: number, lng: number) => {
    setSelectedLat(lat);
    setSelectedLng(lng);
    reverseGeocode(lat, lng);
  };

  const handleChoose = async () => {
    await storage.set('winek_global_location', JSON.stringify({
      lat: selectedLat,
      lng: selectedLng,
      address: currentAddress,
    }));
    router.back();
  };

  const handleSaved = (addr: typeof SAVED_ADDRESSES[0]) => {
    setSelectedLat(addr.lat);
    setSelectedLng(addr.lng);
    setCurrentAddress(addr.address);
  };

  const handleGPS = () => {
    setLoading(true);
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
          <TouchableOpacity onPress={handleChoose} style={[styles.headerSide, { alignItems: 'flex-end' }]}>
            <Text style={[styles.headerAction, { color: Colors.primary }]}>Choisir</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* GPS row */}
        <TouchableOpacity style={styles.gpsRow} onPress={handleGPS}>
          <View style={styles.gpsIcon}>
            <Ionicons name="locate" size={22} color={Colors.foreground} />
          </View>
          <View>
            <Text style={styles.gpsTitle}>Localisation actuelle</Text>
            <Text style={styles.gpsSub}>Using GPS</Text>
          </View>
          {loading && <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 'auto' }} />}
        </TouchableOpacity>

        {/* Map */}
        <View style={styles.mapContainer}>
          <MapViewComponent
            centerLat={selectedLat}
            centerLng={selectedLng}
            zoom={15}
            selectable
            showUserMarker={false}
            pins={[{
              id: 'selected',
              lat: selectedLat,
              lng: selectedLng,
              title: 'Position sélectionnée',
              color: '#E53E3E',
            }]}
            onMapPress={handleMapPress}
            style={{ width: '100%', height: '100%' }}
          />
        </View>

        {/* Current address */}
        <View style={styles.addressRow}>
          <Ionicons name="location" size={18} color={Colors.primary} />
          <Text style={styles.addressText} numberOfLines={2}>{currentAddress}</Text>
        </View>

        {/* Saved addresses */}
        <View style={styles.savedSection}>
          <Text style={styles.savedTitle}>Adresses enregistrées</Text>
          {SAVED_ADDRESSES.map(addr => (
            <TouchableOpacity key={addr.id} style={styles.savedRow} onPress={() => handleSaved(addr)}>
              <View style={styles.savedIcon}>
                <Ionicons name={addr.icon} size={20} color={Colors.foreground} />
              </View>
              <View style={styles.savedInfo}>
                <Text style={styles.savedLabel}>{addr.label}</Text>
                <Text style={styles.savedAddress} numberOfLines={1}>{addr.address}</Text>
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
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 16, fontWeight: '700', color: Colors.foreground },
  headerAction: { fontSize: 15, color: Colors.muted, fontWeight: '500' },

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
    width: 40, height: 40, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
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
  savedTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, marginBottom: Spacing.sm },
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
