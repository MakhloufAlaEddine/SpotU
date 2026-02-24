import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { MapViewComponent } from '../../components/MapViewComponent';
import { WInput } from '../../components/WInput';
import { WButton } from '../../components/WButton';
import { DomainPill } from '../../components/DomainPill';
import { TagSelector } from '../../components/TagSelector';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

const PRECISIONS = [
  { value: 'exact', labelFr: 'Exacte', labelEn: 'Exact' },
  { value: '100m', labelFr: '~100m', labelEn: '~100m' },
  { value: '1000m', labelFr: '~1km', labelEn: '~1km' },
];

const EXPIRES = [
  { value: null, labelFr: 'Jamais', labelEn: 'Never' },
  { value: 6, labelFr: '6h', labelEn: '6h' },
  { value: 24, labelFr: '24h', labelEn: '24h' },
  { value: 72, labelFr: '3j', labelEn: '3d' },
];

export default function CreateScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { t, lang } = useLang();

  const [step, setStep] = useState<'form' | 'map'>('form');
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
  const [mapLat, setMapLat] = useState(48.8566);
  const [mapLng, setMapLng] = useState(2.3522);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDomains();
    getLocation();
  }, []);

  useEffect(() => {
    if (selectedDomain) loadTags(selectedDomain);
  }, [selectedDomain]);

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setMapLat(loc.coords.latitude);
        setMapLng(loc.coords.longitude);
      }
    } catch {}
  };

  const loadDomains = async () => {
    try {
      const data = await api.get('/domains');
      setDomains(data);
      if (data.length > 0) setSelectedDomain(data[0].domain_id);
    } catch {}
  };

  const loadTags = async (domainId: string) => {
    try {
      const [tagsData, catsData] = await Promise.all([
        api.get(`/tags?domain_id=${domainId}`),
        api.get(`/tags/categories?domain_id=${domainId}`),
      ]);
      setTags(tagsData);
      setCategories(catsData);
      setSelectedTags([]);
    } catch {}
  };

  const handlePublish = async () => {
    if (!title.trim()) return Alert.alert(t('error'), 'Titre requis');
    if (!selectedDomain) return Alert.alert(t('error'), 'Domaine requis');
    if (!selectedLat || !selectedLng) return Alert.alert(t('error'), t('selectLocationFirst'));

    setLoading(true);
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
      Alert.alert('✅', 'TagPoint publié !', [{ text: 'OK', onPress: () => router.replace('/(tabs)/map') }]);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return (
    <View style={styles.center}>
      <Text style={styles.loginMsg}>Connectez-vous pour créer un TagPoint</Text>
      <WButton label={t('login')} onPress={() => router.replace('/(auth)/login')} />
    </View>
  );

  if (step === 'map') {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.mapHeader}>
          <TouchableOpacity onPress={() => setStep('form')} testID="back-from-map-btn">
            <Text style={styles.backText}>← {t('back')}</Text>
          </TouchableOpacity>
          <Text style={styles.mapTitle}>{t('selectLocation')}</Text>
          <View style={{ width: 60 }} />
        </View>
        <Text style={styles.mapHint}>{t('locationHint')}</Text>
        <MapViewComponent
          centerLat={mapLat}
          centerLng={mapLng}
          zoom={14}
          selectable
          selectedLat={selectedLat ?? undefined}
          selectedLng={selectedLng ?? undefined}
          onMapPress={(lat, lng) => { setSelectedLat(lat); setSelectedLng(lng); }}
          style={{ flex: 1 }}
        />
        {selectedLat && (
          <View style={styles.locationConfirm}>
            <Text style={styles.locationText}>📍 {selectedLat.toFixed(5)}, {selectedLng?.toFixed(5)}</Text>
            <WButton label={t('confirm')} onPress={() => setStep('form')} size="sm" testID="confirm-location-btn" />
          </View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.pageTitle}>{t('createTagPoint')}</Text>

          {/* Domain selector */}
          <Text style={styles.sectionLabel}>{t('selectDomain')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.domainScroll}>
            {domains.map((d) => (
              <DomainPill key={d.domain_id} domain={d} selected={selectedDomain === d.domain_id} onPress={() => setSelectedDomain(d.domain_id)} lang={lang} />
            ))}
          </ScrollView>

          {/* Form fields */}
          <WInput label={t('tagPointTitle')} placeholder="Ex: Footing dimanche matin" value={title} onChangeText={setTitle} testID="create-title-input" />
          <WInput label={t('tagPointDesc')} placeholder="Description optionnelle…" value={description} onChangeText={setDescription} multiline numberOfLines={3} testID="create-desc-input" />

          {/* Location */}
          <Text style={styles.sectionLabel}>{t('location')}</Text>
          <TouchableOpacity testID="pick-location-btn" style={[styles.locationBtn, selectedLat && styles.locationBtnFilled]} onPress={() => setStep('map')}>
            <Text style={styles.locationBtnIcon}>📍</Text>
            <Text style={[styles.locationBtnText, selectedLat && styles.locationBtnTextFilled]}>
              {selectedLat ? `${selectedLat.toFixed(4)}, ${selectedLng?.toFixed(4)}` : t('selectLocation')}
            </Text>
          </TouchableOpacity>

          {/* Precision */}
          <Text style={styles.sectionLabel}>{t('precision')}</Text>
          <View style={styles.pillRow}>
            {PRECISIONS.map((p) => (
              <TouchableOpacity key={p.value} testID={`precision-${p.value}`} style={[styles.pill, precision === p.value && styles.pillActive]} onPress={() => setPrecision(p.value)}>
                <Text style={[styles.pillText, precision === p.value && styles.pillTextActive]}>{lang === 'fr' ? p.labelFr : p.labelEn}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Expiry */}
          <Text style={styles.sectionLabel}>{t('expiresIn')}</Text>
          <View style={styles.pillRow}>
            {EXPIRES.map((e) => (
              <TouchableOpacity key={String(e.value)} testID={`expires-${e.value}`} style={[styles.pill, expiresHours === e.value && styles.pillActive]} onPress={() => setExpiresHours(e.value)}>
                <Text style={[styles.pillText, expiresHours === e.value && styles.pillTextActive]}>{lang === 'fr' ? e.labelFr : e.labelEn}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tags */}
          {tags.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t('selectTags')}</Text>
              <TagSelector tags={tags} categories={categories} selectedIds={selectedTags} onToggle={(id) => setSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id])} lang={lang} />
            </>
          )}

          <WButton label={`${t('publish')} ✓`} onPress={handlePublish} loading={loading} style={styles.publishBtn} testID="publish-tagpoint-btn" />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: Spacing.lg },
  loginMsg: { fontSize: 16, color: Colors.muted, textAlign: 'center' },
  scroll: { padding: Spacing.lg, paddingBottom: 40 },
  pageTitle: { fontSize: 22, fontWeight: '900', color: Colors.foreground, marginBottom: Spacing.lg },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground, marginBottom: 8, marginTop: Spacing.md },
  domainScroll: { marginBottom: Spacing.md },
  locationBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, marginBottom: Spacing.sm },
  locationBtnFilled: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  locationBtnIcon: { fontSize: 18 },
  locationBtnText: { fontSize: 14, color: Colors.muted, fontWeight: '500' },
  locationBtnTextFilled: { color: Colors.primary, fontWeight: '700' },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: Spacing.sm },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  pillTextActive: { color: '#fff' },
  publishBtn: { marginTop: Spacing.xl },
  mapHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  mapTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  mapHint: { textAlign: 'center', fontSize: 13, color: Colors.muted, paddingBottom: 8 },
  locationConfirm: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, backgroundColor: Colors.background, borderTopWidth: 1, borderTopColor: Colors.border },
  locationText: { fontSize: 13, color: Colors.primary, fontWeight: '600', flex: 1 },
});
