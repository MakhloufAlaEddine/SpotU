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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.screenTitle}>📍 {t('createTagPoint')}</Text>

          {/* Map for location */}
          <View style={styles.mapSection}>
            <Text style={styles.sectionTitle}>{t('selectLocation')}</Text>
            <Text style={styles.hint}>{t('locationHint')}</Text>
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
            {selectedLat && selectedLng && (
              <Text style={styles.coordsText}>
                📌 {selectedLat.toFixed(5)}, {selectedLng.toFixed(5)}
              </Text>
            )}
          </View>

          {/* Title & Description */}
          <WInput
            label={t('tagPointTitle')}
            placeholder="Ex: Footing au Parc"
            value={title}
            onChangeText={setTitle}
            testID="create-title-input"
          />
          <WInput
            label={t('tagPointDesc')}
            placeholder="Décrivez votre activité…"
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            testID="create-desc-input"
          />

          {/* Domain selector */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('selectDomain')}</Text>
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
              <Text style={styles.sectionTitle}>{t('selectTags')}</Text>
              <TagSelector
                tags={tags}
                categories={categories}
                selectedIds={selectedTags}
                onToggle={(id) => {
                  setSelectedTags((prev) =>
                    prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
                  );
                }}
                lang={lang}
                maxSelect={5}
              />
            </View>
          )}

          {/* Precision */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('precision')}</Text>
            <View style={styles.optionRow}>
              {PRECISION_OPTIONS.map((p) => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.optionBtn, precision === p.value && styles.optionBtnActive]}
                  onPress={() => setPrecision(p.value)}
                  testID={`precision-${p.value}`}
                >
                  <Text style={[styles.optionText, precision === p.value && styles.optionTextActive]}>
                    {lang === 'fr' ? p.labelFr : p.labelEn}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Expires */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('expiresIn')}</Text>
            <View style={styles.optionRow}>
              {EXPIRE_OPTIONS.map((e) => (
                <TouchableOpacity
                  key={String(e.value)}
                  style={[styles.optionBtn, expiresHours === e.value && styles.optionBtnActive]}
                  onPress={() => setExpiresHours(e.value)}
                  testID={`expire-${e.value ?? 'never'}`}
                >
                  <Text style={[styles.optionText, expiresHours === e.value && styles.optionTextActive]}>
                    {lang === 'fr' ? e.labelFr : e.labelEn}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <WButton
            label={submitting ? '' : `🚀 ${t('publish')}`}
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
