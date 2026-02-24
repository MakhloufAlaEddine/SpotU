import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import { Colors, Spacing, Radius } from '../../constants/Colors';

interface SavedAddress {
  id: string;
  name: string;
  address: string;
  icon: keyof typeof Ionicons.glyphMap;
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (lat: number, lng: number, address: string) => void;
  initialLat?: number;
  initialLng?: number;
}

export function LocationPicker({ 
  visible, 
  onClose, 
  onSelect,
  initialLat = 48.8566,
  initialLng = 2.3522 
}: LocationPickerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLat, setSelectedLat] = useState(initialLat);
  const [selectedLng, setSelectedLng] = useState(initialLng);
  const [mapType, setMapType] = useState<'Map' | 'Satellite'>('Map');
  
  // Sample saved addresses
  const savedAddresses: SavedAddress[] = [
    {
      id: '1',
      name: 'Home',
      address: '27 Bis Boulevard de la République, 78360 Montesson, France',
      icon: 'home-outline',
      lat: 48.9150,
      lng: 2.1465,
    },
    {
      id: '2',
      name: 'work',
      address: '53 Boulevard Brune, 75014 Paris, France',
      icon: 'briefcase-outline',
      lat: 48.8261,
      lng: 2.3177,
    },
  ];

  const handleSelectAddress = (address: SavedAddress) => {
    setSelectedLat(address.lat);
    setSelectedLng(address.lng);
  };

  const handleConfirm = () => {
    onSelect(selectedLat, selectedLng, 'Selected location');
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.container} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.headerBtn}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Set global location</Text>
          <TouchableOpacity onPress={handleConfirm}>
            <Text style={styles.headerBtn}>Choisir</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Search Bar */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={18} color={Colors.muted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Chercher une adresse"
              placeholderTextColor={Colors.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>

          {/* Current Location */}
          <TouchableOpacity style={styles.locationRow}>
            <Ionicons name="locate-outline" size={20} color={Colors.foreground} />
            <View style={styles.locationInfo}>
              <Text style={styles.locationTitle}>Localisation actuelle</Text>
              <Text style={styles.locationSubtitle}>Using GPS</Text>
            </View>
          </TouchableOpacity>

          {/* Map Section */}
          <View style={styles.mapSection}>
            {/* Map Type Toggle */}
            <View style={styles.mapTypeToggle}>
              {(['Map', 'Satellite'] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.mapTypeBtn, mapType === type && styles.mapTypeBtnActive]}
                  onPress={() => setMapType(type)}
                >
                  <Text style={[styles.mapTypeText, mapType === type && styles.mapTypeTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Map */}
            <View style={styles.mapContainer}>
              <MapViewComponent
                centerLat={selectedLat}
                centerLng={selectedLng}
                zoom={15}
                selectable
                selectedLat={selectedLat}
                selectedLng={selectedLng}
                onMapPress={(lat, lng) => {
                  setSelectedLat(lat);
                  setSelectedLng(lng);
                }}
                style={styles.map}
              />
            </View>
          </View>

          {/* Selected Location Display */}
          <TouchableOpacity style={styles.selectedLocation}>
            <Ionicons name="location" size={20} color={Colors.primary} />
            <Text style={styles.selectedLocationText} numberOfLines={1}>
              Gare Montparnas......75014 Pa...
            </Text>
          </TouchableOpacity>

          {/* Saved Addresses Section */}
          <View style={styles.savedSection}>
            <Text style={styles.savedTitle}>Adresses enregistrées</Text>
            {savedAddresses.map((address) => (
              <TouchableOpacity
                key={address.id}
                style={styles.savedAddress}
                onPress={() => handleSelectAddress(address)}
              >
                <Ionicons name={address.icon} size={20} color={Colors.foreground} />
                <View style={styles.savedAddressInfo}>
                  <Text style={styles.savedAddressName}>{address.name}</Text>
                  <Text style={styles.savedAddressText} numberOfLines={2}>
                    {address.address}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.header,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  headerBtn: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.primary,
  },
  content: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    fontSize: 15,
    color: Colors.foreground,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 12,
  },
  locationInfo: {
    flex: 1,
  },
  locationTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  locationSubtitle: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 2,
  },
  mapSection: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  mapTypeToggle: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: Radius.sm,
    padding: 4,
    alignSelf: 'flex-start',
    marginBottom: Spacing.sm,
  },
  mapTypeBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.sm,
  },
  mapTypeBtnActive: {
    backgroundColor: Colors.foreground,
  },
  mapTypeText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.muted,
  },
  mapTypeTextActive: {
    color: Colors.background,
  },
  mapContainer: {
    height: 200,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  selectedLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 8,
  },
  selectedLocationText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
  },
  savedSection: {
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  savedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: Spacing.md,
  },
  savedAddress: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
    gap: 12,
  },
  savedAddressInfo: {
    flex: 1,
  },
  savedAddressName: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.foreground,
  },
  savedAddressText: {
    fontSize: 13,
    color: Colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },
});

export default LocationPicker;
