import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MapViewComponent } from '../components/MapViewComponent';
import { DomainPill } from '../components/DomainPill';
import { TagSelector } from '../components/TagSelector';
import { WButton } from '../components/WButton';
import { WInput } from '../components/WInput';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { Colors, Spacing, Radius } from '../constants/Colors';
import * as Location from 'expo-location';

export default function CreateServiceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLang();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('60');
  const [maxParticipants, setMaxParticipants] = useState('1');
  const [locationDesc, setLocationDesc] = useState('');
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [tags, setTags] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedLat, setSelectedLat] = useState<number | null>(null);
  const [selectedLng, setSelectedLng] = useState<number | null>(null);
  const [centerLat, setCenterLat] = useState(48.8566);
  const [centerLng, setCenterLng] = useState(2.3522);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user || (user.role !== 'coach' && user.role !== 'admin')) {
      Alert.alert('', 'Rôle Coach requis');
      router.back();
      return;
    }
    loadDomains();
    getLocation();
  }, []);

  useEffect(() => {
    if (selectedDomain) loadTagsForDomain(selectedDomain);
  }, [selectedDomain]);

  const loadDomains = async () => {
    try {
      const doms = await api.get('/domains');
      setDomains(doms);
      const coaching = doms.find((d: any) => d.name === 'coaching');
      setSelectedDomain(coaching?.domain_id || doms[0]?.domain_id || '');
    } catch {}
  };

  const getLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({});
      setCenterLat(loc.coords.latitude);
      setCenterLng(loc.coords.longitude);
    }
  };

  const loadTagsForDomain = async (domainId: string) => {
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
    if (!title.trim()) { Alert.alert('', 'Veuillez saisir un titre'); return; }
    const priceNum = parseFloat(price);
    if (!price || isNaN(priceNum) || priceNum <= 0) {
      Alert.alert('', 'Veuillez saisir un prix valide'); return;
    }
    if (!selectedDomain) { Alert.alert('', 'Veuillez sélectionner un domaine'); return; }

    setSubmitting(true);
    try {
      await api.post('/services', {
        title: title.trim(),
        description: description.trim() || null,
        price: priceNum,
        duration_min: parseInt(duration) || 60,
        max_participants: parseInt(maxParticipants) || 1,
        tag_ids: selectedTags,
        domain_id: selectedDomain,
        location_description: locationDesc.trim() || null,
        latitude: selectedLat,
        longitude: selectedLng,
      });
      Alert.alert('✅', 'Service créé avec succès !', [
        { text: 'Voir mon profil', onPress: () => router.replace('/(tabs)/profile') },
      ]);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const DURATION_OPTIONS = ['30', '45', '60', '90', '120'];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-btn">
              <Text style={styles.backText}>← Retour</Text>
            </TouchableOpacity>
            <Text style={styles.screenTitle}>🎯 Créer un service</Text>
          </View>

          <WInput
            label="Titre du service *"
            placeholder="Ex: Coaching running personnalisé"
            value={title}
            onChangeText={setTitle}
            testID="service-title-input"
          />

          <WInput
            label="Description"
            placeholder="Décrivez votre service, ce qui est inclus…"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            testID="service-desc-input"
          />

          {/* Price & Duration */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <WInput
                label="Prix (€) *"
                placeholder="60"
                value={price}
                onChangeText={setPrice}
                keyboardType="decimal-pad"
                testID="service-price-input"
              />
            </View>
            <View style={{ flex: 1 }}>
              <WInput
                label="Participants max"
                placeholder="1"
                value={maxParticipants}
                onChangeText={setMaxParticipants}
                keyboardType="number-pad"
                testID="service-max-input"
              />
            </View>
          </View>

          {/* Duration */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Durée (min)</Text>
            <View style={styles.optionRow}>
              {DURATION_OPTIONS.map((d) => (
                <TouchableOpacity
                  key={d}
                  style={[styles.optionBtn, duration === d && styles.optionBtnActive]}
                  onPress={() => setDuration(d)}
                  testID={`duration-${d}`}
                >
                  <Text style={[styles.optionText, duration === d && styles.optionTextActive]}>{d} min</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Domain */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Domaine *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {domains.map((d) => (
                <DomainPill
                  key={d.domain_id}
                  domain={d}
                  selected={selectedDomain === d.domain_id}
                  onPress={() => setSelectedDomain(d.domain_id)}
                  lang={lang}
                />
              ))}
            </ScrollView>
          </View>

          {/* Tags */}
          {tags.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tags</Text>
              <TagSelector
                tags={tags}
                categories={categories}
                selectedIds={selectedTags}
                onToggle={(id) =>
                  setSelectedTags((prev) =>
                    prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
                  )
                }
                lang={lang}
                maxSelect={5}
              />
            </View>
          )}

          {/* Location description */}
          <WInput
            label="Lieu (description)"
            placeholder="Ex: Paris 10e, à domicile, en plein air…"
            value={locationDesc}
            onChangeText={setLocationDesc}
            testID="service-location-desc-input"
          />

          {/* Map for location */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Position sur la carte (optionnel)</Text>
            <Text style={styles.hint}>Appuyez sur la carte pour définir votre position</Text>
            <View style={styles.mapWrap}>
              <MapViewComponent
                centerLat={centerLat}
                centerLng={centerLng}
                zoom={13}
                selectable
                showUserMarker
                selectedLat={selectedLat ?? undefined}
                selectedLng={selectedLng ?? undefined}
                onMapPress={(lat, lng) => { setSelectedLat(lat); setSelectedLng(lng); }}
                style={{ flex: 1 }}
              />
            </View>
            {selectedLat && selectedLng && (
              <Text style={styles.coordsText}>
                📌 {selectedLat.toFixed(5)}, {selectedLng.toFixed(5)}
              </Text>
            )}
          </View>

          {/* Commission info */}
          {price && !isNaN(parseFloat(price)) && (
            <View style={styles.commissionNote}>
              <Text style={styles.commissionText}>
                💡 Commission plateforme: {(parseFloat(price) * 0.15).toFixed(2)}€ (15%) · Votre gain net: {(parseFloat(price) * 0.85).toFixed(2)}€
              </Text>
            </View>
          )}

          <WButton
            label={submitting ? '' : '🚀 Publier mon service'}
            onPress={handleSubmit}
            loading={submitting}
            style={styles.submitBtn}
            testID="create-service-submit-btn"
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 40 },
  header: { marginBottom: Spacing.md },
  backBtn: { marginBottom: Spacing.sm },
  backText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  screenTitle: { fontSize: 22, fontWeight: '900', color: Colors.foreground },
  row: { flexDirection: 'row', gap: Spacing.sm },
  section: { marginBottom: Spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 8 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border },
  optionBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  optionText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  optionTextActive: { color: Colors.primary },
  hint: { fontSize: 12, color: Colors.muted, marginBottom: 8 },
  mapWrap: { height: 200, borderRadius: Radius.lg, overflow: 'hidden' },
  coordsText: { fontSize: 12, color: Colors.primary, fontWeight: '600', marginTop: 6 },
  commissionNote: { backgroundColor: '#FFF5E0', borderRadius: Radius.md, padding: Spacing.sm, marginBottom: Spacing.md },
  commissionText: { fontSize: 12, color: Colors.warning },
  submitBtn: { marginTop: Spacing.sm },
});
