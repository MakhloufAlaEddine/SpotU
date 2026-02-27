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
const GREEN = '#1DBF73';

const STEP_LABELS = ['Infos', 'Sport', 'Lieux', 'Créneaux', 'Résumé'];
const DAYS_FR = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DAYS_FULL = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const DURATIONS = ['30', '45', '60', '90', '120'];
const HOURS = Array.from({ length: 19 }, (_, i) => String(i + 5).padStart(2, '0')); // 05-23
const MINUTES = ['00', '15', '30', '45'];
const PRECISION_OPTIONS: { value: 'exact' | '100m' | '1000m'; label: string; hint: string }[] = [
  { value: 'exact', label: 'Précis', hint: 'Adresse exacte visible' },
  { value: '100m', label: '± 100m', hint: 'Quartier visible' },
  { value: '1000m', label: '± 1km', hint: 'Zone visible' },
];
const PRECISION_RADIUS: Record<string, number> = { exact: 0, '100m': 100, '1000m': 1000 };
const PRECISION_LABEL: Record<string, string> = { exact: 'Précis', '100m': '± 100m', '1000m': '± 1km' };
const SLOT_TYPES = [
  { value: 'recurring', label: 'Récurrent', icon: 'repeat', hint: 'Ex: tous les lundis 09h-10h' },
  { value: 'single', label: 'Date unique', icon: 'calendar', hint: 'Une séance précise' },
  { value: 'availability', label: 'Disponibilité', icon: 'time', hint: 'Plage horaire, client fixe l\'heure' },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type SlotType = 'recurring' | 'single' | 'availability';
type ServiceSlot = {
  id: string; type: SlotType;
  day?: number; start: string; end: string; date?: string;
};
type ServiceLocation = {
  id: string; lat: number; lng: number;
  precision: 'exact' | '100m' | '1000m'; description: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatSlotLabel(slot: ServiceSlot): string {
  if (slot.type === 'single') {
    const d = slot.date ? new Date(slot.date + 'T00:00:00') : null;
    const dateStr = d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) : '??';
    return `${dateStr}  ·  ${slot.start} → ${slot.end}`;
  }
  const dayLabel = slot.day !== undefined ? DAYS_FR[slot.day] : '?';
  if (slot.type === 'availability') return `${dayLabel}  ·  ${slot.start} → ${slot.end}  (sur rdv)`;
  return `${dayLabel}  ·  ${slot.start} → ${slot.end}`;
}

function slotIcon(type: SlotType): any {
  return type === 'single' ? 'calendar' : type === 'availability' ? 'time' : 'repeat';
}

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
  const [newSlotType, setNewSlotType] = useState<SlotType>('recurring');
  const [newSlotDay, setNewSlotDay] = useState(0);
  const [newSlotDate, setNewSlotDate] = useState('');
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

  useEffect(() => { if (selectedDomain) loadTags(selectedDomain); }, [selectedDomain]);

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
      lat: newLocLat, lng: newLocLng,
      precision: newLocPrecision, description: newLocDesc.trim(),
    }]);
    setNewLocLat(null); setNewLocLng(null);
    setNewLocPrecision('exact'); setNewLocDesc('');
    setAddingLoc(false);
  };

  const [slotError, setSlotError] = useState('');

  const addSlot = () => {
    if (!newSlotStart || !newSlotEnd) { setSlotError('Sélectionnez les horaires de début et de fin'); return; }
    if (newSlotStart >= newSlotEnd) { setSlotError("L'heure de fin doit être après l'heure de début"); return; }
    if (newSlotType === 'single' && !newSlotDate) { setSlotError('Sélectionnez une date'); return; }
    setSlotError('');
    setSlots(prev => [...prev, {
      id: `slot_${Date.now()}`, type: newSlotType,
      day: newSlotType !== 'single' ? newSlotDay : undefined,
      start: newSlotStart, end: newSlotEnd,
      date: newSlotType === 'single' ? newSlotDate : undefined,
    }]);
    setNewSlotStart(''); setNewSlotEnd(''); setNewSlotDate('');
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
          slot_type: s.type,
          day_of_week: s.day !== undefined ? s.day : null,
          start_time: s.start, end_time: s.end,
          slot_date: s.date || null,
        })),
      });
      router.replace('/(tabs)/profile' as any);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de créer le service');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Time Picker ──────────────────────────────────────────────────────────
  const renderTimePicker = (
    value: string, onChange: (v: string) => void, label: string, testPrefix: string
  ) => {
    const [hh, mm] = value ? value.split(':') : ['', '00'];
    return (
      <View style={s.field}>
        <Text style={s.fieldLabel}>{label}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 6, paddingVertical: 4 }}>
            {HOURS.map(h => (
              <TouchableOpacity key={h}
                style={[s.timeChip, hh === h && s.timeChipActive]}
                onPress={() => onChange(`${h}:${mm || '00'}`)}
                testID={`${testPrefix}-h-${h}`}>
                <Text style={[s.timeChipText, hh === h && s.timeChipTextActive]}>{h}h</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
        {hh ? (
          <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
            {MINUTES.map(m => (
              <TouchableOpacity key={m}
                style={[s.minChip, (mm || '00') === m && s.minChipActive]}
                onPress={() => onChange(`${hh}:${m}`)}
                testID={`${testPrefix}-m-${m}`}>
                <Text style={[s.minChipText, (mm || '00') === m && s.minChipTextActive]}>:{m}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          <Text style={s.timeHint}>Sélectionnez une heure</Text>
        )}
      </View>
    );
  };

  // ─── Stepper Header ──────────────────────────────────────────────────────
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
                  : <Text style={[s.stepNum, active && s.stepNumActive]}>{num}</Text>}
              </View>
              <Text style={[s.stepLabel, active && s.stepLabelActive]}>{label}</Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );

  // ─── Step 1 ───────────────────────────────────────────────────────────────
  const renderStep1 = () => (
    <View style={s.stepContent}>
      <View style={s.motiveBanner}>
        <Ionicons name="trophy" size={18} color={ORANGE} />
        <Text style={s.motiveText}>
          Les services avec une belle description reçoivent <Text style={{ fontWeight: '800' }}>3× plus</Text> de demandes !
        </Text>
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Titre du service *</Text>
        <TextInput style={s.input} value={title} onChangeText={setTitle}
          placeholder="Ex : Coaching running — Du 5km au 10km en 8 semaines"
          placeholderTextColor={Colors.muted} testID="service-title-input" />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Description</Text>
        <TextInput style={[s.input, s.inputMulti]} value={description} onChangeText={setDescription}
          placeholder={'Décrivez votre parcours, votre méthode, ce que le client gagnera…\nEx : Coach certifié BPJEPS, 8 ans d\'exp., suivi personnalisé avec plan d\'entraînement.'}
          placeholderTextColor={Colors.muted} multiline numberOfLines={4}
          textAlignVertical="top" testID="service-desc-input" />
        {description.length > 0 && (
          <Text style={[s.charCount, description.length >= 80 ? s.charCountGood : s.charCountWarn]}>
            {description.length} car. {description.length >= 80 ? '✓ Excellente description' : '(80+ recommandé)'}
          </Text>
        )}
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
            Commission 15 % · Gain net : <Text style={{ fontWeight: '700' }}>{(parseFloat(price) * 0.85).toFixed(2)}€</Text> / séance
          </Text>
        </View>
      )}
    </View>
  );

  // ─── Step 2 ───────────────────────────────────────────────────────────────
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
          <Text style={s.fieldLabel}>Tags (jusqu'à 5)</Text>
          <TagSelector tags={tags} categories={categories} selectedIds={selectedTags}
            onToggle={id => setSelectedTags(prev =>
              prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
            )} lang={lang} maxSelect={5} />
        </View>
      )}
      {selectedTags.length === 0 && (
        <View style={s.tipNote}>
          <Ionicons name="pricetag-outline" size={14} color={Colors.muted} />
          <Text style={s.tipNoteText}>Les tags aident les sportifs à trouver votre service rapidement</Text>
        </View>
      )}
    </View>
  );

  // ─── Step 3 ───────────────────────────────────────────────────────────────
  const renderStep3 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Lieux d'intervention</Text>
      <Text style={s.stepHint}>Ajoutez jusqu'à 5 endroits où vous intervenez</Text>
      {locations.map((loc, i) => (
        <View key={loc.id} style={s.itemCard}>
          <View style={s.itemIconBox}><Ionicons name="location" size={16} color={ORANGE} /></View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemTitle}>{loc.description || `Lieu ${i + 1}`}</Text>
            <Text style={s.itemMeta}>{PRECISION_LABEL[loc.precision]} · {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}</Text>
          </View>
          <TouchableOpacity onPress={() => setLocations(prev => prev.filter(l => l.id !== loc.id))}>
            <Ionicons name="trash-outline" size={18} color={Colors.destructive} />
          </TouchableOpacity>
        </View>
      ))}
      {addingLoc ? (
        <View style={s.addCard}>
          <Text style={s.addCardTitle}>Nouveau lieu</Text>
          <Text style={s.hint}>Appuyez sur la carte pour sélectionner la position</Text>
          <View style={s.mapWrap}>
            <MapViewComponent
              centerLat={mapCenterLat} centerLng={mapCenterLng} zoom={13}
              selectable showUserMarker
              selectedLat={newLocLat ?? undefined} selectedLng={newLocLng ?? undefined}
              precisionRadius={PRECISION_RADIUS[newLocPrecision]}
              onMapPress={(lat, lng) => { setNewLocLat(lat); setNewLocLng(lng); }}
              style={{ flex: 1 }} />
          </View>
          {newLocLat && newLocLng && (
            <Text style={s.coordsText}>{newLocLat.toFixed(5)}, {newLocLng.toFixed(5)}</Text>
          )}
          <Text style={[s.fieldLabel, { marginTop: 12 }]}>Précision de l'adresse</Text>
          <View style={{ gap: 8 }}>
            {PRECISION_OPTIONS.map(opt => (
              <TouchableOpacity key={opt.value}
                style={[s.precisionCard, newLocPrecision === opt.value && s.precisionCardActive]}
                onPress={() => setNewLocPrecision(opt.value)}
                testID={`precision-${opt.value}`}>
                <View style={s.precisionCardLeft}>
                  <Ionicons name={opt.value === 'exact' ? 'locate' : opt.value === '100m' ? 'radio-button-on' : 'globe-outline'} size={16} color={newLocPrecision === opt.value ? ORANGE : Colors.muted} />
                  <Text style={[s.precisionCardLabel, newLocPrecision === opt.value && s.precisionCardLabelActive]}>{opt.label}</Text>
                </View>
                <Text style={s.precisionCardHint}>{opt.hint}</Text>
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
          <TouchableOpacity style={s.addBtn} onPress={() => setAddingLoc(true)} testID="add-location-btn">
            <Ionicons name="add-circle-outline" size={20} color={ORANGE} />
            <Text style={s.addBtnText}>Ajouter un lieu</Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );

  // ─── Step 4 ───────────────────────────────────────────────────────────────
  const renderStep4 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Disponibilités</Text>
      <Text style={s.stepHint}>Définissez vos créneaux et disponibilités</Text>
      {slots.map(slot => (
        <View key={slot.id} style={s.itemCard}>
          <View style={[s.itemIconBox, { backgroundColor: slot.type === 'single' ? 'rgba(29,191,115,0.12)' : slot.type === 'availability' ? 'rgba(90,100,220,0.12)' : ORANGE_LIGHT }]}>
            <Ionicons name={slotIcon(slot.type)} size={16} color={slot.type === 'single' ? GREEN : slot.type === 'availability' ? '#5A64DC' : ORANGE} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemMeta}>{SLOT_TYPES.find(t => t.value === slot.type)?.label}</Text>
            <Text style={s.itemTitle}>{formatSlotLabel(slot)}</Text>
          </View>
          <TouchableOpacity onPress={() => setSlots(prev => prev.filter(s => s.id !== slot.id))}>
            <Ionicons name="trash-outline" size={18} color={Colors.destructive} />
          </TouchableOpacity>
        </View>
      ))}
      {addingSlot ? (
        <View style={s.addCard}>
          <Text style={s.addCardTitle}>Nouveau créneau</Text>
          {/* Type selector */}
          <View style={{ gap: 8, marginBottom: 4 }}>
            {SLOT_TYPES.map(t => (
              <TouchableOpacity key={t.value}
                style={[s.slotTypeCard, newSlotType === t.value && s.slotTypeCardActive]}
                onPress={() => setNewSlotType(t.value as SlotType)}
                testID={`slot-type-${t.value}`}>
                <Ionicons name={t.icon as any} size={16} color={newSlotType === t.value ? ORANGE : Colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.slotTypeLabel, newSlotType === t.value && s.slotTypeLabelActive]}>{t.label}</Text>
                  <Text style={s.slotTypeHint}>{t.hint}</Text>
                </View>
                {newSlotType === t.value && <Ionicons name="checkmark-circle" size={16} color={ORANGE} />}
              </TouchableOpacity>
            ))}
          </View>
          {/* Date (single only) */}
          {newSlotType === 'single' && (
            <View style={s.field}>
              <Text style={s.fieldLabel}>Date de la séance</Text>
              {Platform.OS === 'web' ? (
                <input
                  type="date"
                  value={newSlotDate}
                  onChange={(e: any) => setNewSlotDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  style={{ width: '100%', padding: '12px 14px', borderRadius: 8, border: '1px solid ' + Colors.border, background: Colors.card, color: Colors.foreground, fontSize: 14, outline: 'none' } as any}
                  data-testid="slot-date-input"
                />
              ) : (
                <TextInput style={s.input} value={newSlotDate} onChangeText={setNewSlotDate}
                  placeholder="AAAA-MM-JJ" placeholderTextColor={Colors.muted} testID="slot-date-input" />
              )}
            </View>
          )}
          {/* Day (recurring / availability) */}
          {newSlotType !== 'single' && (
            <View style={s.field}>
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
            </View>
          )}
          {/* Time pickers */}
          {renderTimePicker(newSlotStart, setNewSlotStart,
            newSlotType === 'availability' ? 'Disponible dès' : 'Heure de début', 'start')}
          {renderTimePicker(newSlotEnd, setNewSlotEnd,
            newSlotType === 'availability' ? 'Disponible jusqu\'à' : 'Heure de fin', 'end')}
          <View style={s.addCardActions}>
            <TouchableOpacity style={s.cancelBtn}
              onPress={() => { setAddingSlot(false); setNewSlotStart(''); setNewSlotEnd(''); setNewSlotDate(''); }}>
              <Text style={s.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.confirmBtn} onPress={addSlot} testID="confirm-slot-btn">
              <Text style={s.confirmBtnText}>Ajouter</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={s.addBtn} onPress={() => setAddingSlot(true)} testID="add-slot-btn">
          <Ionicons name="add-circle-outline" size={20} color={ORANGE} />
          <Text style={s.addBtnText}>Ajouter un créneau</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ─── Step 5 – Quality Score ───────────────────────────────────────────────
  const renderQualityScore = () => {
    const criteria = [
      { ok: title.trim().length > 0, label: 'Titre renseigné' },
      { ok: description.trim().length >= 80, label: 'Description détaillée (80+ car.)' },
      { ok: selectedTags.length > 0, label: 'Tags sélectionnés' },
      { ok: locations.length > 0, label: 'Au moins un lieu' },
      { ok: slots.length > 0, label: 'Au moins un créneau' },
    ];
    const score = criteria.filter(c => c.ok).length;
    const color = score >= 4 ? GREEN : score >= 3 ? ORANGE : Colors.destructive;
    return (
      <View style={[s.qualityCard, { borderColor: color + '40' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <View style={[s.qualityBadge, { backgroundColor: color }]}>
            <Text style={s.qualityBadgeText}>{score}/5</Text>
          </View>
          <Text style={[s.qualityTitle, { color }]}>
            {score === 5 ? 'Annonce parfaite !' : score >= 4 ? 'Très bonne annonce' : score >= 3 ? 'Annonce correcte' : 'Complétez votre annonce'}
          </Text>
        </View>
        {criteria.map((c, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Ionicons name={c.ok ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={c.ok ? GREEN : Colors.muted} />
            <Text style={[s.qualityItem, !c.ok && { color: Colors.muted }]}>{c.label}</Text>
          </View>
        ))}
      </View>
    );
  };

  const renderStep5 = () => {
    const domainObj = domains.find(d => d.domain_id === selectedDomain);
    return (
      <View style={s.stepContent}>
        <Text style={s.stepTitle}>Résumé & Publication</Text>
        {renderQualityScore()}
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
              <Text style={s.summaryMetaText}>{maxParticipants} pers.</Text>
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
              <View key={slot.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <Ionicons name={slotIcon(slot.type)} size={13} color={ORANGE} />
                <Text style={s.summarySectionItem}>{formatSlotLabel(slot)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
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

        <View style={s.bottomNav}>
          {step > 1 ? (
            <TouchableOpacity style={s.prevBtn} onPress={goPrev} testID="prev-step-btn">
              <Ionicons name="chevron-back" size={18} color={Colors.foreground} />
              <Text style={s.prevBtnText}>Précédent</Text>
            </TouchableOpacity>
          ) : <View style={{ flex: 1 }} />}
          {step < 5 ? (
            <TouchableOpacity style={s.nextBtn} onPress={goNext} testID="next-step-btn">
              <Text style={s.nextBtnText}>{step === 4 ? 'Voir le résumé' : 'Suivant'}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.background} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.nextBtn, s.publishBtn, submitting && s.disabledBtn]}
              onPress={handleSubmit} disabled={submitting}
              testID="create-service-submit-btn">
              {submitting
                ? <ActivityIndicator color={Colors.background} />
                : <>
                  <Ionicons name="rocket-outline" size={18} color={Colors.background} />
                  <Text style={s.nextBtnText}>Publier mon service</Text>
                </>
              }
            </TouchableOpacity>
          )}
        </View>
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
  scrollContent: { paddingBottom: 20 },
  stepContent: { padding: Spacing.md, gap: 16 },
  stepTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  stepHint: { fontSize: 13, color: Colors.muted, marginTop: -8 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, color: Colors.foreground,
  },
  inputMulti: { minHeight: 100 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  chips: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  chipActive: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  chipTextActive: { color: ORANGE },
  // Time picker
  timeChip: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
    minWidth: 44, alignItems: 'center',
  },
  timeChipActive: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE },
  timeChipText: { fontSize: 13, fontWeight: '700', color: Colors.muted },
  timeChipTextActive: { color: ORANGE },
  minChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  minChipActive: { backgroundColor: ORANGE_LIGHT, borderColor: ORANGE },
  minChipText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  minChipTextActive: { color: ORANGE },
  timeHint: { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },
  // Motivational banner
  motiveBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: ORANGE_LIGHT, borderRadius: Radius.lg,
    padding: 14, borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  motiveText: { fontSize: 13, color: Colors.foreground, flex: 1, lineHeight: 19 },
  charCount: { fontSize: 11, textAlign: 'right', marginTop: 2 },
  charCountGood: { color: GREEN },
  charCountWarn: { color: Colors.muted },
  infoNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: ORANGE_LIGHT, borderRadius: Radius.md,
    padding: Spacing.sm, borderWidth: 1, borderColor: ORANGE_BORDER,
  },
  infoNoteText: { fontSize: 12, color: ORANGE, flex: 1 },
  tipNote: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.backgroundSecondary, borderRadius: Radius.md,
    padding: 10, borderWidth: 1, borderColor: Colors.border,
  },
  tipNoteText: { fontSize: 12, color: Colors.muted, flex: 1 },
  // Precision cards
  precisionCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.background, borderRadius: Radius.md,
    padding: 12, borderWidth: 1.5, borderColor: Colors.border,
  },
  precisionCardActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  precisionCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  precisionCardLabel: { fontSize: 14, fontWeight: '700', color: Colors.muted },
  precisionCardLabelActive: { color: ORANGE },
  precisionCardHint: { fontSize: 12, color: Colors.muted },
  // Slot type cards
  slotTypeCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.background, borderRadius: Radius.md,
    padding: 12, borderWidth: 1.5, borderColor: Colors.border,
  },
  slotTypeCardActive: { borderColor: ORANGE, backgroundColor: ORANGE_LIGHT },
  slotTypeLabel: { fontSize: 14, fontWeight: '700', color: Colors.muted },
  slotTypeLabelActive: { color: ORANGE },
  slotTypeHint: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  // Item cards
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
  addCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1, borderColor: ORANGE_BORDER, gap: 10,
  },
  addCardTitle: { fontSize: 15, fontWeight: '700', color: ORANGE },
  hint: { fontSize: 12, color: Colors.muted },
  mapWrap: { height: 200, borderRadius: Radius.lg, overflow: 'hidden' },
  coordsText: { fontSize: 12, color: ORANGE, fontWeight: '600' },
  addCardActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1, paddingVertical: 11, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border, alignItems: 'center',
  },
  cancelBtnText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  confirmBtn: { flex: 2, paddingVertical: 11, borderRadius: Radius.full, backgroundColor: ORANGE, alignItems: 'center' },
  disabledBtn: { opacity: 0.4 },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: 14, borderRadius: Radius.lg, borderWidth: 1.5,
    borderStyle: 'dashed', borderColor: ORANGE_BORDER,
  },
  addBtnText: { fontSize: 14, fontWeight: '700', color: ORANGE },
  // Quality card
  qualityCard: {
    backgroundColor: Colors.card, borderRadius: Radius.xl,
    padding: Spacing.md, borderWidth: 1,
  },
  qualityBadge: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  qualityBadgeText: { fontSize: 13, fontWeight: '800', color: '#fff' },
  qualityTitle: { fontSize: 16, fontWeight: '800' },
  qualityItem: { fontSize: 13, color: Colors.foreground },
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
  publishBtn: { backgroundColor: GREEN },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
