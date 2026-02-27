import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LocationPicker } from '../../components/LocationPicker';
import { DomainPill } from '../../components/DomainPill';
import { TagSelector } from '../../components/TagSelector';
import { DateTimePickerModal } from '../../components/DateTimePicker';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';

// ─── Constants ────────────────────────────────────────────────────────────────
const ORANGE = '#FF9500';
const ORANGE_LIGHT = 'rgba(255,149,0,0.12)';
const ORANGE_BORDER = 'rgba(255,149,0,0.3)';
const GREEN = '#1DBF73';

const STEP_LABELS = ['Infos', 'Sport', 'Lieux', 'Planning', 'Résumé'];
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const DURATIONS = ['30', '45', '60', '90', '120'];
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDate = (d: Date) => `${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;

const PRECISION_OPTIONS: { value: 'exact' | '100m' | '1000m'; label: string; icon: any }[] = [
  { value: 'exact', label: 'Lieu exact', icon: 'locate' },
  { value: '100m', label: '~100m', icon: 'radio-button-on' },
  { value: '1000m', label: '~1km', icon: 'radio-button-off' },
];

// ─── Types ────────────────────────────────────────────────────────────────────
type LocScheduleType = 'availability' | 'once' | 'recurring';

interface LocTimeSlot {
  start: Date;
  end: Date | null;
}

interface ServiceLocation {
  id: string;
  lat: number;
  lng: number;
  address: string;
  precision: 'exact' | '100m' | '1000m';
  scheduleType: LocScheduleType;
  eventDateTime: Date | null;
  eventEndDateTime: Date | null;
  recurringSchedule: Record<number, LocTimeSlot[]>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function EditServiceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { lang } = useLang();
  const scrollRef = useRef<ScrollView>(null);

  const [loading, setLoading] = useState(true);
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

  // Step 3 – Locations (new architecture with per-location schedule)
  const [locations, setLocations] = useState<ServiceLocation[]>([]);
  const [showLocPicker, setShowLocPicker] = useState(false);

  // Step 4 – Time pickers targeting
  const [editingLocIdx, setEditingLocIdx] = useState<number | null>(null);
  const [editingDayIdx, setEditingDayIdx] = useState<number | null>(null);
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null);
  const [editingTimeType, setEditingTimeType] = useState<'start' | 'end'>('start');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { if (id) loadService(); }, [id]);
  useEffect(() => { if (selectedDomain) loadTags(selectedDomain); }, [selectedDomain]);

  const loadService = async () => {
    try {
      const [data, doms] = await Promise.all([
        api.get(`/services/${id}`),
        api.get('/domains'),
      ]);
      setDomains(doms);
      setTitle(data.title || '');
      setDescription(data.description || '');
      setPrice(String(data.price || ''));
      setDuration(String(data.duration_min || '60'));
      setMaxParticipants(String(data.max_participants || '1'));
      setSelectedDomain(data.domain_id || doms[0]?.domain_id || '');
      const rawTagIds = data.tag_ids;
      setSelectedTags(
        Array.isArray(rawTagIds) ? rawTagIds
          : typeof rawTagIds === 'string' ? (() => { try { return JSON.parse(rawTagIds); } catch { return []; } })()
          : []
      );

      // Build locations with embedded schedules (new location-based architecture)
      const apiSlots: any[] = data.slots || [];
      const slotsByLocId: Record<string, any[]> = {};
      for (const slot of apiSlots) {
        const locId = slot.location_id || '__unassigned__';
        if (!slotsByLocId[locId]) slotsByLocId[locId] = [];
        slotsByLocId[locId].push(slot);
      }

      const unassigned = slotsByLocId['__unassigned__'] || [];
      const newLocations: ServiceLocation[] = (data.locations || []).map((loc: any, idx: number) => {
        // Prefer slots linked to this location; fall back to unassigned for first location only
        const locSlots = slotsByLocId[loc.location_id] ||
          (idx === 0 && unassigned.length > 0 ? unassigned : []);

        let scheduleType: LocScheduleType = 'recurring';
        let eventDateTime: Date | null = null;
        let eventEndDateTime: Date | null = null;
        let recurringSchedule: Record<number, LocTimeSlot[]> = {};

        if (locSlots.length > 0) {
          const firstSlot = locSlots[0];
          if (firstSlot.slot_type === 'single') {
            scheduleType = 'once';
            if (firstSlot.slot_date && firstSlot.start_time) {
              const [h, m] = firstSlot.start_time.split(':').map(Number);
              const d = new Date(firstSlot.slot_date + 'T00:00:00');
              d.setHours(h, m, 0, 0);
              eventDateTime = d;
            }
            if (firstSlot.end_time && firstSlot.end_time !== '00:00') {
              const [h, m] = firstSlot.end_time.split(':').map(Number);
              const d = new Date(); d.setHours(h, m, 0, 0);
              eventEndDateTime = d;
            }
          } else {
            scheduleType = firstSlot.slot_type === 'availability' ? 'availability' : 'recurring';
            for (const slot of locSlots) {
              const days: number[] = Array.isArray(slot.days_of_week) && slot.days_of_week.length > 0
                ? slot.days_of_week
                : (slot.day_of_week !== null && slot.day_of_week !== undefined ? [slot.day_of_week] : []);
              for (const dayIdx of days) {
                if (!recurringSchedule[dayIdx]) recurringSchedule[dayIdx] = [];
                const [sh, sm] = (slot.start_time || '09:00').split(':').map(Number);
                const start = new Date(); start.setHours(sh, sm, 0, 0);
                let end: Date | null = null;
                if (slot.end_time && slot.end_time !== '00:00') {
                  const [eh, em] = slot.end_time.split(':').map(Number);
                  end = new Date(); end.setHours(eh, em, 0, 0);
                }
                recurringSchedule[dayIdx].push({ start, end });
              }
            }
          }
        }

        return {
          id: loc.location_id,
          lat: loc.latitude, lng: loc.longitude,
          address: loc.description || `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`,
          precision: (loc.precision || 'exact') as 'exact' | '100m' | '1000m',
          scheduleType, eventDateTime, eventEndDateTime, recurringSchedule,
        };
      });

      setLocations(newLocations);
    } catch {
      Alert.alert('Erreur', 'Impossible de charger le service');
      router.back();
    } finally {
      setLoading(false);
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
    if (step === 3 && locations.length === 0) { Alert.alert('', 'Ajoutez au moins un lieu'); return; }
    if (step === 4) {
      for (const loc of locations) {
        if (loc.scheduleType === 'once' && !loc.eventDateTime) {
          Alert.alert('Planning incomplet', `Configurez la date pour : ${loc.address || 'un lieu'}`);
          return;
        }
        if (loc.scheduleType === 'recurring' || loc.scheduleType === 'availability') {
          const days = Object.keys(loc.recurringSchedule).map(Number);
          if (days.length === 0) {
            Alert.alert('Planning incomplet', `Sélectionnez au moins un jour pour : ${loc.address || 'un lieu'}`);
            return;
          }
          if (days.some(d => loc.recurringSchedule[d].length === 0)) {
            Alert.alert('Planning incomplet', 'Chaque jour doit avoir au moins un créneau');
            return;
          }
        }
      }
    }
    setStep(s => Math.min(s + 1, 5));
    scrollTop();
  };

  const goPrev = () => { setStep(s => Math.max(s - 1, 1)); scrollTop(); };

  // ─── Location helpers ──────────────────────────────────────────────────────
  const addLocation = (lat: number, lng: number, address: string) => {
    setLocations(prev => [...prev, {
      id: `loc_${Date.now()}`,
      lat, lng, address, precision: 'exact',
      scheduleType: 'recurring',
      eventDateTime: null, eventEndDateTime: null,
      recurringSchedule: {},
    }]);
  };

  const updateLocPrecision = (locIdx: number, precision: 'exact' | '100m' | '1000m') => {
    setLocations(prev => {
      const next = [...prev];
      next[locIdx] = { ...next[locIdx], precision };
      return next;
    });
  };

  const updateLocScheduleType = (locIdx: number, type: LocScheduleType) => {
    setLocations(prev => {
      const next = [...prev];
      next[locIdx] = { ...next[locIdx], scheduleType: type, eventDateTime: null, eventEndDateTime: null, recurringSchedule: {} };
      return next;
    });
  };

  const toggleDayForLoc = (locIdx: number, dayIdx: number) => {
    setLocations(prev => {
      const next = [...prev];
      const loc = { ...next[locIdx] };
      const rec = { ...loc.recurringSchedule };
      if (rec[dayIdx] !== undefined) { delete rec[dayIdx]; } else { rec[dayIdx] = []; }
      loc.recurringSchedule = rec;
      next[locIdx] = loc;
      return next;
    });
  };

  const removeTimeFromLocDay = (locIdx: number, dayIdx: number, timeIdx: number) => {
    setLocations(prev => {
      const next = [...prev];
      const loc = { ...next[locIdx] };
      const rec = { ...loc.recurringSchedule };
      rec[dayIdx] = (rec[dayIdx] || []).filter((_, i) => i !== timeIdx);
      loc.recurringSchedule = rec;
      next[locIdx] = loc;
      return next;
    });
  };

  const openTimePicker = (locIdx: number, dayIdx: number, timeIdx: number, type: 'start' | 'end') => {
    setEditingLocIdx(locIdx);
    setEditingDayIdx(dayIdx);
    setEditingTimeIdx(timeIdx);
    setEditingTimeType(type);
  };

  const openDatePicker = (locIdx: number) => {
    setEditingLocIdx(locIdx);
    setShowDatePicker(true);
  };

  const openEndDatePicker = (locIdx: number) => {
    setEditingLocIdx(locIdx);
    setShowEndDatePicker(true);
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const slotsPayload = locations.flatMap((loc, locIdx) => {
        if (loc.scheduleType === 'once') {
          if (!loc.eventDateTime) return [];
          const d = loc.eventDateTime;
          return [{
            location_index: locIdx,
            slot_type: 'single',
            day_of_week: null,
            days_of_week: null,
            start_time: fmtTime(d),
            end_time: loc.eventEndDateTime ? fmtTime(loc.eventEndDateTime) : null,
            slot_date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          }];
        }
        return Object.entries(loc.recurringSchedule).flatMap(([dayIdx, timeSlots]) =>
          timeSlots.map(ts => ({
            location_index: locIdx,
            slot_type: loc.scheduleType === 'availability' ? 'availability' : 'recurring',
            day_of_week: parseInt(dayIdx),
            days_of_week: null,
            start_time: fmtTime(ts.start),
            end_time: ts.end ? fmtTime(ts.end) : null,
            slot_date: null,
          }))
        );
      });

      await api.put(`/services/${id}`, {
        title: title.trim(),
        description: description.trim() || null,
        price: parseFloat(price),
        duration_min: parseInt(duration) || 60,
        max_participants: parseInt(maxParticipants) || 1,
        domain_id: selectedDomain,
        tag_ids: selectedTags,
        locations: locations.map(l => ({
          latitude: l.lat, longitude: l.lng,
          precision: l.precision, description: l.address || null,
        })),
        slots: slotsPayload,
      });
      router.replace(`/service/${id}` as any);
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible de modifier le service');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Time picker onConfirm ────────────────────────────────────────────────
  const handleTimeConfirm = (d: Date) => {
    if (editingLocIdx !== null && editingDayIdx !== null && editingTimeIdx !== null) {
      if (editingTimeType === 'end') {
        const loc = locations[editingLocIdx];
        const slots = loc.recurringSchedule[editingDayIdx] || [];
        const startTime = slots[editingTimeIdx]?.start;
        const startMins = startTime ? startTime.getHours() * 60 + startTime.getMinutes() : -1;
        const endMins = d.getHours() * 60 + d.getMinutes();
        if (endMins <= startMins) {
          Alert.alert('Heure invalide', "L'heure de fin doit être après l'heure de début.");
          setEditingLocIdx(null); setEditingDayIdx(null); setEditingTimeIdx(null);
          return;
        }
      }
      setLocations(prev => {
        const next = [...prev];
        const loc = { ...next[editingLocIdx!] };
        const rec = { ...loc.recurringSchedule };
        const slots = [...(rec[editingDayIdx!] || [])];
        if (editingTimeType === 'start') {
          if (editingTimeIdx! >= slots.length) {
            slots.push({ start: d, end: null });
          } else {
            const existingEnd = slots[editingTimeIdx!]?.end;
            if (existingEnd) {
              const newStartMins = d.getHours() * 60 + d.getMinutes();
              const endMins = existingEnd.getHours() * 60 + existingEnd.getMinutes();
              slots[editingTimeIdx!] = newStartMins >= endMins ? { start: d, end: null } : { ...slots[editingTimeIdx!], start: d };
            } else {
              slots[editingTimeIdx!] = { ...slots[editingTimeIdx!], start: d };
            }
          }
        } else {
          slots[editingTimeIdx!] = { ...slots[editingTimeIdx!], end: d };
        }
        rec[editingDayIdx!] = slots;
        loc.recurringSchedule = rec;
        next[editingLocIdx!] = loc;
        return next;
      });
    }
    setEditingLocIdx(null); setEditingDayIdx(null); setEditingTimeIdx(null);
  };

  // ─── Step 1 ───────────────────────────────────────────────────────────────
  const renderStep1 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Informations de base</Text>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Titre du service *</Text>
        <TextInput style={s.input} value={title} onChangeText={setTitle}
          placeholder="Titre du service" placeholderTextColor={Colors.muted} testID="edit-title-input" />
      </View>
      <View style={s.field}>
        <Text style={s.fieldLabel}>Description</Text>
        <TextInput style={[s.input, s.inputMulti]} value={description} onChangeText={setDescription}
          placeholder="Décrivez votre service…" placeholderTextColor={Colors.muted}
          multiline numberOfLines={4} textAlignVertical="top" testID="edit-desc-input" />
        {description.length > 0 && (
          <Text style={[s.charCount, description.length >= 80 ? s.charCountGood : s.charCountWarn]}>
            {description.length} car. {description.length >= 80 ? '✓ Excellente description' : '(80+ recommandé)'}
          </Text>
        )}
      </View>
      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Prix (€) *</Text>
          <TextInput style={s.input} value={price} onChangeText={setPrice}
            placeholder="60" placeholderTextColor={Colors.muted}
            keyboardType="decimal-pad" testID="edit-price-input" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.fieldLabel}>Participants max</Text>
          <TextInput style={s.input} value={maxParticipants} onChangeText={setMaxParticipants}
            placeholder="1" placeholderTextColor={Colors.muted}
            keyboardType="number-pad" testID="edit-max-input" />
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
          <Text style={s.fieldLabel}>Tags</Text>
          <TagSelector tags={tags} categories={categories} selectedIds={selectedTags}
            onToggle={tagId => setSelectedTags(prev =>
              prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
            )} lang={lang} maxSelect={5} />
        </View>
      )}
    </View>
  );

  // ─── Step 3 – Lieux (new: uses LocationPicker like create-service) ─────────
  const renderStep3 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Lieux d'intervention</Text>
      <Text style={s.stepHint}>Modifiez ou ajoutez des lieux (5 max)</Text>

      {locations.map((loc, i) => {
        const sched = loc.scheduleType === 'once' ? 'Date unique' : loc.scheduleType === 'availability' ? 'Disponibilité' : 'Récurrent';
        const dayCount = Object.keys(loc.recurringSchedule).length;
        return (
          <View key={loc.id} style={s.locCard}>
            <View style={s.locCardHeader}>
              <View style={s.locIconBox}>
                <Ionicons name="location" size={16} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.locCardAddress} numberOfLines={2}>{loc.address || `Lieu ${i + 1}`}</Text>
                <Text style={s.locCardMeta}>
                  {sched} {loc.scheduleType !== 'once' && dayCount > 0 ? `· ${dayCount} jour(s)` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setLocations(prev => prev.filter(l => l.id !== loc.id))}
                testID={`remove-loc-${loc.id}`} style={{ padding: 4 }}>
                <Ionicons name="trash-outline" size={18} color={Colors.destructive} />
              </TouchableOpacity>
            </View>
            {/* Precision selector */}
            <View style={s.precisionRow}>
              {PRECISION_OPTIONS.map(opt => {
                const active = loc.precision === opt.value;
                return (
                  <TouchableOpacity key={opt.value}
                    style={[s.precisionChip, active && s.precisionChipActive]}
                    onPress={() => updateLocPrecision(i, opt.value)}
                    testID={`precision-${opt.value}-${loc.id}`}>
                    <Ionicons name={opt.icon} size={13} color={active ? Colors.primary : Colors.muted} />
                    <Text style={[s.precisionChipText, active && { color: Colors.primary }]}>{opt.label}</Text>
                    {active && <Ionicons name="checkmark" size={11} color={Colors.primary} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}

      {locations.length < 5 && (
        <TouchableOpacity style={s.addLocBtn} onPress={() => setShowLocPicker(true)} testID="add-location-btn">
          <Ionicons name="add-circle-outline" size={20} color={Colors.primary} />
          <Text style={s.addLocBtnText}>Ajouter un lieu</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  // ─── Step 4 – Planning par lieu (new: identical to create-service step 4) ─
  const renderStep4 = () => (
    <View style={s.stepContent}>
      <Text style={s.stepTitle}>Planning par lieu</Text>
      <Text style={s.stepHint}>Configurez les disponibilités pour chaque lieu</Text>

      {locations.length === 0 && (
        <View style={s.emptyNote}>
          <Ionicons name="location-outline" size={20} color={Colors.muted} />
          <Text style={s.emptyNoteText}>Retournez à l'étape précédente pour ajouter des lieux</Text>
        </View>
      )}

      {locations.map((loc, locIdx) => {
        const selectedDays = Object.keys(loc.recurringSchedule).map(Number).sort((a, b) => a - b);
        return (
          <View key={loc.id} style={s.locSection}>
            {/* Location header */}
            <View style={s.locSectionHeader}>
              <View style={s.locSectionDot} />
              <Text style={s.locSectionAddress} numberOfLines={2}>{loc.address || `Lieu ${locIdx + 1}`}</Text>
            </View>

            {/* Schedule type cards */}
            <View style={sched.scheduleTypes}>
              {([
                { type: 'availability', icon: 'ban-outline', label: 'Disponibilité', sub: 'Sur rdv' },
                { type: 'once', icon: 'calendar-outline', label: 'Date unique', sub: 'Ponctuel' },
                { type: 'recurring', icon: 'repeat-outline', label: 'Récurrent', sub: 'Hebdo' },
              ] as const).map(({ type, icon, label, sub }) => {
                const active = loc.scheduleType === type;
                return (
                  <TouchableOpacity key={type}
                    style={[sched.scheduleCard, active && sched.scheduleCardActive]}
                    onPress={() => updateLocScheduleType(locIdx, type)}
                    testID={`schedule-${type}-${locIdx}`}>
                    <View style={[sched.scheduleIconBox, active && { backgroundColor: Colors.primary + '22' }]}>
                      <Ionicons name={icon} size={26} color={active ? Colors.primary : Colors.muted} />
                    </View>
                    <Text style={[sched.scheduleLabel, active && { color: Colors.primary, fontWeight: '700' }]}>{label}</Text>
                    <Text style={sched.scheduleSub}>{sub}</Text>
                    {active && <View style={sched.scheduleCheck}><Ionicons name="checkmark" size={12} color={Colors.background} /></View>}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Date unique */}
            {loc.scheduleType === 'once' && (
              <View style={{ gap: 8 }}>
                <TouchableOpacity style={sched.dateBtn} onPress={() => openDatePicker(locIdx)}
                  testID={`open-date-${locIdx}`}>
                  <Ionicons name="calendar" size={22} color={loc.eventDateTime ? Colors.primary : Colors.muted} />
                  <View style={{ flex: 1 }}>
                    {loc.eventDateTime
                      ? <><Text style={sched.dateBtnValue}>{fmtDate(loc.eventDateTime)}</Text><Text style={sched.dateBtnSub}>Début : {fmtTime(loc.eventDateTime)}</Text></>
                      : <Text style={sched.dateBtnPlaceholder}>Choisir date et heure de début</Text>
                    }
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                </TouchableOpacity>
                {loc.eventDateTime && (
                  <TouchableOpacity style={sched.dateBtn} onPress={() => openEndDatePicker(locIdx)}
                    testID={`open-end-${locIdx}`}>
                    <Ionicons name="time-outline" size={22} color={loc.eventEndDateTime ? Colors.primary : Colors.muted} />
                    <View style={{ flex: 1 }}>
                      {loc.eventEndDateTime
                        ? <><Text style={sched.dateBtnValue}>{fmtTime(loc.eventEndDateTime)}</Text><Text style={sched.dateBtnSub}>Fin</Text></>
                        : <Text style={sched.dateBtnPlaceholder}>Heure de fin (optionnel)</Text>
                      }
                    </View>
                    {loc.eventEndDateTime
                      ? <TouchableOpacity onPress={() => {
                          setLocations(prev => { const n = [...prev]; n[locIdx] = { ...n[locIdx], eventEndDateTime: null }; return n; });
                        }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Ionicons name="close-circle" size={20} color={Colors.muted} />
                        </TouchableOpacity>
                      : <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                    }
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Récurrent / Disponibilité */}
            {(loc.scheduleType === 'recurring' || loc.scheduleType === 'availability') && (
              <View style={{ gap: Spacing.md }}>
                <View>
                  <Text style={sched.scheduleFieldLabel}>Jours actifs</Text>
                  <View style={sched.daysRow}>
                    {DAYS.map((d, i) => {
                      const active = loc.recurringSchedule[i] !== undefined;
                      return (
                        <TouchableOpacity key={d} style={[sched.dayBtn, active && sched.dayBtnActive]}
                          onPress={() => toggleDayForLoc(locIdx, i)} testID={`day-${i}-${locIdx}`}>
                          <Text style={[sched.dayText, active && { color: Colors.background }]}>{d}</Text>
                          {active && (loc.recurringSchedule[i].length > 0) && (
                            <View style={sched.dayTimeBadge}>
                              <Text style={sched.dayTimeBadgeText}>{loc.recurringSchedule[i].length}</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  {selectedDays.length === 0 && (
                    <View style={s.fieldTip}>
                      <Ionicons name="information-circle-outline" size={13} color={Colors.muted} />
                      <Text style={s.fieldTipText}>Sélectionnez un ou plusieurs jours</Text>
                    </View>
                  )}
                </View>

                {selectedDays.map(dayIdx => (
                  <View key={dayIdx} style={sched.dayScheduleCard}>
                    <View style={sched.dayScheduleHeader}>
                      <View style={sched.dayScheduleDot} />
                      <Text style={sched.dayScheduleTitle}>{DAYS[dayIdx]}</Text>
                      <Text style={sched.dayScheduleCount}>
                        {loc.recurringSchedule[dayIdx].length} créneau{loc.recurringSchedule[dayIdx].length !== 1 ? 'x' : ''}
                      </Text>
                    </View>
                    <View style={{ gap: 8 }}>
                      {loc.recurringSchedule[dayIdx].map((slot, tIdx) => (
                        <View key={tIdx} style={sched.timeSlotRow}>
                          <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
                            <TouchableOpacity style={[sched.dateBtn, { flex: 1 }]}
                              onPress={() => openTimePicker(locIdx, dayIdx, tIdx, 'start')}
                              testID={`time-start-${locIdx}-${dayIdx}-${tIdx}`}>
                              <Ionicons name="play-circle-outline" size={16} color={Colors.primary} />
                              <Text style={sched.dateBtnValue}>{fmtTime(slot.start)}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[sched.dateBtn, { flex: 1 }]}
                              onPress={() => openTimePicker(locIdx, dayIdx, tIdx, 'end')}
                              testID={`time-end-${locIdx}-${dayIdx}-${tIdx}`}>
                              <Ionicons name="stop-circle-outline" size={16} color={slot.end ? Colors.primary : Colors.muted} />
                              <Text style={[sched.dateBtnValue, !slot.end && { color: Colors.muted, fontSize: 13, fontWeight: '500' }]}>
                                {slot.end ? fmtTime(slot.end) : 'Fin ?'}
                              </Text>
                            </TouchableOpacity>
                          </View>
                          <TouchableOpacity onPress={() => removeTimeFromLocDay(locIdx, dayIdx, tIdx)}
                            style={sched.removeTimeBtn} testID={`remove-time-${locIdx}-${dayIdx}-${tIdx}`}>
                            <Ionicons name="close-circle" size={22} color={Colors.muted} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity style={sched.addTimeBtn}
                        onPress={() => openTimePicker(locIdx, dayIdx, loc.recurringSchedule[dayIdx]?.length ?? 0, 'start')}
                        testID={`add-time-${locIdx}-${dayIdx}`}>
                        <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
                        <Text style={sched.addTimeBtnText}>Ajouter un créneau</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  // ─── Step 5 ───────────────────────────────────────────────────────────────
  const renderStep5 = () => {
    const domainObj = domains.find(d => d.domain_id === selectedDomain);
    return (
      <View style={s.stepContent}>
        <Text style={s.stepTitle}>Résumé des modifications</Text>
        <View style={s.summaryCard}>
          <Text style={s.summaryTitle}>{title}</Text>
          {description ? <Text style={s.summaryDesc}>{description}</Text> : null}
          <View style={s.summaryMeta}>
            <View style={s.summaryMetaItem}>
              <Ionicons name="pricetag-outline" size={14} color={ORANGE} />
              <Text style={s.summaryMetaText}>{price}€/séance</Text>
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
            <Text style={s.summarySectionTitle}>Lieux & Planning ({locations.length})</Text>
            {locations.map((loc, i) => {
              const days = Object.keys(loc.recurringSchedule).map(Number).sort();
              const schedLabel = loc.scheduleType === 'once'
                ? (loc.eventDateTime ? `${fmtDate(loc.eventDateTime)} ${fmtTime(loc.eventDateTime)}` : 'Non configuré')
                : days.length > 0 ? days.map(d => {
                    const slots = loc.recurringSchedule[d];
                    return `${DAYS[d]}: ${slots.map(sl => sl.end ? `${fmtTime(sl.start)}-${fmtTime(sl.end)}` : fmtTime(sl.start)).join(', ')}`;
                  }).join(' · ') : loc.scheduleType === 'availability' ? 'Disponibilité (jours à configurer)' : 'Non configuré';
              return (
                <View key={loc.id} style={{ marginBottom: 6 }}>
                  <Text style={s.summarySectionItem}>📍 {loc.address || `Lieu ${i + 1}`}</Text>
                  <Text style={[s.summarySectionItem, { paddingLeft: 14, color: Colors.primary }]}>{schedLabel}</Text>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

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

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (loading) return (
    <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" color={ORANGE} />
    </View>
  );

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <TouchableOpacity style={s.headerBackBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Modifier le service</Text>
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
              <Text style={s.nextBtnText}>{step === 4 ? 'Résumé' : 'Suivant'}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.background} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.nextBtn, s.saveBtn, submitting && s.disabledBtn]}
              onPress={handleSubmit} disabled={submitting}
              testID="save-service-btn">
              {submitting
                ? <ActivityIndicator color={Colors.background} />
                : <>
                  <Ionicons name="checkmark-circle-outline" size={18} color={Colors.background} />
                  <Text style={s.nextBtnText}>Sauvegarder</Text>
                </>
              }
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* ── LocationPicker Modal ──────────────────────────────────────────── */}
      <LocationPicker
        visible={showLocPicker}
        onClose={() => setShowLocPicker(false)}
        onSelect={(lat, lng, address) => { addLocation(lat, lng, address); setShowLocPicker(false); }}
      />

      {/* ── DateTimePicker for 'once' type ────────────────────────────────── */}
      <DateTimePickerModal
        visible={showDatePicker}
        onClose={() => { setShowDatePicker(false); setEditingLocIdx(null); }}
        onConfirm={d => {
          if (editingLocIdx !== null) {
            setLocations(prev => { const n = [...prev]; n[editingLocIdx] = { ...n[editingLocIdx], eventDateTime: d }; return n; });
          }
          setShowDatePicker(false); setEditingLocIdx(null);
        }}
        initialDate={editingLocIdx !== null ? (locations[editingLocIdx]?.eventDateTime || undefined) : undefined}
        mode="datetime" minDate={new Date()}
      />
      <DateTimePickerModal
        visible={showEndDatePicker}
        onClose={() => { setShowEndDatePicker(false); setEditingLocIdx(null); }}
        onConfirm={d => {
          if (editingLocIdx !== null) {
            const loc = locations[editingLocIdx];
            if (loc.eventDateTime) {
              const startMins = loc.eventDateTime.getHours() * 60 + loc.eventDateTime.getMinutes();
              const endMins = d.getHours() * 60 + d.getMinutes();
              if (endMins <= startMins) {
                Alert.alert('Heure invalide', "L'heure de fin doit être après l'heure de début.");
                setShowEndDatePicker(false); setEditingLocIdx(null);
                return;
              }
            }
            setLocations(prev => { const n = [...prev]; n[editingLocIdx!] = { ...n[editingLocIdx!], eventEndDateTime: d }; return n; });
          }
          setShowEndDatePicker(false); setEditingLocIdx(null);
        }}
        initialDate={editingLocIdx !== null ? (locations[editingLocIdx]?.eventEndDateTime || undefined) : undefined}
        mode="time"
      />

      {/* ── DateTimePicker for recurring/availability time slots ─────────── */}
      <DateTimePickerModal
        visible={editingLocIdx !== null && editingDayIdx !== null && editingTimeIdx !== null}
        onClose={() => { setEditingLocIdx(null); setEditingDayIdx(null); setEditingTimeIdx(null); }}
        onConfirm={handleTimeConfirm}
        initialDate={
          (editingLocIdx !== null && editingDayIdx !== null && editingTimeIdx !== null)
            ? (editingTimeType === 'start'
                ? locations[editingLocIdx]?.recurringSchedule[editingDayIdx]?.[editingTimeIdx]?.start
                : locations[editingLocIdx]?.recurringSchedule[editingDayIdx]?.[editingTimeIdx]?.end || undefined)
            : undefined
        }
        mode="time"
      />
    </SafeAreaView>
  );
}

// ─── Schedule styles (identical to create-service.tsx sched object) ───────────
const sched = StyleSheet.create({
  scheduleTypes: { flexDirection: 'row', gap: 8 },
  scheduleCard: { flex: 1, alignItems: 'center', gap: 6, padding: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1.5, borderColor: Colors.border, position: 'relative' },
  scheduleCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  scheduleIconBox: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
  scheduleLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, textAlign: 'center' },
  scheduleSub: { fontSize: 11, color: Colors.muted, textAlign: 'center' },
  scheduleCheck: { position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dateBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  dateBtnValue: { fontSize: 16, fontWeight: '700', color: Colors.primary, flex: 1 },
  dateBtnSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  dateBtnPlaceholder: { fontSize: 15, color: Colors.muted, flex: 1 },
  scheduleFieldLabel: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  daysRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dayBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: Colors.border },
  dayBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dayText: { fontSize: 11, fontWeight: '700', color: Colors.muted },
  timeSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  removeTimeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addTimeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary + '60', backgroundColor: Colors.primary + '08' },
  addTimeBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  dayScheduleCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  dayScheduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  dayScheduleDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  dayScheduleTitle: { fontSize: 14, fontWeight: '800', color: Colors.foreground, flex: 1 },
  dayScheduleCount: { fontSize: 11, color: Colors.muted },
  dayTimeBadge: { position: 'absolute', top: -4, right: -4, width: 15, height: 15, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  dayTimeBadgeText: { fontSize: 9, color: Colors.background, fontWeight: '800' },
});

// ─── Main styles ──────────────────────────────────────────────────────────────
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
  fieldTip: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 4 },
  fieldTipText: { fontSize: 12, color: Colors.muted, fontStyle: 'italic', flex: 1 },
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
  charCount: { fontSize: 11, textAlign: 'right', marginTop: 2 },
  charCountGood: { color: GREEN },
  charCountWarn: { color: Colors.muted },
  // Location cards (step 3) – same as create-service
  locCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: 12 },
  locCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  locIconBox: { width: 32, height: 32, borderRadius: 10, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' },
  locCardAddress: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foreground, lineHeight: 20 },
  locCardMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  precisionRow: { flexDirection: 'row', gap: 6 },
  precisionChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 7, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background },
  precisionChipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  precisionChipText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  addLocBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 14, borderRadius: Radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary + '60', backgroundColor: Colors.primary + '08' },
  addLocBtnText: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  // Location section (step 4) – same as create-service
  locSection: { backgroundColor: Colors.card, borderRadius: Radius.xl, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border, gap: Spacing.md },
  locSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  locSectionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  locSectionAddress: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.foreground, lineHeight: 20 },
  emptyNote: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  emptyNoteText: { flex: 1, fontSize: 13, color: Colors.muted },
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
  saveBtn: { backgroundColor: GREEN },
  disabledBtn: { opacity: 0.4 },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
