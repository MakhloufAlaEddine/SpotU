import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Modal, ActivityIndicator, FlatList, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from './MapViewComponent';
import { Colors, Spacing, Radius } from '../constants/Colors';

type NominatimResult = { place_id: number; display_name: string; lat: string; lon: string };

interface LocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (lat: number, lng: number, address: string) => void;
  initialLat?: number;
  initialLng?: number;
  initialAddress?: string;
}

export function LocationPicker({
  visible, onClose, onSelect,
  initialLat = 48.8566, initialLng = 2.3522, initialAddress = '',
}: LocationPickerProps) {
  const [selectedLat, setSelectedLat] = useState(initialLat);
  const [selectedLng, setSelectedLng] = useState(initialLng);
  const [currentAddress, setCurrentAddress] = useState(initialAddress);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const formatAddress = (data: any) => {
    const a = data.address || {};
    const parts = [
      a.road || a.pedestrian || a.footway,
      a.house_number,
      a.postcode,
      a.city || a.town || a.village || a.municipality,
    ].filter(Boolean);
    return parts.length >= 2 ? parts.join(', ') : data.display_name?.split(',').slice(0, 3).join(',') || '';
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
        { headers: { 'Accept-Language': 'fr' } }
      );
      const data = await res.json();
      if (data?.display_name) setCurrentAddress(formatAddress(data));
    } catch {}
  };

  const handleMapPress = async (lat: number, lng: number) => {
    setSelectedLat(lat); setSelectedLng(lng);
    setShowResults(false); Keyboard.dismiss();
    await reverseGeocode(lat, lng);
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (text.length < 2) { setSearchResults([]); setShowResults(false); return; }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        // Search addresses + places + POI (amenities, shops, tourism, etc.)
        const params = new URLSearchParams({
          format: 'json',
          q: text,
          limit: '8',
          addressdetails: '1',
          extratags: '1',
          namedetails: '1',
          'accept-language': 'fr',
          countrycodes: 'fr',
        });
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          { headers: { 'Accept-Language': 'fr', 'User-Agent': 'SpotUApp/1.0' } }
        );
        let data: NominatimResult[] = await res.json();
        // If no results with countrycodes=fr, retry without restriction
        if (data.length === 0) {
          const params2 = new URLSearchParams({ format: 'json', q: text, limit: '8', addressdetails: '1', extratags: '1' });
          const res2 = await fetch(`https://nominatim.openstreetmap.org/search?${params2}`, { headers: { 'Accept-Language': 'fr', 'User-Agent': 'SpotUApp/1.0' } });
          data = await res2.json();
        }
        setSearchResults(data); setShowResults(data.length > 0);
      } catch {}
      setSearching(false);
    }, 350);
  };

  const handleSelectResult = (result: NominatimResult) => {
    const lat = parseFloat(result.lat), lng = parseFloat(result.lon);
    setSelectedLat(lat); setSelectedLng(lng);
    setCurrentAddress(result.display_name.split(',').slice(0, 3).join(','));
    setSearchQuery(''); setSearchResults([]); setShowResults(false); Keyboard.dismiss();
  };

  const handleGPS = async () => {
    setGpsLoading(true);
    try {
      const Location = await import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setSelectedLat(loc.coords.latitude); setSelectedLng(loc.coords.longitude);
        await reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      }
    } catch {}
    setGpsLoading(false);
  };

  const handleConfirm = () => {
    onSelect(selectedLat, selectedLng, currentAddress);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={st.container} edges={['top']}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} testID="location-cancel">
            <Text style={st.cancel}>Annuler</Text>
          </TouchableOpacity>
          <Text style={st.headerTitle}>Définir la localisation</Text>
          <TouchableOpacity onPress={handleConfirm} testID="location-confirm">
            <Text style={st.confirm}>Choisir</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1, backgroundColor: Colors.background }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* GPS */}
          <TouchableOpacity style={st.gpsRow} onPress={handleGPS} testID="location-gps-btn">
            <View style={st.gpsIcon}>
              <Ionicons name="locate" size={22} color={Colors.foreground} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.gpsTitle}>Localisation actuelle</Text>
              <Text style={st.gpsSub}>Utiliser le GPS</Text>
            </View>
            {gpsLoading && <ActivityIndicator size="small" color={Colors.primary} />}
          </TouchableOpacity>

          {/* Search */}
          <View style={st.searchWrap}>
            <View style={st.searchRow}>
              <Ionicons name="search" size={18} color={Colors.muted} style={{ marginRight: 8 }} />
              <TextInput
                style={st.searchInput}
                placeholder="Adresse, lieu, commerce, POI…"
                placeholderTextColor={Colors.muted}
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
                testID="location-search-input"
              />
              {searching && <ActivityIndicator size="small" color={Colors.primary} />}
            </View>
            {showResults && (
              <View style={st.resultsBox}>
                <FlatList
                  data={searchResults}
                  keyExtractor={i => String(i.place_id)}
                  scrollEnabled={false}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => {
                    const parts = item.display_name.split(', ');
                    const mainName = parts[0];
                    const subName = parts.slice(1, 3).join(', ');
                    return (
                      <TouchableOpacity style={st.resultRow} onPress={() => handleSelectResult(item)}>
                        <Ionicons name="location-outline" size={16} color={Colors.primary} style={{ marginRight: 8, marginTop: 2 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={st.resultName} numberOfLines={1}>{mainName}</Text>
                          {subName ? <Text style={st.resultSub} numberOfLines={1}>{subName}</Text> : null}
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            )}
          </View>

          {/* Map */}
          <View style={st.mapWrap}>
            <MapViewComponent
              centerLat={selectedLat}
              centerLng={selectedLng}
              zoom={15}
              selectable
              showUserMarker={false}
              pins={[{ id: 'selected', lat: selectedLat, lng: selectedLng, title: 'Position', color: '#E53E3E' }]}
              onMapPress={handleMapPress}
            />
          </View>

          {/* Current address */}
          {currentAddress ? (
            <View style={st.addrRow}>
              <Ionicons name="location" size={18} color={Colors.primary} />
              <Text style={st.addrText} numberOfLines={2}>{currentAddress}</Text>
            </View>
          ) : null}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.header },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.header, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  cancel: { fontSize: 15, color: Colors.muted },
  confirm: { fontSize: 15, fontWeight: '700', color: Colors.primary },

  gpsRow: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, gap: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.background },
  gpsIcon: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  gpsTitle: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  gpsSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },

  searchWrap: { marginHorizontal: Spacing.md, marginVertical: Spacing.md, zIndex: 10 },
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  searchInput: { flex: 1, fontSize: 14, color: Colors.foreground, paddingVertical: 4 },
  resultsBox: { backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginTop: 4, overflow: 'hidden' },
  resultRow: { flexDirection: 'row', alignItems: 'flex-start', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  resultName: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  resultSub: { fontSize: 11, color: Colors.muted, marginTop: 2 },

  mapWrap: { height: 280, marginHorizontal: Spacing.md, borderRadius: Radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  addrRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.card, marginHorizontal: Spacing.md, marginTop: Spacing.md, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  addrText: { flex: 1, fontSize: 14, color: Colors.foreground, lineHeight: 20 },
});
