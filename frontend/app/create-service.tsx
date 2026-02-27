import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MapViewComponent } from '../components/MapViewComponent';
import { DomainPill } from '../components/DomainPill';
import { TagSelector } from '../components/TagSelector';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { Colors, Spacing, Radius } from '../constants/Colors';
import * as Location from 'expo-location';

// ─── Constants ────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';

const STEP_LABELS = ['Infos', 'Sport', 'Lieux', 'Créneaux', 'Résumé'];
const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DURATIONS = ['30', '45', '60', '90', '120'];
const PRECISION_OPTIONS: { value: 'exact' | '100m' | '1000m'; label: string }[] = [
  { value: 'exact', label: 'Précis' },
  { value: '100m', label: '± 100m' },
  { value: '1000m', label: '± 1km' },
];
const PRECISION_LABEL: Record<string, string> = { exact: 'Précis', '100m': '± 100m', '1000m': '± 1km' };

// ─── Types ────────────────────────────────────────────────────────────────────
type ServiceLocation = {
  id: string;
  lat: number;
  lng: number;
  precision: 'exact' | '100m' | '1000m';
  description: string;
};

type ServiceSlot = {
  id: string;
  day: number;
  start: string;
  end: string;
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CreateServiceScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLang();
  const scrollRef = useRef<ScrollView>(null);

  const [step, setStep] = useState(1);

  // Step 1
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('60');
  const [maxParticipants, setMaxParticipants] = useState('1');

  // Step 2
  const [domains, setDomains] = useState<any[]>([]);
  const [selectedDomain, setSelectedDomain] = useState('');
  const [tags, setTags] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Step 3 – Locations
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [addingLoc, setAddingLoc] = useState(false);
  const [newLocLat, setNewLocLat] = useState<number | null>(null);
  const [newLocLng, setNewLocLng] = useState<number | null>(null);
  const [newLocPrecision, setNewLocPrecision] = useState<'exact' | '100m' | '1000m'>('exact');
  const [newLocDesc, setNewLocDesc] = useState('');
  const [mapCenterLat, setMapCenterLat] = useState(48.8566);
  const [mapCenterLng, setMapCenterLng] = useState(2.3522);

  // Step 4 – Slots
  const [slots, setSlots] = useState<ServiceSlot[]>([]);
  const [addingSlot, setAddingSlot] = useState(false);
  const [newSlotDay, setNewSlotDay] = useState(0);
  const [newSlotStart, setNewSlotStart] = useState('');
  const [newSlotEnd, setNewSlotEnd] = useState('');

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'coach' && user.role !== 'admin') {
      Alert.alert('', 'Rôle Coach requis pour créer un service');
      setTimeout(() => {
        if (router.canGoBack()) router.back();
        else router.replace('/(tabs)/profile' as any);
      }, 100);
      return;
    }
    loadDomains();
    getUserLocation();
  }, [user]);

  useEffect(() => {
    if (selectedDomain) loadTags(selectedDomain);
  }, [selectedDomain]);

  const loadDomains = async () => {
    try {
      const doms = await api.get('/domains');
      setDomains(doms);
      const coaching = doms.find((d: any) => d.name === 'coaching');
      setSelectedDomain(coaching?.domain_id || doms[0]?.domain_id || '');
    } catch {}
  };

  const getUserLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const loc = await Location.getCurrentPositionAsync({});
      setMapCenterLat(loc.coords.latitude);
      setMapCenterLng(loc.coords.longitude);
    }
  };

  const loadTags = async (domainId: string) => {
    try {
      const [tgs, cats] = await Promise.all([
        api.get(`/tags?domain_id=${domainId}`),
        api.get(`/tags/categories?domain_id=${domainId}`),
      ]);
      setTags(tgs || []);
      setCategories(cats || []);
      setSelectedTags([]);
    } catch {}
  };

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: true });

  const goNext = () => {
    if (step === 1) {
      if (!title.trim()) { Alert.alert('', 'Le titre est requis'); return; }
      const p = parseFloat(price);
      if (!price || isNaN(p) || p <= 0) { Alert.alert('', 'Entrez un prix valide (> 0)'); return; }
    }
    if (step === 2 && !selectedDomain) { Alert.alert('', 'Sélectionnez un domaine'); return; }
    setStep(s => Math.min(s + 1, 5));
    scrollTop();
  };

  const goPrev = () => { setStep(s => Math.max(s - 1, 1)); scrollTop(); };

  const addLocation = () => {
    if (!newLocLat || !newLocLng) { Alert.alert('', 'Sélectionnez un point sur la carte'); return; }
    setLocations(prev => [...prev, {
      id: `loc_${Date.now()}`,
      lat: newLocLat,
      lng: newLocLng,
      precision: newLocPrecision,
      description: newLocDesc.trim(),
    }]);
    setNewLocLat(null); setNewLocLng(null);
    setNewLocPrecision('exact'); setNewLocDesc('');
    setAddingLoc(false);
  };

  const addSlot = () => {
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!newSlotStart || !newSlotEnd) { Alert.alert('', 'Renseignez les horaires'); return; }
    if (!timeRegex.test(newSlotStart) || !timeRegex.test(newSlotEnd)) {
      Alert.alert('', 'Format HH:MM requis (ex: 09:00)'); return;
    }
    if (newSlotStart >= newSlotEnd) { Alert.alert('', "L'heure de fin doit être après l'heure de début"); return; }
    setSlots(prev => [...prev, {
      id: `slot_${Date.now()}`,
      day: newSlotDay,
      start: newSlotStart,
      end: newSlotEnd,
    }]);
    setNewSlotStart(''); setNewSlotEnd('');
    setAddingSlot(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await api.post('/services', {
        title: title.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        duration_min: parseInt(duration) || 60,
        max_participants: parseInt(maxParticipants) || 1,
        domain_id: selectedDomain,
        tag_ids: selectedTags,
        locations: locations.map(l => ({
          latitude: l.lat, longitude: l.lng,
          precision: l.precision, description: l.description || null,
        })),
        slots: slots.map(s => ({
          day_of_week: s.day, start_time: s.start, end_time: s.end,
        })),
      });
      Alert.alert('Service publié !', 'Votre service est maintenant visible.', [
        { text: 'Voir mon profil', onPress: () => router.replace('/(tabs)/profile') },
      ]);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le service');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render: Step header ─────────────────────────────────────────────────
  const renderStepHeader = () => (
    <View style={s.stepHeader}>
      {STEP_LABELS.map((label, idx) => {
        const num = idx + 1;
        const done = step > num;
        const active = step === num;
        return (
          <React.Fragment key={num}>
            {idx > 0 && <View style={[s.stepLine, done && s.stepLineDone]} />}
            <View style={s.stepItem}>
              <View style={[s.stepCircle, active && s.stepCircleActive, done && s.stepCircleDone]}>
                {done
                  ? <Ionicons name="checkmark" size={13} color={Colors.background} />
                  : <Text style={[s.stepNum, active && s.stepNumActive]}>{num}</Text>
                }
              </View>
              <Text style={[s.stepLabel, active && s.stepLabelActive]}>{label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );

  // ─── Step 1: Informations ────────────────────────────────────────────────
  const renderStep1 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Informations de base</Text>

      <View style={s.field}>
        <Text style={s.fieldLabel}>Titre du service *</Text>
        <TextInput style={s.input} value={title} onChangeText={setTitle}
          placeholder="Ex: Coaching running personnalisé"
          placeholderTextColor={Colors.muted} testID="service-title-input" />
      </View>

      <View style={s.field}>
        <Text style={s.fieldLabel}>Description</Text>
        <TextInput style={[s.input, s.inputMulti]} value={description} onChangeText={setDescription}
          placeholder="Décrivez votre service, ce qui est inclus…"
          placeholderTextColor={Colors.muted} multiline numberOfLines={4}
          textAlignVertical="top" testID="service-desc-input" />
      </View>

      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Prix (€) / séance *</Text>
          <TextInput style={s.input} value={price} onChangeText={setPrice}
            placeholder="60" placeholderTextColor={Colors.muted}
            keyboardType="decimal-pad" testID="service-price-input" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Participants max</Text>
          <TextInput style={s.input} value={maxParticipants} onChangeText={setMaxParticipants}
            placeholder="1" placeholderTextColor={Colors.muted}
            keyboardType="number-pad" testID="service-max-input" />
        </View>
      </View>

      <View style={s.field}>
        <Text style={s.fieldLabel}>Durée par séance</Text>
        <View style={s.chips}>
          {DURATIONS.map(d => (
            <TouchableOpacity key={d} style={[s.chip, duration === d && s.chipActive]}
              onPress={() => setDuration(d)} testID={`duration-${d}`}>
              <Text style={[s.chipText, duration === d && s.chipTextActive]}>{d} min</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {price && !isNaN(parseFloat(price)) && parseFloat(price) > 0 && (
        <View style={s.infoNote}>
          <Ionicons name="information-circle-outline" size={14} color={ORANGE} />
          <Text style={s.infoNoteText}>
            Commission 15% · Votre gain net : {(parseFloat(price) * 0.85).toFixed(2)}€/séance
          </Text>
        </View>
      )}
    </View>
  );

  // ─── Step 2: Sport & Tags ─────────────────────────────────────────────────
  const renderStep2 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Sport & Spécialité</Text>

      <View style={s.field}>
        <Text style={s.fieldLabel}>Domaine *</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {domains.map(d => (
            <DomainPill key={d.domain_id} domain={d}
              selected={selectedDomain === d.domain_id}
              onPress={() => setSelectedDomain(d.domain_id)} lang={lang} />
          ))}
        </ScrollView>
      </View>

      {tags.length > 0 && (
        <View style={s.field}>
          <Text style={s.fieldLabel}>Tags (optionnel)</Text>
          <TagSelector tags={tags} categories={categories} selectedIds={selectedTags}
            onToggle={id => setSelectedTags(prev =>
              prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
            )} lang={lang} maxSelect={5} />
        </View>
      )}
    </View>
  );

  // ─── Step 3: Lieux ────────────────────────────────────────────────────────
  const renderStep3 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Lieux d'intervention</Text>
      <Text style={s.stepHint}>Ajoutez tous les endroits où vous exercez ce service</Text>

      {locations.map((loc, i) => (
        <View key={loc.id} style={s.itemCard} testID={`location-item-${loc.id}`}>
          <View style={s.itemIconBox}>
            <Ionicons name="location" size={16} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemTitle}>{loc.description || `Lieu ${i + 1}`}</Text>
            <Text style={s.itemMeta}>{PRECISION_LABEL[loc.precision]} · {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</Text>
          </View>
          <TouchableOpacity onPress={() => setLocations(prev => prev.filter(l => l.id !== loc.id))}
            testID={`remove-loc-${loc.id}`}>
            <Ionicons name="trash-outline" size={18} color={Colors.destructive} />
          </TouchableOpacity>
        </View>
      ))}

      {addingLoc ? (
        <View style={s.addCard}>
          <Text style={s.addCardTitle}>Nouveau lieu</Text>
          <Text style={s.hint}>Appuyez sur la carte pour sélectionner la position</Text>
          <View style={s.mapWrap}>
            <MapViewComponent centerLat={mapCenterLat} centerLng={mapCenterLng} zoom={13}
              selectable showUserMarker
              selectedLat={newLocLat ?? undefined} selectedLng={newLocLng ?? undefined}
              onMapPress={(lat, lng) => { setNewLocLat(lat); setNewLocLng(lng); }}
              style={{ flex: 1 }} />
          </View>
          {newLocLat && newLocLng && (
            <Text style={s.coordsText}>
              {newLocLat.toFixed(5)}, {newLocLng.toFixed(5)}
            </Text>
          )}
          <Text style={[s.fieldLabel, { marginTop: 12 }]}>Précision</Text>
          <View style={s.chips}>
            {PRECISION_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value}
                style={[s.chip, newLocPrecision === opt.value && s.chipActive]}
                onPress={() => setNewLocPrecision(opt.value)}
                testID={`precision-${opt.value}`}>
                <Text style={[s.chipText, newLocPrecision === opt.value && s.chipTextActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[s.fieldLabel, { marginTop: 12 }]}>Description du lieu</Text>
          <TextInput style={s.input} value={newLocDesc} onChangeText={setNewLocDesc}
            placeholder="Ex: Parc de la Villette, entrée Nord"
            placeholderTextColor={Colors.muted} testID="new-loc-desc-input" />
          <View style={s.addCardActions}>
            <TouchableOpacity style={s.cancelBtn}
              onPress={() => { setAddingLoc(false); setNewLocLat(null); setNewLocLng(null); }}>
              <Text style={s.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.confirmBtn, !newLocLat && s.disabledBtn]}
              onPress={addLocation} disabled={!newLocLat} testID="confirm-loc-btn">
              <Text style={s.confirmBtnText}>Valider ce lieu</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        locations.length < 5 && (
          <TouchableOpacity style={s.addBtn} onPress={() => setAddingLoc(true)}
            testID="add-location-btn">
            <Ionicons name="add-circle-outline" size={20} color={ORANGE} />
            <Text style={s.addBtnText}>Ajouter un lieu</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );

  // ─── Step 4: Créneaux ─────────────────────────────────────────────────────
  const renderStep4 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Créneaux récurrents</Text>
      <Text style={s.stepHint}>Définissez vos disponibilités hebdomadaires</Text>

      {slots.map(slot => (
        <View key={slot.id} style={s.itemCard} testID={`slot-item-${slot.id}`}>
          <View style={s.itemIconBox}>
            <Ionicons name="time" size={16} color={ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemTitle}>{DAYS_FR[slot.day]}</Text>
            <Text style={s.itemMeta}>{slot.start} → {slot.end}</Text>
          </View>
          <TouchableOpacity onPress={() => setSlots(prev => prev.filter(s => s.id !== slot.id))}
            testID={`remove-slot-${slot.id}`}>
            <Ionicons name="trash-outline" size={18} color={Colors.destructive} />
          </TouchableOpacity>
        </View>
      ))}

      {addingSlot ? (
        <View style={s.addCard}>
          <Text style={s.addCardTitle}>Nouveau créneau</Text>
          <Text style={s.fieldLabel}>Jour de la semaine</Text>
          <View style={[s.chips, { flexWrap: 'wrap' }]}>
            {DAYS_FR.map((day, i) => (
              <TouchableOpacity key={i}
                style={[s.chip, newSlotDay === i && s.chipActive]}
                onPress={() => setNewSlotDay(i)} testID={`day-${i}`}>
                <Text style={[s.chipText, newSlotDay === i && s.chipTextActive]}>{day}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={[s.row, { marginTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Heure de début</Text>
              <TextInput style={s.input} value={newSlotStart} onChangeText={setNewSlotStart}
                placeholder="09:00" placeholderTextColor={Colors.muted}
                keyboardType="numbers-and-punctuation" testID="slot-start-input" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.fieldLabel}>Heure de fin</Text>
              <TextInput style={s.input} value={newSlotEnd} onChangeText={setNewSlotEnd}
                placeholder="10:00" placeholderTextColor={Colors.muted}
                keyboardType="numbers-and-punctuation" testID="slot-end-input" />
            </View>
          </View>
          <View style={s.addCardActions}>
            <TouchableOpacity style={s.cancelBtn}
              onPress={() => { setAddingSlot(false); setNewSlotStart(''); setNewSlotEnd(''); }}>
              <Text style={s.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.confirmBtn} onPress={addSlot} testID="confirm-slot-btn">
              <Text style={s.confirmBtnText}>Ajouter ce créneau</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={s.addBtn} onPress={() => setAddingSlot(true)}
          testID="add-slot-btn">
          <Ionicons name="add-circle-outline" size={20} color={ORANGE} />
          <Text style={s.addBtnText}>Ajouter un créneau</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ─── Step 5: Résumé ───────────────────────────────────────────────────────
  const renderStep5 = () => {
    const domainObj = domains.find(d => d.domain_id === selectedDomain);
    return (
      <View style={s.stepContent}>
        <Text style={s.stepTitle}>Résumé & Publication</Text>

        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>{title}</Text>
          {description ? <Text style={s.summaryDesc}>{description}</Text> : null}
          <View style={s.summaryMeta}>
            <View style={s.summaryMetaItem}>
              <Ionicons name="pricetag-outline" size={14} color={ORANGE} />
              <Text style={s.summaryMetaText}>{price}€ / séance</Text>
            </View>
            <View style={s.summaryMetaItem}>
              <Ionicons name="time-outline" size={14} color={ORANGE} />
              <Text style={s.summaryMetaText}>{duration} min</Text>
            </View>
            <View style={s.summaryMetaItem}>
              <Ionicons name="people-outline" size={14} color={ORANGE} />
              <Text style={s.summaryMetaText}>{maxParticipants} pers. max</Text>
            </View>
            {domainObj && (
              <View style={s.summaryMetaItem}>
                <Ionicons name="fitness-outline" size={14} color={ORANGE} />
                <Text style={s.summaryMetaText}>{domainObj.label_fr}</Text>
              </View>
            )}
          </View>
        </View>

        {locations.length > 0 && (
          <View style={s.summarySection}>
            <Text style={s.summarySectionTitle}>Lieux ({locations.length})</Text>
            {locations.map((loc, i) => (
              <Text key={loc.id} style={s.summarySectionItem}>
                • {loc.description || `Lieu ${i + 1}`} — {PRECISION_LABEL[loc.precision]}
              </Text>
            ))}
          </View>
        )}

        {slots.length > 0 && (
          <View style={s.summarySection}>
            <Text style={s.summarySectionTitle}>Créneaux ({slots.length})</Text>
            {slots.map(slot => (
              <Text key={slot.id} style={s.summarySectionItem}>
                • {DAYS_FR[slot.day]} : {slot.start} → {slot.end}
              </Text>
            ))}
          </View>
        )}

        {locations.length === 0 && (
          <View style={s.warnNote}>
            <Ionicons name="warning-outline" size={14} color={Colors.warning} />
            <Text style={s.warnText}>
              Aucun lieu ajouté — votre service ne sera pas trouvable via la recherche géographique.
            </Text>
          </View>
        )}

        {slots.length === 0 && (
          <View style={s.warnNote}>
            <Ionicons name="warning-outline" size={14} color={Colors.warning} />
            <Text style={s.warnText}>
              Aucun créneau ajouté — ajoutez vos disponibilités pour faciliter les réservations.
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.publishBtn, submitting && s.disabledBtn]}
          onPress={handleSubmit} disabled={submitting}
          testID="create-service-submit-btn">
          {submitting
            ? <ActivityIndicator color={Colors.background} />
            : <>
              <Ionicons name="rocket-outline" size={18} color={Colors.background} />
              <Text style={s.publishBtnText}>Publier mon service</Text>
            </>
          }
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity style={s.headerBackBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Créer un service</Text>
        <View style={{ width: 40 }} />
      </View>

      {renderStepHeader()}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView ref={scrollRef} style={{ flex: 1 }}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
        </ScrollView>

        {/* Bottom Nav */}
        {step < 5 && (
          <View style={s.bottomNav}>
            {step > 1 ? (
              <TouchableOpacity style={s.prevBtn} onPress={goPrev} testID="prev-step-btn">
                <Ionicons name="chevron-back" size={18} color={Colors.foreground} />
                <Text style={s.prevBtnText}>Précédent</Text>
              </TouchableOpacity>
            ) : <View style={{ flex: 1 }} />}
            <TouchableOpacity style={s.nextBtn} onPress={goNext} testID="next-step-btn">
              <Text style={s.nextBtnText}>{step === 4 ? 'Voir le résumé' : 'Suivant'}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.background} />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },

  // Stepper
  stepHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: Spacing.xs,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  stepItem: { alignItems: 'center', gap: 4 },
  stepLine: { width: 20, height: 2, backgroundColor: Colors.border, marginBottom: 16 },
  stepLineDone: { backgroundColor: ORANGE },
  stepCircle: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 2,
    borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  stepCircleActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  stepCircleDone: { borderColor: ORANGE, backgroundColor: ORANGE },
  stepNum: { fontSize: 12, fontWeight: '700', color: Colors.muted },
  stepNumActive: { color: ORANGE },
  stepLabel: { fontSize: 9, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  stepLabelActive: { color: ORANGE },

  // Content
  scrollContent: { paddingBottom: 20 },
  stepContent: { padding: Spacing.md, gap: 16 },
  stepTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  stepHint: { fontSize: 13, color: Colors.muted, marginTop: -8 },

  // Fields
  field: { gap: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: Colors.foreground,
  },
  inputMulti: { minHeight: 100 },
  row: { flexDirection: 'row', gap: Spacing.sm },

  // Chips
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  chipTextActive: { color: ORANGE },

  // Info note
  infoNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE_LIGHT, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  infoNoteText: { fontSize: 12, color: ORANGE, flex: 1 },

  // Item cards (locations + slots)
  itemCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: Radius.lg,
    padding: 14, borderWidth: 1, borderColor: Colors.border,
  },
  itemIconBox: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: ORANGE_LIGHT,
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitle: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  itemMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },

  // Add form card
  addCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: ORANGE_BORDER, gap: 8,
  },
  addCardTitle: { fontSize: 15, fontWeight: '700', color: ORANGE, marginBottom: 2 },
  hint: { fontSize: 12, color: Colors.muted },
  mapWrap: { height: 200, borderRadius: Radius.lg, overflow: 'hidden' },
  coordsText: { fontSize: 12, color: ORANGE, fontWeight: '600' },
  addCardActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 11, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  confirmBtn: {
    flex: 2, paddingVertical: 11, borderRadius: Radius.full,
    backgroundColor: ORANGE, alignItems: 'center',
  },
  disabledBtn: { opacity: 0.4 },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },

  // Add button
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, borderRadius: Radius.lg, borderWidth: 1.5,
    borderStyle: 'dashed', borderColor: ORANGE_BORDER,
  },
  addBtnText: { fontSize: 14, fontWeight: '700', color: ORANGE },

  // Summary
  summaryCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: ORANGE_BORDER, gap: 8,
  },
  summaryTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  summaryDesc: { fontSize: 14, color: Colors.muted, lineHeight: 20 },
  summaryMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  summaryMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryMetaText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  summarySection: { gap: 6 },
  summarySectionTitle: { fontSize: 14, fontWeight: '700', color: ORANGE },
  summarySectionItem: { fontSize: 13, color: Colors.muted, paddingLeft: 4 },
  warnNote: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: 'rgba(255,149,0,0.06)', borderRadius: Radius.md,
    padding: 10, borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  warnText: { fontSize: 12, color: Colors.warning, flex: 1, lineHeight: 17 },

  // Publish button
  publishBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: ORANGE, borderRadius: Radius.full, paddingVertical: 16, marginTop: 8,
  },
  publishBtnText: { fontSize: 16, fontWeight: '800', color: Colors.background },

  // Bottom nav
  bottomNav: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  prevBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  prevBtnText: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  nextBtn: {
    flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.full, backgroundColor: ORANGE,
  },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
