import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
  TextInput, Image, Modal, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { MapViewComponent } from '../../components/MapViewComponent';
import { LocationPicker } from '../../components/LocationPicker';
import { DateTimePickerModal } from '../../components/DateTimePicker';
import { RichTextInput } from '../../components/RichTextInput';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

const { width: SW, height: SH } = Dimensions.get('window');
const IMG_SIZE = Math.floor((SW - Spacing.md * 2 - 10 * 2) / 3);

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
  cat_hiking: '#8BC34A', cat_volleyball: '#FF9500',
};
const tagColor = (cat?: string) => (cat && CATEGORY_COLORS[cat]) ? CATEGORY_COLORS[cat] : Colors.primary;

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const fmtDate = (d: Date) =>
  `${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
const fmtTime = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

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
  const [selectedLat, setSelectedLat] = useState(48.8566);
  const [selectedLng, setSelectedLng] = useState(2.3522);
  const [locationAddress, setLocationAddress] = useState('Paris, France');
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Schedule
  const [scheduleType, setScheduleType] = useState<'none' | 'once' | 'recurring'>('none');
  const [eventDateTime, setEventDateTime] = useState<Date | null>(null);
  const [showDateTimePicker, setShowDateTimePicker] = useState(false);
  const [recurringDay, setRecurringDay] = useState<number | null>(null);
  const [recurringTime, setRecurringTime] = useState<Date | null>(null);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // Domain & Tag data
  const [domains, setDomains] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);

  const precisionRadius = precision === 'exact' ? 0 : precision === '100m' ? 100 : 1000;

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
        setSelectedLat(loc.coords.latitude); setSelectedLng(loc.coords.longitude);
        reverseGeocode(loc.coords.latitude, loc.coords.longitude);
      }
    } catch {}
  };

  const reverseGeocode = async (lat: number, lng: number) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await res.json();
      const addr = data.address || {};
      const parts = [addr.road, addr.house_number, addr.postcode, addr.city || addr.town].filter(Boolean);
      setLocationAddress(parts.join(' ') || data.display_name?.split(',').slice(0, 2).join(',') || 'Position sélectionnée');
    } catch {}
  };

  const pickImages = async () => {
    if (images.length >= 10) { Alert.alert('Maximum', '10 images maximum'); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission', 'Accès à la galerie requis'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: 'images' as any,
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

    if (scheduleType === 'once' && !eventDateTime) {
      Alert.alert('Date requise', 'Sélectionnez une date et une heure.'); return;
    }
    if (scheduleType === 'recurring') {
      if (recurringDay === null) { Alert.alert('Jour requis', 'Sélectionnez un jour de récurrence.'); return; }
      if (!recurringTime) { Alert.alert('Heure requise', 'Sélectionnez une heure de récurrence.'); return; }
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
        images: [],
      };
      if (scheduleType === 'once' && eventDateTime) {
        payload.event_date = eventDateTime.toISOString();
      }
      if (scheduleType === 'recurring' && recurringDay !== null && recurringTime) {
        payload.event_schedule = {
          type: 'weekly',
          day: recurringDay,
          time: fmtTime(recurringTime),
        };
      }

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
          {/* ── 1. Images ─────────────────────────────────── */}
          <View style={st.section}>
            <View style={st.rowBetween}>
              <Text style={st.label}>Photos</Text>
              <Text style={st.hint}>{images.length}/10</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <TouchableOpacity style={st.imgAdd} onPress={pickImages} testID="add-image-btn">
                <Ionicons name="add" size={28} color={Colors.primary} />
                <Text style={st.imgAddText}>Ajouter</Text>
              </TouchableOpacity>
              {images.map((uri, idx) => (
                <View key={idx} style={st.imgThumb}>
                  <Image source={{ uri }} style={st.imgThumbImg} />
                  {idx === 0 && (
                    <View style={st.imgMainBadge}><Text style={st.imgMainBadgeText}>Photo principale</Text></View>
                  )}
                  <TouchableOpacity style={st.imgRemove} onPress={() => removeImage(idx)}>
                    <Ionicons name="close-circle" size={20} color={Colors.destructive} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>

          {/* ── 2. Titre ────────────────────────────────── */}
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

          {/* ── 3. Description ──────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Description</Text>
            <RichTextInput
              value={description}
              onChangeText={setDescription}
              placeholder="Décrivez l'activité, le niveau requis…"
              maxLength={500}
              testID="description-input"
            />
            <Text style={st.charCount}>{description.length}/500</Text>
          </View>

          {/* ── 4. Domaine ──────────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Domaine</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {domains.map(d => {
                const isSelected = domainId === d.domain_id;
                const col = d.color || Colors.primary;
                return (
                  <TouchableOpacity
                    key={d.domain_id}
                    style={[st.domainPill, isSelected && { backgroundColor: col + '22', borderColor: col }]}
                    onPress={() => setDomainId(d.domain_id)}
                    testID={`domain-${d.domain_id}`}
                  >
                    <Text style={[st.domainText, isSelected && { color: col, fontWeight: '700' }]}>
                      {lang === 'fr' ? d.label_fr : d.label_en}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* ── 5. Tags ─────────────────────────────────── */}
          <View style={st.section}>
            <View style={st.rowBetween}>
              <Text style={st.label}>Tags</Text>
              {selectedTagIds.length > 0 && (
                <Text style={st.hint}>{selectedTagIds.length} sélectionné{selectedTagIds.length > 1 ? 's' : ''}</Text>
              )}
            </View>
            <TouchableOpacity style={st.tagTrigger} onPress={() => setShowTagModal(true)} testID="open-tags-btn">
              {selectedTags.length === 0 ? (
                <View style={st.tagTriggerEmpty}>
                  <Ionicons name="pricetags-outline" size={18} color={Colors.muted} />
                  <Text style={st.tagTriggerText}>Choisir des tags</Text>
                </View>
              ) : (
                <View style={st.tagRow}>
                  {selectedTags.slice(0, 5).map(tag => {
                    const col = tagColor(tag.category_id);
                    return (
                      <View key={tag.tag_id} style={[st.tagPill, { backgroundColor: col + '22', borderColor: col }]}>
                        <Text style={[st.tagPillText, { color: col }]}>
                          {lang === 'fr' ? tag.label_fr : tag.label_en}
                        </Text>
                      </View>
                    );
                  })}
                  {selectedTags.length > 5 && <Text style={st.tagMore}>+{selectedTags.length - 5}</Text>}
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
          </View>

          {/* ── 6. Précision ────────────────────────────── */}
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
                    <Text style={[st.precisionLabel, active && { color: Colors.primary }]}>{p.label}</Text>
                    <Text style={st.precisionDesc}>{p.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── 7. Localisation ─────────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Localisation</Text>
            <TouchableOpacity
              style={st.locationRow}
              onPress={() => setShowLocationModal(true)}
              testID="open-location-btn"
            >
              <Ionicons name="location" size={18} color={Colors.primary} />
              <Text style={st.locationText} numberOfLines={2}>{locationAddress}</Text>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <View style={st.mapWrap}>
              <MapViewComponent
                key={`${selectedLat}-${selectedLng}-${precision}`}
                centerLat={selectedLat}
                centerLng={selectedLng}
                zoom={precisionRadius >= 1000 ? 14 : precisionRadius >= 100 ? 16 : 17}
                selectable={false}
                showUserMarker={false}
                selectedLat={selectedLat}
                selectedLng={selectedLng}
                pins={precisionRadius === 0 ? [{ id: 'pin', lat: selectedLat, lng: selectedLng, title: locationAddress, color: Colors.primary }] : []}
                precisionRadius={precisionRadius}
              />
            </View>
            {precisionRadius > 0 && (
              <View style={st.infoRow}>
                <Ionicons name="information-circle-outline" size={13} color={Colors.muted} />
                <Text style={st.infoText}>Lieu approximatif ({precisionRadius >= 1000 ? '1 km' : '100 m'})</Text>
              </View>
            )}
          </View>

          {/* ── 8. Date & Horaire ───────────────────────── */}
          <View style={st.section}>
            <Text style={st.label}>Date & Horaire</Text>
            <View style={st.scheduleRow}>
              {(['none', 'once', 'recurring'] as const).map(type => {
                const active = scheduleType === type;
                const icons = { none: 'remove-circle-outline', once: 'calendar-outline', recurring: 'repeat-outline' } as const;
                const labels = { none: 'Sans date', once: 'Date unique', recurring: 'Récurrent' };
                return (
                  <TouchableOpacity
                    key={type}
                    style={[st.scheduleBtn, active && st.scheduleBtnActive]}
                    onPress={() => setScheduleType(type)}
                    testID={`schedule-${type}`}
                  >
                    <Ionicons name={icons[type]} size={20} color={active ? Colors.primary : Colors.muted} />
                    <Text style={[st.scheduleBtnText, active && { color: Colors.primary }]}>{labels[type]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {scheduleType === 'once' && (
              <View style={st.scheduleCard}>
                <TouchableOpacity
                  style={st.datePickerBtn}
                  onPress={() => setShowDateTimePicker(true)}
                  testID="open-datetime-picker"
                >
                  <Ionicons name="calendar" size={20} color={eventDateTime ? Colors.primary : Colors.muted} />
                  <View style={{ flex: 1 }}>
                    {eventDateTime ? (
                      <>
                        <Text style={st.datePickerValue}>{fmtDate(eventDateTime)}</Text>
                        <Text style={st.datePickerSub}>à {fmtTime(eventDateTime)}</Text>
                      </>
                    ) : (
                      <Text style={st.datePickerPlaceholder}>Choisir une date et une heure</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                </TouchableOpacity>
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
                <Text style={[st.scheduleCardLabel, { marginTop: Spacing.sm }]}>Heure</Text>
                <TouchableOpacity
                  style={st.datePickerBtn}
                  onPress={() => setShowTimePicker(true)}
                  testID="open-time-picker"
                >
                  <Ionicons name="time-outline" size={20} color={recurringTime ? Colors.primary : Colors.muted} />
                  <Text style={recurringTime ? st.datePickerValue : st.datePickerPlaceholder}>
                    {recurringTime ? fmtTime(recurringTime) : 'Choisir une heure'}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── Submit button ──────────────────────────── */}
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

      {/* ── Location Modal ─────────────────────────────── */}
      <LocationPicker
        visible={showLocationModal}
        onClose={() => setShowLocationModal(false)}
        onSelect={(lat, lng, address) => {
          setSelectedLat(lat); setSelectedLng(lng); setLocationAddress(address);
        }}
        initialLat={selectedLat}
        initialLng={selectedLng}
        initialAddress={locationAddress}
      />

      {/* ── Date & Time Picker ──────────────────────────── */}
      <DateTimePickerModal
        visible={showDateTimePicker}
        onClose={() => setShowDateTimePicker(false)}
        onConfirm={(date) => { setEventDateTime(date); setShowDateTimePicker(false); }}
        initialDate={eventDateTime || undefined}
        mode="datetime"
        minDate={new Date()}
      />

      {/* ── Time Picker (recurring) ─────────────────────── */}
      <DateTimePickerModal
        visible={showTimePicker}
        onClose={() => setShowTimePicker(false)}
        onConfirm={(date) => { setRecurringTime(date); setShowTimePicker(false); }}
        initialDate={recurringTime || undefined}
        mode="time"
      />

      {/* ── Tag Selector Modal ──────────────────────────── */}
      <Modal visible={showTagModal} animationType="slide" transparent onRequestClose={() => setShowTagModal(false)}>
        <View style={ms.overlay}>
          <TouchableOpacity style={ms.backdrop} activeOpacity={1} onPress={() => setShowTagModal(false)} />
          <View style={ms.sheet}>
            <View style={ms.sheetHandle} />
            {/* Header */}
            <View style={ms.modalHeader}>
              <TouchableOpacity onPress={() => setShowTagModal(false)}>
                <Text style={ms.cancelText}>Annuler</Text>
              </TouchableOpacity>
              <Text style={ms.modalTitle}>Choisir des tags</Text>
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

            {/* Selected count banner */}
            {selectedTagIds.length > 0 && (
              <View style={ms.selectedBanner}>
                <Text style={ms.selectedBannerText}>
                  {selectedTagIds.length} tag{selectedTagIds.length > 1 ? 's' : ''} sélectionné{selectedTagIds.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}

            {/* Content */}
            <ScrollView
              style={ms.scrollContent}
              contentContainerStyle={{ padding: Spacing.md, paddingBottom: 50 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {categories.filter(c => (c.tags || []).length > 0).map(cat => {
                const col = tagColor(cat.category_id);
                return (
                  <View key={cat.category_id} style={ms.catGroup}>
                    <View style={ms.catLabelRow}>
                      <View style={[ms.catDot, { backgroundColor: col }]} />
                      <Text style={ms.catLabel}>
                        {lang === 'fr' ? cat.label_fr : cat.label_en}
                      </Text>
                    </View>
                    <View style={ms.tagsWrap}>
                      {(cat.tags || []).map((tag: any) => {
                        const selected = selectedTagIds.includes(tag.tag_id);
                        return (
                          <TouchableOpacity
                            key={tag.tag_id}
                            style={[
                              ms.tagChip,
                              selected ? { backgroundColor: col + '22', borderColor: col } : {},
                            ]}
                            onPress={() => toggleTag(tag.tag_id)}
                            testID={`tag-chip-${tag.tag_id}`}
                          >
                            {selected && (
                              <Ionicons name="checkmark" size={12} color={col} style={{ marginRight: 3 }} />
                            )}
                            <Text style={[ms.tagChipText, selected && { color: col, fontWeight: '700' }]}>
                              {lang === 'fr' ? tag.label_fr : tag.label_en}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
              {categories.every(c => (c.tags || []).length === 0) && (
                <Text style={{ color: Colors.muted, textAlign: 'center', marginTop: 40 }}>
                  Aucun tag disponible pour ce domaine
                </Text>
              )}
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
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  required: { color: Colors.destructive },
  hint: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  charCount: { fontSize: 11, color: Colors.muted, textAlign: 'right', marginTop: 4 },

  input: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, fontSize: 15, color: Colors.foreground, borderWidth: 1, borderColor: Colors.border },
  inputMulti: { minHeight: 100, textAlignVertical: 'top' },

  // Images
  imgAdd: { width: IMG_SIZE + 10, height: IMG_SIZE + 10, borderRadius: Radius.md, backgroundColor: Colors.card, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  imgAddText: { fontSize: 11, color: Colors.muted, marginTop: 2 },
  imgThumb: { width: IMG_SIZE + 10, height: IMG_SIZE + 10, borderRadius: Radius.md, marginRight: 10, position: 'relative', overflow: 'hidden' },
  imgThumbImg: { width: '100%', height: '100%' },
  imgMainBadge: { position: 'absolute', bottom: 4, left: 4, backgroundColor: Colors.primary, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  imgMainBadgeText: { fontSize: 9, color: Colors.background, fontWeight: '700' },
  imgRemove: { position: 'absolute', top: 4, right: 4 },

  // Domains
  domainPill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border, marginRight: 8 },
  domainText: { fontSize: 13, fontWeight: '600', color: Colors.muted },

  // Tags trigger
  tagTrigger: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, minHeight: 52 },
  tagTriggerEmpty: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
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
  precisionDesc: { fontSize: 10, color: Colors.muted },

  // Location
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  locationText: { flex: 1, fontSize: 14, color: Colors.foreground },
  mapWrap: { height: 180, borderRadius: Radius.lg, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  infoText: { fontSize: 11, color: Colors.muted },

  // Schedule
  scheduleRow: { flexDirection: 'row', gap: 8, marginBottom: Spacing.md },
  scheduleBtn: { flex: 1, alignItems: 'center', gap: 5, padding: Spacing.sm, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border },
  scheduleBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '15' },
  scheduleBtnText: { fontSize: 11, fontWeight: '600', color: Colors.muted, textAlign: 'center' },
  scheduleCard: { backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.sm },
  scheduleCardLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  datePickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.background, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  datePickerValue: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  datePickerSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  datePickerPlaceholder: { fontSize: 15, color: Colors.muted },
  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dayBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.border },
  dayBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  dayTextActive: { color: Colors.background },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 16, marginTop: Spacing.sm },
  submitBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.65)' },

  sheet: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '80%',  // Fixed height so ScrollView works correctly
    overflow: 'hidden',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },

  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  cancelText: { fontSize: 14, color: Colors.muted, minWidth: 50 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground, flex: 1, textAlign: 'center' },
  clearText: { fontSize: 13, color: Colors.destructive, fontWeight: '600' },

  selectedBanner: { paddingHorizontal: Spacing.lg, paddingVertical: 8, backgroundColor: Colors.primary + '15', borderBottomWidth: 1, borderBottomColor: Colors.border },
  selectedBannerText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  scrollContent: { flex: 1 },

  catGroup: { marginBottom: Spacing.xl || 24 },
  catLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground, textTransform: 'uppercase', letterSpacing: 0.8 },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tagChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  tagChipText: { fontSize: 13, fontWeight: '500', color: Colors.foreground },
});
