import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../../components/MapViewComponent';
import { DomainPill } from '../../components/DomainPill';
import { TagSelector } from '../../components/TagSelector';
import { WButton } from '../../components/WButton';
import { WInput } from '../../components/WInput';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import * as Location from 'expo-location';

const PRECISION_OPTIONS = [
  { value: 'exact', labelFr: 'Elevé', labelEn: 'High' },
  { value: '100m', labelFr: 'Moyen', labelEn: 'Medium' },
  { value: '1000m', labelFr: 'Faible', labelEn: 'Low' },
];

const EXPIRE_OPTIONS = [
  { value: null, labelFr: 'Jamais', labelEn: 'Never' },
  { value: 24, labelFr: '24h', labelEn: '24h' },
  { value: 72, labelFr: '3 jours', labelEn: '3 days' },
  { value: 168, labelFr: '1 semaine', labelEn: '1 week' },
];

export default function CreateScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { t, lang } = useLang();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string>('');
  const [tags, setTags] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [precision, setPrecision] = useState('exact');
  const [expiresHours, setExpiresHours] = useState<number | null>(null);
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);
  const [centerLat, setCenterLat] = useState(48.8566);
  const [centerLng, setCenterLng] = useState(2.3522);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return; // Wait for auth to initialize
    if (!user) {
      Alert.alert('', 'Connectez-vous pour créer un TagPoint');
      router.replace('/(auth)/login');
      return;
    }
    loadData();
  }, [loading, user]);

  useEffect(() => {
    if (selectedDomain) loadTags(selectedDomain);
  }, [selectedDomain]);

  const loadData = async () => {
    try {
      const doms = await api.get('/domains');
      setDomains(doms);
      if (doms.length > 0) setSelectedDomain(doms[0].domain_id);

      // Try to get location
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setCenterLat(loc.coords.latitude);
        setCenterLng(loc.coords.longitude);
      }
    } catch {}
  };

  const loadTags = async (domainId: string) => {
    try {
      const [t, c] = await Promise.all([
        api.get(`/tags?domain_id=${domainId}`),
        api.get(`/tags/categories?domain_id=${domainId}`),
      ]);
      setTags(t);
      setCategories(c);
      setSelectedTags([]);
    } catch {}
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      Alert.alert('', 'Veuillez saisir un titre');
      return;
    }
    if (!selectedLat || !selectedLng) {
      Alert.alert('', t('selectLocationFirst'));
      return;
    }
    if (!selectedDomain) {
      Alert.alert('', 'Veuillez sélectionner un domaine');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/tag-points', {
        title: title.trim(),
        description: description.trim() || null,
        latitude: selectedLat,
        longitude: selectedLng,
        precision,
        tag_ids: selectedTags,
        domain_id: selectedDomain,
        expires_hours: expiresHours,
      });
      Alert.alert('✅', 'TagPoint créé avec succès !', [
        { text: 'Voir la carte', onPress: () => router.replace('/(tabs)/map') },
      ]);
      // Reset form
      setTitle('');
      setDescription('');
      setSelectedTags([]);
      setSelectedLat(null);
      setSelectedLng(null);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
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
          {/* Search bar */}
          <Text style={styles.searchLabel}>Rechercher</Text>

          {/* Image Upload Area */}
          <View style={styles.imageUploadArea}>
            <View style={styles.uploadContent}>
              <Ionicons name="cloud-upload-outline" size={24} color={Colors.primary} />
              <Text style={styles.uploadText}>Télécharger une image 1/10</Text>
            </View>
          </View>

          {/* Precision selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Précision d'emplacement</Text>
            <View style={styles.precisionRow}>
              {PRECISION_OPTIONS.map((p) => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.precisionBtn, precision === p.value && styles.precisionBtnActive]}
                  onPress={() => setPrecision(p.value)}
                  testID={`precision-${p.value}`}
                >
                  <Text style={[styles.precisionText, precision === p.value && styles.precisionTextActive]}>
                    {lang === 'fr' ? p.labelFr : p.labelEn}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Location Row */}
          <TouchableOpacity style={styles.locationRow}>
            <Ionicons name="location" size={20} color={Colors.primary} />
            <Text style={styles.locationText} numberOfLines={1}>
              Gare Montparnasse...75014 Par...
            </Text>
            <Ionicons name="pencil" size={18} color={Colors.foreground} />
          </TouchableOpacity>

          {/* Map for location */}
          <View style={styles.mapSection}>
            <View style={styles.mapWrap}>
              <MapViewComponent
                centerLat={centerLat}
                centerLng={centerLng}
                zoom={14}
                selectable
                showUserMarker
                selectedLat={selectedLat ?? undefined}
                selectedLng={selectedLng ?? undefined}
                onMapPress={(lat, lng) => { setSelectedLat(lat); setSelectedLng(lng); }}
                style={styles.map}
              />
            </View>
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
            value={description}
            onChangeText={setDescription}
            keyboardType="numeric"
            testID="create-price-input"
          />

          {/* Communication Toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleLabel}>
              <Text style={styles.toggleText}>Ouvert à la communication</Text>
              <Ionicons name="information-circle-outline" size={16} color={Colors.muted} />
            </View>
            <TouchableOpacity style={styles.toggleBtn}>
              <Ionicons name="checkmark" size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Domain selector - hidden for now */}
          {/* Tags - hidden for now */}
          {/* Expires - hidden for now */}

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
  safe: { flex: 1, backgroundColor: Colors.background },
  kav: { flex: 1 },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  screenTitle: { fontSize: 22, fontWeight: '900', color: Colors.foreground, marginBottom: Spacing.lg },
  mapSection: { marginBottom: Spacing.md },
  mapWrap: { height: 220, borderRadius: Radius.lg, overflow: 'hidden', marginTop: 8 },
  map: { flex: 1 },
  hint: { fontSize: 12, color: Colors.muted, marginTop: 4 },
  coordsText: { fontSize: 12, color: Colors.primary, marginTop: 6, fontWeight: '600' },
  section: { marginBottom: Spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 8 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  optionBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  optionTextActive: { color: Colors.primary },
  submitBtn: { marginTop: Spacing.md },
});
