import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  TextInput, Image, FlatList, Modal, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { MapViewComponent } from '../../components/MapViewComponent';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const { width: SW } = Dimensions.get('window');
const IMG_SIZE = (SW - Spacing.md * 2 - 10 * 3) / 4;

const PRECISION_OPTIONS = [
  { value: 'exact', label: 'Élevé', desc: 'Lieu exact', icon: 'locate' as const },
  { value: '100m', label: 'Moyen', desc: '100m', icon: 'radio-button-on' as const },
  { value: '1000m', label: 'Faible', desc: '1 km', icon: 'radio-button-off' as const },
];

const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const CATEGORY_COLORS: Record<string, string> = {
  cat_running: '#00BFA5', cat_football: '#4CAF50', cat_basketball: '#FF9800',
  cat_tennis: '#E91E63', cat_yoga: '#9C27B0', cat_cycling: '#2196F3',
  cat_fitness: '#F44336', cat_swimming: '#00BCD4', cat_boxing: '#FF5722',
  cat_hiking: '#8BC34A', cat_volleyball: '#FF9500', default: '#00BFA5',
};
const tagColor = (cat?: string) => cat ? (CATEGORY_COLORS[cat] || CATEGORY_COLORS.default) : CATEGORY_COLORS.default;

export default function CreateTagPointScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLang();

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [precision, setPrecision] = useState('exact');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [domainId, setDomainId] = useState('dom_sport');
  const [images, setImages] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Location
  const [centerLat, setCenterLat] = useState(48.8566);
  const [centerLng, setCenterLng] = useState(2.3522);
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);
  const [locationAddress, setLocationAddress] = useState('Paris, France');

  // Schedule
  const [scheduleType, setScheduleType] = useState<'none' | 'once' | 'recurring'>('none');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [recurringDay, setRecurringDay] = useState<number | null>(null);
  const [recurringTime, setRecurringTime] = useState('');

  // Domain & Tag data
  const [domains, setDomains] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);

  const precisionRadius = PRECISION_OPTIONS.find(p => p.value === precision)?.value === 'exact'
    ? 0 : PRECISION_OPTIONS.find(p => p.value === precision)?.value === '100m' ? 100 : 1000;

  useEffect(() => {
    getUserLocation();
    loadDomains();
  }, []);

  useEffect(() => {
    loadCategories();
    setSelectedTagIds([]);
  }, [domainId]);

  const loadDomains = async () => {
    try { setDomains(await api.get('/domains')); } catch {}
  };

  const loadCategories = async () => {
    try { setCategories(await api.get(`/tags/categories?domain_id=${domainId}`)); } catch {}
  };

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const { latitude, longitude } = loc.coords;
        setCenterLat(latitude); setCenterLng(longitude);
        setSelectedLat(latitude); setSelectedLng(longitude);
        reverseGeocode(latitude, longitude);
      }
    } catch {}
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      const addr = data.address;
      const parts = [addr.road, addr.house_number, addr.postcode, addr.city || addr.town].filter(Boolean);
      setLocationAddress(parts.join(' ') || data.display_name?.split(',').slice(0, 2).join(',') || 'Position sélectionnée');
    } catch {}
  };

  const handleMapPress = (lat: number, lng: number) => {
    setSelectedLat(lat); setSelectedLng(lng);
    reverseGeocode(lat, lng);
  };

  const pickImages = async () => {
    if (images.length >= 10) { Alert.alert('Maximum', '10 images maximum'); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission', 'Accès à la galerie requis'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 10 - images.length,
    });
    if (!result.canceled) {
      setImages(prev => [...prev, ...result.assets.map(a => a.uri)].slice(0, 10));
    }
  };

  const removeImage = (idx: number) => setImages(prev => prev.filter((_, i) => i !== idx));

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const allTags = categories.flatMap(c => c.tags || []);
  const selectedTags = allTags.filter(t => selectedTagIds.includes(t.tag_id));

  const handleSubmit = async () => {
    if (!title.trim()) { Alert.alert('Titre requis', 'Veuillez entrer un titre pour ce tagPoint.'); return; }
    if (!user) { Alert.alert('Erreur', 'Vous devez être connecté.'); return; }

    let parsedEventDate: string | null = null;
    if (scheduleType === 'once' && eventDate && eventTime) {
      const [d, m, y] = eventDate.split('/');
      const iso = `${y}-${m}-${d}T${eventTime}:00`;
      if (!isNaN(new Date(iso).getTime())) parsedEventDate = new Date(iso).toISOString();
      else { Alert.alert('Date invalide', 'Format: JJ/MM/AAAA et HH:MM'); return; }
    }

    let parsedSchedule: any = null;
    if (scheduleType === 'recurring') {
      if (recurringDay === null) { Alert.alert('Jour requis', 'Sélectionnez un jour de récurrence.'); return; }
      if (!recurringTime) { Alert.alert('Heure requise', 'Entrez l\'heure de récurrence.'); return; }
      parsedSchedule = { type: 'weekly', day: recurringDay, time: recurringTime };
    }

    setSubmitting(true);
    try {
      const payload: any = {
        title: title.trim(),
        description: description.trim() || null,
        latitude: selectedLat,
        longitude: selectedLng,
        precision,
        domain_id: domainId,
        tag_ids: selectedTagIds,
        images: [], // Note: local URIs not uploadable yet — future sprint
      };
      if (parsedEventDate) payload.event_date = parsedEventDate;
      if (parsedSchedule) payload.event_schedule = parsedSchedule;

      const result = await api.post('/tag-points', payload);
      Alert.alert('Publié !', 'Votre tagPoint est maintenant visible.', [
        { text: 'Voir', onPress: () => router.replace(`/tag-point/${result.point_id}` as any) },
        { text: 'Accueil', onPress: () => router.replace('/(tabs)/map' as any) },
      ]);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le tagPoint');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity onPress={() => router.back()} style={st.headerBtn} testID="back-btn">
          <Ionicons name="chevron-back" size={24} color={Colors.primary} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Nouveau TagPoint</Text>
        <TouchableOpacity
          style={[st.publishBtn, submitting && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={submitting}
          testID="publish-btn"
        >
          {submitting
            ? <ActivityIndicator size="small" color={Colors.background} />
            : <Text style={st.publishBtnText}>Publier</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          style={st.scroll}
          contentContainerStyle={st.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ── 1. Images ─────────────────────────────────────── */}
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Photos</Text>
              <Text style={st.sectionHint}>{images.length}/10</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.imgScroll}>
              {/* Add button */}
              <TouchableOpacity style={st.imgAdd} onPress={pickImages} testID="add-image-btn">
                <Ionicons name="add" size={28} color={Colors.primary} />
                <Text style={st.imgAddText}>Ajouter</Text>
              </TouchableOpacity>
              {/* Thumbnails */}
              {images.map((uri, idx) => (
                <View key={idx} style={st.imgThumb}>
                  <Image source={{ uri }} style={st.imgThumbImg} />
                  {idx === 0 && (
                    <View style={st.imgMainBadge}>
                      <Text style={st.imgMainBadgeText}>Principale</Text>
                    </View>
                  )}
                  <TouchableOpacity style={st.imgRemove} onPress={() => removeImage(idx)} testID={`remove-img-${idx}`}>
                    <Ionicons name="close-circle" size={20} color={Colors.destructive} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>

          {/* ── 2. Titre ──────────────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Titre <Text style={st.required}>*</Text></Text>
            <TextInput
              style={st.input}
              placeholder="Ex : Footing matinal au bois de Vincennes"
              placeholderTextColor={Colors.muted}
              value={title}
              onChangeText={setTitle}
              maxLength={80}
              testID="title-input"
            />
            <Text style={st.charCount}>{title.length}/80</Text>
          </View>

          {/* ── 3. Description ────────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Description</Text>
            <TextInput
              style={[st.input, st.inputMulti]}
              placeholder="Décrivez l'activité, le niveau requis, ce qu'il faut apporter…"
              placeholderTextColor={Colors.muted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              maxLength={500}
              testID="description-input"
            />
            <Text style={st.charCount}>{description.length}/500</Text>
          </View>

          {/* ── 4. Domaine ────────────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Domaine</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={st.domainsScroll}>
              {domains.map(d => {
                const isSelected = domainId === d.domain_id;
                return (
                  <TouchableOpacity
                    key={d.domain_id}
                    style={[st.domainPill, isSelected && { backgroundColor: d.color || Colors.primary, borderColor: d.color || Colors.primary }]}
                    onPress={() => setDomainId(d.domain_id)}
                    testID={`domain-${d.domain_id}`}
                  >
                    <Text style={[st.domainText, isSelected && st.domainTextActive]}>
                      {lang === 'fr' ? d.label_fr : d.label_en}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* ── 5. Tags ───────────────────────────────────────── */}
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.label}>Tags</Text>
              {selectedTagIds.length > 0 && (
                <Text style={st.sectionHint}>{selectedTagIds.length} sélectionné{selectedTagIds.length > 1 ? 's' : ''}</Text>
              )}
            </View>
            <TouchableOpacity style={st.tagTrigger} onPress={() => setShowTagModal(true)} testID="open-tags-btn">
              {selectedTags.length === 0 ? (
                <>
                  <Ionicons name="pricetags-outline" size={18} color={Colors.muted} />
                  <Text style={st.tagTriggerText}>Choisir les tags</Text>
                </>
              ) : (
                <View style={st.tagRow}>
                  {selectedTags.slice(0, 4).map(tag => (
                    <View key={tag.tag_id} style={[st.tagPill, { backgroundColor: tagColor(tag.category_id) + '22', borderColor: tagColor(tag.category_id) }]}>
                      <Text style={[st.tagPillText, { color: tagColor(tag.category_id) }]}>
                        {lang === 'fr' ? tag.label_fr : tag.label_en}
                      </Text>
                    </View>
                  ))}
                  {selectedTags.length > 4 && (
                    <Text style={st.tagMore}>+{selectedTags.length - 4}</Text>
                  )}
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} style={{ marginLeft: 'auto' }} />
            </TouchableOpacity>
          </View>

          {/* ── 6. Précision ──────────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Précision de localisation</Text>
            <View style={st.precisionRow}>
              {PRECISION_OPTIONS.map(p => {
                const active = precision === p.value;
                return (
                  <TouchableOpacity
                    key={p.value}
                    style={[st.precisionBtn, active && st.precisionBtnActive]}
                    onPress={() => setPrecision(p.value)}
                    testID={`precision-${p.value}`}
                  >
                    <Ionicons name={p.icon} size={18} color={active ? Colors.primary : Colors.muted} />
                    <Text style={[st.precisionLabel, active && st.precisionLabelActive]}>{p.label}</Text>
                    <Text style={st.precisionDesc}>{p.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── 7. Localisation ───────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Localisation</Text>
            <View style={st.locationRow}>
              <Ionicons name="location" size={18} color={Colors.primary} />
              <Text style={st.locationText} numberOfLines={2}>{locationAddress}</Text>
              <TouchableOpacity onPress={getUserLocation} testID="refresh-location-btn">
                <Ionicons name="refresh" size={18} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <View style={st.mapWrap}>
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
              />
            </View>
            {precisionRadius > 0 && (
              <View style={st.precisionInfo}>
                <Ionicons name="information-circle-outline" size={14} color={Colors.muted} />
                <Text style={st.precisionInfoText}>
                  Localisation approximative dans un rayon de {precisionRadius >= 1000 ? '1 km' : '100 m'}
                </Text>
              </View>
            )}
          </View>

          {/* ── 8. Date & Horaire ─────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Date & Horaire</Text>
            <View style={st.scheduleRow}>
              {(['none', 'once', 'recurring'] as const).map(type => {
                const active = scheduleType === type;
                const icon = type === 'none' ? 'remove-circle-outline' : type === 'once' ? 'calendar-outline' : 'repeat-outline';
                const label = type === 'none' ? 'Sans date' : type === 'once' ? 'Date unique' : 'Récurrent';
                return (
                  <TouchableOpacity
                    key={type}
                    style={[st.scheduleBtn, active && st.scheduleBtnActive]}
                    onPress={() => setScheduleType(type)}
                    testID={`schedule-${type}`}
                  >
                    <Ionicons name={icon} size={20} color={active ? Colors.primary : Colors.muted} />
                    <Text style={[st.scheduleBtnText, active && st.scheduleBtnTextActive]}>{label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {scheduleType === 'once' && (
              <View style={st.scheduleCard}>
                <View style={st.scheduleInputRow}>
                  <View style={[st.scheduleField, { flex: 1.4 }]}>
                    <Text style={st.scheduleFieldLabel}>Date</Text>
                    <TextInput
                      style={st.scheduleInput}
                      placeholder="JJ/MM/AAAA"
                      placeholderTextColor={Colors.muted}
                      value={eventDate}
                      onChangeText={setEventDate}
                      keyboardType="numeric"
                      testID="event-date-input"
                    />
                  </View>
                  <View style={[st.scheduleField, { flex: 1 }]}>
                    <Text style={st.scheduleFieldLabel}>Heure</Text>
                    <TextInput
                      style={st.scheduleInput}
                      placeholder="HH:MM"
                      placeholderTextColor={Colors.muted}
                      value={eventTime}
                      onChangeText={setEventTime}
                      keyboardType="numeric"
                      testID="event-time-input"
                    />
                  </View>
                </View>
              </View>
            )}

            {scheduleType === 'recurring' && (
              <View style={st.scheduleCard}>
                <Text style={st.scheduleCardLabel}>Jour de la semaine</Text>
                <View style={st.daysRow}>
                  {DAYS.map((day, idx) => (
                    <TouchableOpacity
                      key={day}
                      style={[st.dayBtn, recurringDay === idx && st.dayBtnActive]}
                      onPress={() => setRecurringDay(idx)}
                      testID={`day-${idx}`}
                    >
                      <Text style={[st.dayText, recurringDay === idx && st.dayTextActive]}>{day}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={st.scheduleCardLabel}>Heure</Text>
                <TextInput
                  style={st.scheduleInput}
                  placeholder="Ex : 18:30"
                  placeholderTextColor={Colors.muted}
                  value={recurringTime}
                  onChangeText={setRecurringTime}
                  keyboardType="numeric"
                  testID="recurring-time-input"
                />
              </View>
            )}
          </View>

          {/* ── Publish button ─────────────────────────────────── */}
          <TouchableOpacity
            style={[st.submitBtn, (!title.trim() || submitting) && { opacity: 0.45 }]}
            onPress={handleSubmit}
            disabled={!title.trim() || submitting}
            testID="submit-btn"
          >
            {submitting
              ? <ActivityIndicator color={Colors.background} />
              : <>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
                  <Text style={st.submitBtnText}>Publier le TagPoint</Text>
                </>}
          </TouchableOpacity>

          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Tag Selector Modal ──────────────────────────────── */}
      <Modal visible={showTagModal} animationType="slide" transparent onRequestClose={() => setShowTagModal(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowTagModal(false)} />
          <View style={ms.sheet}>
            <View style={ms.modalHeader}>
              <Text style={ms.modalTitle}>Choisir les tags</Text>
              <View style={{ flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' }}>
                {selectedTagIds.length > 0 && (
                  <TouchableOpacity onPress={() => setSelectedTagIds([])}>
                    <Text style={ms.clearText}>Effacer</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => setShowTagModal(false)} testID="close-tag-modal">
                  <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 40 }}>
              {categories.map(cat => (
                <View key={cat.category_id} style={ms.catGroup}>
                  <Text style={ms.catLabel}>{lang === 'fr' ? cat.label_fr : cat.label_en}</Text>
                  <View style={ms.tagsWrap}>
                    {(cat.tags || []).map((tag: any) => {
                      const selected = selectedTagIds.includes(tag.tag_id);
                      const color = tagColor(cat.category_id);
                      return (
                        <TouchableOpacity
                          key={tag.tag_id}
                          style={[ms.tagChip, selected && { backgroundColor: color + '22', borderColor: color }]}
                          onPress={() => toggleTag(tag.tag_id)}
                          testID={`tag-chip-${tag.tag_id}`}
                        >
                          {selected && <Ionicons name="checkmark" size={12} color={color} style={{ marginRight: 3 }} />}
                          <Text style={[ms.tagChipText, selected && { color }]}>
                            {lang === 'fr' ? tag.label_fr : tag.label_en}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.header },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, backgroundColor: Colors.header },
  headerBtn: { padding: 4, width: 36 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.primary, flex: 1, textAlign: 'center' },
  publishBtn: { backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, minWidth: 72, alignItems: 'center' },
  publishBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },

  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: Spacing.md },

  section: { marginBottom: Spacing.lg },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  sectionHint: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  label: { fontSize: 13, fontWeight: '600', color: Colors.muted, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  required: { color: Colors.destructive },
  charCount: { fontSize: 11, color: Colors.muted, textAlign: 'right', marginTop: 4 },

  input: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },

  // Images
  imgScroll: { marginHorizontal: -Spacing.md, paddingHorizontal: Spacing.md },
  imgAdd: { width: IMG_SIZE + 20, height: IMG_SIZE + 20, borderRadius: Radius.md, backgroundColor: Colors.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  imgAddText: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  imgThumb: { width: IMG_SIZE + 20, height: IMG_SIZE + 20, borderRadius: Radius.md, marginRight: 10, position: 'relative', overflow: 'hidden' },
  imgThumbImg: { width: '100%', height: '100%', borderRadius: Radius.md },
  imgMainBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: Colors.primary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  imgMainBadgeText: { fontSize: 9, color: Colors.background, fontWeight: '700' },
  imgRemove: { position: 'absolute', top: 4, right: 4, backgroundColor: Colors.background, borderRadius: 10 },

  // Domains
  domainsScroll: { marginHorizontal: -Spacing.md, paddingHorizontal: Spacing.md },
  domainPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, marginRight: 8 },
  domainText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  domainTextActive: { color: Colors.background },

  // Tags trigger
  tagTrigger: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, minHeight: 52 },
  tagTriggerText: { fontSize: 15, color: Colors.muted },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 },
  tagPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1.5 },
  tagPillText: { fontSize: 12, fontWeight: '600' },
  tagMore: { fontSize: 12, color: Colors.primary, fontWeight: '700', alignSelf: 'center' },

  // Precision
  precisionRow: { flexDirection: 'row', gap: 8 },
  precisionBtn: { flex: 1, alignItems: 'center', gap: 4, padding: Spacing.sm, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border },
  precisionBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  precisionLabel: { fontSize: 13, fontWeight: '700', color: Colors.muted },
  precisionLabelActive: { color: Colors.primary },
  precisionDesc: { fontSize: 10, color: Colors.muted },

  // Location
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  locationText: { flex: 1, fontSize: 14, color: Colors.foreground },
  mapWrap: { height: 200, borderRadius: Radius.lg, overflow: 'hidden' },
  precisionInfo: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: Spacing.xs },
  precisionInfoText: { fontSize: 12, color: Colors.muted },

  // Schedule
  scheduleRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md },
  scheduleBtn: { flex: 1, alignItems: 'center', gap: 5, padding: Spacing.sm, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border },
  scheduleBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  scheduleBtnText: { fontSize: 11, fontWeight: '600', color: Colors.muted, textAlign: 'center' },
  scheduleBtnTextActive: { color: Colors.primary },
  scheduleCard: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  scheduleCardLabel: { fontSize: 12, fontWeight: '600', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  scheduleInputRow: { flexDirection: 'row', gap: Spacing.md },
  scheduleField: { gap: 6 },
  scheduleFieldLabel: { fontSize: 12, color: Colors.muted, fontWeight: '600' },
  scheduleInput: { backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border },
  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 4 },
  dayBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.border },
  dayBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  dayTextActive: { color: Colors.background },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, marginTop: Spacing.sm },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  clearText: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },
  catGroup: { marginBottom: Spacing.lg },
  catLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  tagChipText: { fontSize: 13, fontWeight: '500', color: Colors.foreground },
});
