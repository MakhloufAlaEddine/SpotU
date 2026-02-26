import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import { WButton } from '../../components/WButton';
import { WInput } from '../../components/WInput';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import * as Location from 'expo-location';

// Precision options with radius in meters
const PRECISION_OPTIONS = [
  { value: 'exact', label: 'Elevé', radius: 0 },      // Exact location - no circle
  { value: '100m', label: 'Moyen', radius: 100 },     // 100m radius circle
  { value: '1000m', label: 'Faible', radius: 1000 },  // 1000m radius circle
];

export default function CreateTagPointScreen() {
  const router = useRouter();
  const { user, token } = useAuth();
  const { t, lang } = useLang();

  // Form state
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [precision, setPrecision] = useState('exact');
  const [openToCommunication, setOpenToCommunication] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Location state - initialize with Paris coordinates
  const [centerLat, setCenterLat] = useState(48.8566);
  const [centerLng, setCenterLng] = useState(2.3522);
  const [selectedLat, setSelectedLat] = useState<number>(48.8566);
  const [selectedLng, setSelectedLng] = useState<number>(2.3522);
  const [locationAddress, setLocationAddress] = useState('Chargement...');

  // Schedule state
  const [scheduleType, setScheduleType] = useState<'none' | 'once' | 'recurring'>('none');
  const [eventDate, setEventDate] = useState(''); // DD/MM/YYYY
  const [eventTime, setEventTime] = useState(''); // HH:MM
  const [recurringDay, setRecurringDay] = useState<number | null>(null); // 0=Lun..6=Dim
  const [recurringTime, setRecurringTime] = useState(''); // HH:MM
  const currentPrecision = PRECISION_OPTIONS.find(p => p.value === precision);
  const precisionRadius = currentPrecision?.radius || 0;

  useEffect(() => {
    getUserLocation();
  }, []);

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setCenterLat(loc.coords.latitude);
        setCenterLng(loc.coords.longitude);
        setSelectedLat(loc.coords.latitude);
        setSelectedLng(loc.coords.longitude);
        
        // Reverse geocode to get address
        try {
          const addresses = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          if (addresses.length > 0) {
            const addr = addresses[0];
            setLocationAddress(`${addr.street || ''} ${addr.streetNumber || ''}...${addr.postalCode || ''} ${addr.city || ''}`);
          }
        } catch {}
      }
    } catch {
      // Default to Paris
      setCenterLat(48.8566);
      setCenterLng(2.3522);
    }
  };

  const handleMapPress = async (lat: number, lng: number) => {
    setSelectedLat(lat);
    setSelectedLng(lng);
    
    // Reverse geocode
    try {
      const addresses = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (addresses.length > 0) {
        const addr = addresses[0];
        setLocationAddress(`${addr.street || ''} ${addr.streetNumber || ''}...${addr.postalCode || ''} ${addr.city || ''}`);
      }
    } catch {}
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('Erreur', 'Veuillez entrer un titre');
      return;
    }
    if (!selectedLat || !selectedLng) {
      Alert.alert('Erreur', 'Veuillez sélectionner un emplacement sur la carte');
      return;
    }
    if (!token) {
      Alert.alert('Erreur', 'Vous devez être connecté');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        description: price ? `Prix: ${price}€` : '',
        latitude: selectedLat,
        longitude: selectedLng,
        precision,
        domain_id: 'dom_sport',
        tag_ids: [],
        open_to_communication: openToCommunication,
      };

      await api.post('/tag-points', payload);
      Alert.alert('Succès', 'Tag point créé !', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/map') }
      ]);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le tag point');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Créer un point tag</Text>
        <TouchableOpacity style={styles.headerAction}>
          <Text style={styles.headerActionText}>Choisir</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Search label */}
          <Text style={styles.searchLabel}>Rechercher</Text>

          {/* Image Upload Area */}
          <TouchableOpacity style={styles.imageUploadArea} activeOpacity={0.7}>
            <View style={styles.uploadContent}>
              <Ionicons name="cloud-upload-outline" size={24} color={Colors.muted} />
              <Text style={styles.uploadText}>Télécharger une image 1/10</Text>
            </View>
          </TouchableOpacity>

          {/* Precision selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Précision d'emplacement</Text>
            <View style={styles.precisionRow}>
              {PRECISION_OPTIONS.map((p, index) => (
                <TouchableOpacity
                  key={p.value}
                  style={[
                    styles.precisionBtn,
                    precision === p.value && styles.precisionBtnActive,
                    index === 0 && styles.precisionBtnFirst,
                    index === PRECISION_OPTIONS.length - 1 && styles.precisionBtnLast,
                  ]}
                  onPress={() => setPrecision(p.value)}
                  testID={`precision-${p.value}`}
                >
                  <Text style={[
                    styles.precisionText,
                    precision === p.value && styles.precisionTextActive
                  ]}>
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Location Row */}
          <TouchableOpacity style={styles.locationRow} activeOpacity={0.7}>
            <Ionicons name="location" size={20} color={Colors.primary} />
            <Text style={styles.locationText} numberOfLines={1}>
              {locationAddress}
            </Text>
            <Ionicons name="pencil" size={18} color={Colors.foreground} />
          </TouchableOpacity>

          {/* Map with precision circle */}
          <View style={styles.mapSection}>
            <View style={styles.mapWrap}>
              <MapViewComponent
                key={`map-${precision}`}
                centerLat={selectedLat}
                centerLng={selectedLng}
                zoom={precisionRadius >= 1000 ? 14 : precisionRadius >= 100 ? 16 : 17}
                selectable
                showUserMarker={false}
                selectedLat={selectedLat}
                selectedLng={selectedLng}
                onMapPress={handleMapPress}
                precisionRadius={precisionRadius}
                style={styles.map}
              />
            </View>
            {/* Precision indicator text */}
            {precisionRadius > 0 && (
              <Text style={styles.precisionIndicator}>
                Zone de précision: {precisionRadius >= 1000 ? `${precisionRadius/1000}km` : `${precisionRadius}m`}
              </Text>
            )}
          </View>

          {/* Title */}
          <WInput
            label="Titre"
            placeholder="Entrer un titre"
            value={title}
            onChangeText={setTitle}
            testID="create-title-input"
          />

          {/* Price */}
          <WInput
            label="price"
            placeholder="Entrer le prix"
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            testID="create-price-input"
          />

          {/* Communication Toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabel}>
              <Text style={styles.toggleText}>Ouvert à la communication</Text>
              <Ionicons name="information-circle-outline" size={16} color={Colors.muted} />
            </View>
            <TouchableOpacity 
              style={[styles.toggleBtn, openToCommunication && styles.toggleBtnActive]}
              onPress={() => setOpenToCommunication(!openToCommunication)}
            >
              {openToCommunication && (
                <Ionicons name="checkmark" size={18} color={Colors.background} />
              )}
            </TouchableOpacity>
          </View>

          <WButton
            label={submitting ? '' : 'Publier'}
            onPress={handleSubmit}
            loading={submitting}
            style={styles.submitBtn}
            testID="create-submit-btn"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.header },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.header,
  },
  backBtn: { padding: 4 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.primary,
  },
  headerAction: { padding: 4 },
  headerActionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  kav: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  searchLabel: {
    fontSize: 14,
    color: Colors.muted,
    marginBottom: Spacing.sm,
  },
  imageUploadArea: {
    height: 180,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  uploadContent: {
    alignItems: 'center',
    gap: 8,
  },
  uploadText: {
    fontSize: 14,
    color: Colors.muted,
  },
  section: { marginBottom: Spacing.md },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.foreground,
    marginBottom: Spacing.sm,
  },
  precisionRow: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    backgroundColor: Colors.card,
  },
  precisionBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRightWidth: 1,
    borderRightColor: Colors.border,
  },
  precisionBtnFirst: {
    borderTopLeftRadius: Radius.lg,
    borderBottomLeftRadius: Radius.lg,
  },
  precisionBtnLast: {
    borderTopRightRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
    borderRightWidth: 0,
  },
  precisionBtnActive: {
    backgroundColor: Colors.header,
  },
  precisionText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.muted,
  },
  precisionTextActive: {
    color: Colors.foreground,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  locationText: {
    flex: 1,
    fontSize: 14,
    color: Colors.foreground,
  },
  mapSection: { marginBottom: Spacing.md },
  mapWrap: { 
    height: 200, 
    borderRadius: Radius.lg, 
    overflow: 'hidden',
  },
  map: { flex: 1 },
  precisionIndicator: {
    fontSize: 12,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toggleText: {
    fontSize: 15,
    color: Colors.foreground,
  },
  toggleBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.muted,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  submitBtn: { marginTop: Spacing.md },
});
