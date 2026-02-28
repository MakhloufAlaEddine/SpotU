import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface DaySlot {
  id: string;
  date: string;       // 'YYYY-MM-DD'
  startTime: string;  // 'HH:MM'
  endTime: string;    // 'HH:MM'
}

interface WeekCalendarProps {
  slots: DaySlot[];
  durationMin: number;
  onSlotsChange: (slots: DaySlot[]) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TEAL = '#00BFA5';
const TEAL_BG = 'rgba(0,191,165,0.10)';
const PICKER_BG = '#111111';
const PICKER_CARD = '#1E1E1E';

const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const DAYS_LONG = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

const QUICK_PRESETS = [7, 8, 9, 10, 12, 17, 18, 19, 20, 21];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const addMins = (t: string, mins: number) => {
  const total = toMins(t) + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
};
const fmtDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtTime = (h: number, m: number) =>
  `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;

function getWeekDays(weekOffset: number) {
  const today = new Date();
  const dow = today.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(today);
  mon.setDate(today.getDate() + diffToMon + weekOffset * 7);
  mon.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    return {
      date: d, dateStr: fmtDateKey(d),
      dayName: DAYS[i], dayLong: DAYS_LONG[i],
      dayNum: d.getDate(), monthAbbr: MONTHS[d.getMonth()], monthLong: MONTHS_LONG[d.getMonth()],
      showMonth: d.getDate() === 1,
    };
  });
}

function getWeekRangeLabel(days: ReturnType<typeof getWeekDays>) {
  const f = days[0], l = days[6];
  return f.date.getMonth() === l.date.getMonth()
    ? `${f.dayNum} – ${l.dayNum} ${MONTHS[l.date.getMonth()]}`
    : `${f.dayNum} ${MONTHS[f.date.getMonth()]} – ${l.dayNum} ${MONTHS[l.date.getMonth()]}`;
}

function hasOverlap(daySlots: DaySlot[], start: string, end: string, excludeId?: string) {
  const [ns, ne] = [toMins(start), toMins(end)];
  return daySlots.filter(s => s.id !== excludeId).some(s =>
    ns < toMins(s.endTime) && ne > toMins(s.startTime)
  );
}

function getPrevDateStr(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return fmtDateKey(d);
}

// ─── Drum Time Picker ─────────────────────────────────────────────────────────
function DrumTimePicker({ title, initHour, initMinute, onConfirm, onCancel }: {
  title: string; initHour: number; initMinute: number;
  onConfirm: (h: number, m: number) => void; onCancel: () => void;
}) {
  const [h, setH] = useState(initHour);
  const [m, setM] = useState(initMinute);

  const incH = () => setH(p => (p + 1) % 24);
  const decH = () => setH(p => (p + 23) % 24);
  const incM = () => setM(p => (p + 15) % 60);
  const decM = () => setM(p => (p + 45) % 60);

  return (
    <View style={dt.root}>
      {/* Header */}
      <View style={dt.header}>
        <TouchableOpacity onPress={onCancel} style={dt.headerSide} testID="picker-cancel">
          <Text style={dt.cancelText}>Annuler</Text>
        </TouchableOpacity>
        <Text style={dt.headerTitle}>{title}</Text>
        <TouchableOpacity onPress={() => onConfirm(h, m)} style={[dt.headerSide, dt.headerSideRight]} testID="picker-confirm-header">
          <Text style={dt.confirmHeaderText}>Confirmer</Text>
        </TouchableOpacity>
      </View>
      <View style={dt.separator} />

      {/* Drum */}
      <View style={dt.drumRow}>
        {/* Hours drum */}
        <View style={dt.drumCol}>
          <TouchableOpacity onPress={incH} style={dt.arrowBtn} testID="hour-inc">
            <Ionicons name="chevron-up" size={30} color="#666" />
          </TouchableOpacity>
          <View style={dt.displayBox}>
            <Text style={dt.displayText}>{String(h).padStart(2,'0')}</Text>
          </View>
          <TouchableOpacity onPress={decH} style={dt.arrowBtn} testID="hour-dec">
            <Ionicons name="chevron-down" size={30} color="#666" />
          </TouchableOpacity>
          <Text style={dt.drumLabel}>HEURE</Text>
        </View>

        {/* Colon */}
        <View style={dt.colonBox}>
          <Text style={dt.colonDot}>·</Text>
          <Text style={dt.colonDot}>·</Text>
        </View>

        {/* Minutes drum */}
        <View style={dt.drumCol}>
          <TouchableOpacity onPress={incM} style={dt.arrowBtn} testID="min-inc">
            <Ionicons name="chevron-up" size={30} color="#666" />
          </TouchableOpacity>
          <View style={dt.displayBox}>
            <Text style={dt.displayText}>{String(m).padStart(2,'0')}</Text>
          </View>
          <TouchableOpacity onPress={decM} style={dt.arrowBtn} testID="min-dec">
            <Ionicons name="chevron-down" size={30} color="#666" />
          </TouchableOpacity>
          <Text style={dt.drumLabel}>MIN</Text>
        </View>
      </View>

      {/* Quick presets */}
      <View style={dt.presetsGrid}>
        {QUICK_PRESETS.map(ph => {
          const active = h === ph && m === 0;
          return (
            <TouchableOpacity
              key={ph}
              style={[dt.presetChip, active && dt.presetChipActive]}
              onPress={() => { setH(ph); setM(0); }}
              testID={`preset-${ph}`}
            >
              <Text style={[dt.presetText, active && dt.presetTextActive]}>
                {String(ph).padStart(2,'0')}:00
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Big confirm button */}
      <TouchableOpacity style={dt.bigBtn} onPress={() => onConfirm(h, m)} testID="confirm-time">
        <Ionicons name="checkmark-circle" size={22} color="#000" />
        <Text style={dt.bigBtnText}>Confirmer {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Slot Row Component ───────────────────────────────────────────────────────
function SlotRow({ startTime, endTime, onDelete, testId }: {
  startTime: string; endTime: string; onDelete: () => void; testId?: string;
}) {
  return (
    <View style={sr.row} testID={testId}>
      <TouchableOpacity style={sr.timeBtn} activeOpacity={1}>
        <Ionicons name="play-circle-outline" size={18} color={TEAL} />
        <Text style={sr.timeBtnText}>{startTime}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={sr.timeBtn} activeOpacity={1}>
        <Ionicons name="stop-circle-outline" size={18} color={TEAL} />
        <Text style={sr.timeBtnText}>{endTime}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={sr.deleteBtn} onPress={onDelete} testID="delete-slot">
        <Text style={sr.deleteBtnText}>×</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── WeekCalendar Component ────────────────────────────────────────────────────
export function WeekCalendar({ slots, durationMin, onSlotsChange }: WeekCalendarProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);

  // 'idle' | 'picking-start' | 'picking-end'
  const [pickerMode, setPickerMode] = useState<'idle' | 'picking-start' | 'picking-end'>('idle');
  const [pendingStartStr, setPendingStartStr] = useState<string | null>(null);
  const [pendingEndStr, setPendingEndStr] = useState<string | null>(null);

  const today = useMemo(() => fmtDateKey(new Date()), []);
  const weekDays = useMemo(() => getWeekDays(weekOffset), [weekOffset]);

  const getDateSlots = (date: string) =>
    slots.filter(s => s.date === date).sort((a, b) => toMins(a.startTime) - toMins(b.startTime));

  const handleNextWeek = () => {
    const nextOffset = weekOffset + 1;
    const curHasSlots = weekDays.some(d => getDateSlots(d.dateStr).length > 0);
    const nextWeekDays = getWeekDays(nextOffset);
    const nextHasSlots = nextWeekDays.some(d => getDateSlots(d.dateStr).length > 0);
    if (curHasSlots && !nextHasSlots) {
      Alert.alert('Semaine suivante', 'Copier les créneaux de cette semaine ?', [
        { text: 'Non', style: 'cancel', onPress: () => setWeekOffset(nextOffset) },
        { text: 'Copier', onPress: () => {
          const newSlots: DaySlot[] = [];
          for (let i = 0; i < 7; i++)
            for (const ss of getDateSlots(weekDays[i].dateStr))
              newSlots.push({ ...ss, id: `slot_${Date.now()}_${Math.random()}`, date: getWeekDays(nextOffset)[i].dateStr });
          onSlotsChange([...slots, ...newSlots]);
          setWeekOffset(nextOffset);
        }},
      ]);
    } else { setWeekOffset(nextOffset); }
  };

  const openDayModal = (dateStr: string) => {
    setSelectedDate(dateStr);
    setPendingStartStr(null);
    setPendingEndStr(null);
    setPickerMode('idle');
    setShowDayModal(true);
  };

  const handleDayPress = (dateStr: string) => {
    // Bloquer les dates passées
    if (dateStr < today) {
      Alert.alert('Date passée', 'Impossible d\'ajouter des créneaux dans le passé.');
      return;
    }

    const daySlots = getDateSlots(dateStr);
    const prevDateStr = getPrevDateStr(dateStr);
    const prevDaySlots = getDateSlots(prevDateStr);

    // Proposer de cloner J-1 si J est vide et J-1 a des créneaux
    if (daySlots.length === 0 && prevDaySlots.length > 0) {
      Alert.alert(
        'Copier les créneaux de la veille ?',
        `${prevDaySlots.length} créneau${prevDaySlots.length > 1 ? 'x' : ''} disponible${prevDaySlots.length > 1 ? 's' : ''} la veille. Voulez-vous les copier pour ce jour ?`,
        [
          { text: 'Non, créer manuellement', style: 'cancel', onPress: () => openDayModal(dateStr) },
          {
            text: 'Copier', onPress: () => {
              const newSlots: DaySlot[] = prevDaySlots.map(s => ({
                ...s,
                id: `slot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                date: dateStr,
              }));
              onSlotsChange([...slots, ...newSlots]);
              openDayModal(dateStr);
            },
          },
        ]
      );
      return;
    }

    openDayModal(dateStr);
  };

  const closeAll = () => {
    setShowDayModal(false);
    setPickerMode('idle');
  };

  // Called when user taps "Ajouter un créneau"
  const openStartPicker = () => setPickerMode('picking-start');

  // Called when user taps the "Fin ?" button in pending row
  const openEndPicker = () => {
    if (!pendingStartStr) return;
    setPickerMode('picking-end');
  };

  const onDrumConfirm = (h: number, m: number) => {
    const timeStr = fmtTime(h, m);
    if (pickerMode === 'picking-start') {
      setPendingStartStr(timeStr);
      setPendingEndStr(addMins(timeStr, durationMin));
      setPickerMode('idle');
    } else if (pickerMode === 'picking-end') {
      if (pendingStartStr) {
        if (toMins(timeStr) <= toMins(pendingStartStr)) {
          Alert.alert('Heure invalide', 'La fin doit être après le début');
          return;
        }
      }
      setPendingEndStr(timeStr);
      setPickerMode('idle');
    }
  };

  const handleAddSlot = () => {
    if (!selectedDate || !pendingStartStr || !pendingEndStr) return;
    const daySlots = getDateSlots(selectedDate);
    if (hasOverlap(daySlots, pendingStartStr, pendingEndStr)) {
      Alert.alert('Chevauchement', `${pendingStartStr}→${pendingEndStr} chevauche un créneau existant.`);
      return;
    }
    onSlotsChange([...slots, {
      id: `slot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      date: selectedDate, startTime: pendingStartStr, endTime: pendingEndStr,
    }]);
    setPendingStartStr(null);
    setPendingEndStr(null);
    setPickerMode('idle');
  };

  const selectedDaySlots = selectedDate ? getDateSlots(selectedDate) : [];
  const selectedDayInfo = selectedDate
    ? weekDays.find(d => d.dateStr === selectedDate) || (() => {
        const d = new Date(selectedDate + 'T00:00:00');
        return { dayLong: DAYS_LONG[d.getDay() === 0 ? 6 : d.getDay() - 1], dayNum: d.getDate(), monthLong: MONTHS_LONG[d.getMonth()] };
      })() : null;

  const hasPendingSlot = pendingStartStr !== null;
  const totalSlots = selectedDaySlots.length + (hasPendingSlot && pendingEndStr ? 1 : 0);

  const showPicker = pickerMode !== 'idle';
  const pickerTitle = pickerMode === 'picking-start' ? 'Heure' : 'Heure de fin';
  const pickerInitHour = pickerMode === 'picking-start'
    ? (pendingStartStr ? parseInt(pendingStartStr.split(':')[0]) : 9)
    : (pendingEndStr ? parseInt(pendingEndStr.split(':')[0]) : 10);
  const pickerInitMinute = pickerMode === 'picking-start'
    ? (pendingStartStr ? parseInt(pendingStartStr.split(':')[1]) : 0)
    : (pendingEndStr ? parseInt(pendingEndStr.split(':')[1]) : 0);

  return (
    <View>
      {/* ── Week navigation ───────────────────────────────────────────── */}
      <View style={s.navRow}>
        <TouchableOpacity style={s.navBtn} onPress={() => setWeekOffset(p => p - 1)} testID="prev-week">
          <Ionicons name="chevron-back" size={18} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={s.navLabel}>{getWeekRangeLabel(weekDays)}</Text>
        <TouchableOpacity style={s.navBtn} onPress={handleNextWeek} testID="next-week">
          <Ionicons name="chevron-forward" size={18} color={Colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* ── Day grid ─────────────────────────────────────────────────── */}
      <View style={s.dayGrid}>
        {weekDays.map((day, i) => {
          const daySlots = getDateSlots(day.dateStr);
          const isToday = day.dateStr === today;
          const hasSlots = daySlots.length > 0;
          return (
            <TouchableOpacity key={i} style={s.dayCell} onPress={() => handleDayPress(day.dateStr)} testID={`cal-day-${day.dateStr}`}>
              <Text style={s.dayName}>{day.dayName}</Text>
              <View style={[s.dayCircle, isToday && s.dayCircleToday, hasSlots && s.dayCircleSlots]}>
                <Text style={[s.dayNum, (isToday || hasSlots) && s.dayNumActive]}>{day.dayNum}</Text>
              </View>
              {day.showMonth && <Text style={s.monthLabel}>{day.monthAbbr}</Text>}
              {hasSlots && (
                <View style={s.slotBadge}>
                  <Text style={s.slotBadgeText}>{daySlots.length}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Day cards below calendar ──────────────────────────────────── */}
      {weekDays.filter(d => getDateSlots(d.dateStr).length > 0).map(day => (
        <TouchableOpacity key={day.dateStr} style={s.dayCard} onPress={() => handleDayPress(day.dateStr)} activeOpacity={0.8} testID={`day-card-${day.dateStr}`}>
          <View style={s.dayCardHeader}>
            <View style={s.dayCardDot} />
            <Text style={s.dayCardTitle}>{day.dayName}</Text>
            <Text style={s.dayCardCount}>{getDateSlots(day.dateStr).length} créneau{getDateSlots(day.dateStr).length > 1 ? 'x' : ''}</Text>
          </View>
          <View style={s.dayCardSlots}>
            {getDateSlots(day.dateStr).map(slot => (
              <View key={slot.id} style={s.dayCardSlotRow}>
                <Ionicons name="play-circle-outline" size={14} color={TEAL} /><Text style={s.dayCardSlotTime}>{slot.startTime}</Text><Ionicons name="arrow-forward" size={11} color={Colors.muted} /><Text style={s.dayCardSlotTime}>{slot.endTime}</Text>
              </View>
            ))}
          </View>
        </TouchableOpacity>
      ))}

      {slots.length === 0 && (
        <View style={s.emptyHint}>
          <Ionicons name="finger-print-outline" size={16} color={Colors.muted} />
          <Text style={s.emptyHintText}>Appuyez sur un jour pour ajouter un créneau</Text>
        </View>
      )}

      {/* ── Bottom Sheet Modal ───────────────────────────────────────── */}
      <Modal visible={showDayModal && !showPicker} animationType="slide" transparent={true} onRequestClose={closeAll}>
        <View style={s.overlayContainer}>
          <TouchableOpacity style={s.backdropDismiss} activeOpacity={1} onPress={closeAll} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />

            {/* Card header */}
            <View style={s.cardHeader}>
              <View style={s.cardDot} />
              <Text style={s.cardTitle}>{selectedDayInfo ? (selectedDayInfo as any).dayLong : ''}</Text>
              <Text style={s.cardCount}>{totalSlots} créneau{totalSlots !== 1 ? 'x' : ''}</Text>
              <TouchableOpacity onPress={closeAll} style={s.closeBtn}>
                <Text style={s.closeBtnText}>×</Text>
              </TouchableOpacity>
            </View>

            {/* Saved slots */}
            {selectedDaySlots.map(slot => (
              <SlotRow
                key={slot.id}
                startTime={slot.startTime}
                endTime={slot.endTime}
                onDelete={() => onSlotsChange(slots.filter(ss => ss.id !== slot.id))}
                testId={`saved-slot-${slot.id}`}
              />
            ))}

            {/* Pending slot row */}
            {hasPendingSlot && (
              <View style={s.pendingRow}>
                <TouchableOpacity style={[sr.timeBtn, s.timeBtnPending]} onPress={openStartPicker} testID="start-btn">
                  <Ionicons name="play-circle-outline" size={18} color={TEAL} />
                  <Text style={sr.timeBtnText}>{pendingStartStr}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[sr.timeBtn, !pendingEndStr && s.timeBtnEmpty]} onPress={openEndPicker} testID="end-btn">
                  <Ionicons name="stop-circle-outline" size={18} color={pendingEndStr ? TEAL : Colors.muted} />
                  <Text style={[sr.timeBtnText, !pendingEndStr && { color: Colors.muted }]}>{pendingEndStr || 'Fin ?'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={sr.deleteBtn} onPress={() => { setPendingStartStr(null); setPendingEndStr(null); }} testID="delete-pending">
                  <Text style={sr.deleteBtnText}>×</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Save pending slot */}
            {hasPendingSlot && pendingEndStr && (
              <TouchableOpacity style={s.confirmAddBtn} onPress={handleAddSlot} testID="confirm-slot">
                <Ionicons name="add-circle" size={18} color={Colors.background} />
                <Text style={s.confirmAddBtnText}>Enregistrer ce créneau</Text>
              </TouchableOpacity>
            )}

            {/* Add dashed button */}
            {!hasPendingSlot && (
              <TouchableOpacity style={s.addDashedBtn} onPress={openStartPicker} testID="add-slot-btn">
                <Ionicons name="add-circle-outline" size={22} color={TEAL} />
                <Text style={s.addDashedBtnText}>Ajouter un créneau</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Full-Screen Drum Picker Modal ────────────────────────────── */}
      <Modal visible={showPicker} animationType="slide" transparent={false} onRequestClose={() => setPickerMode('idle')}>
        <DrumTimePicker
          title={pickerTitle}
          initHour={pickerInitHour}
          initMinute={pickerInitMinute}
          onConfirm={onDrumConfirm}
          onCancel={() => setPickerMode('idle')}
        />
      </Modal>
    </View>
  );
}

// ─── Drum Picker Styles ───────────────────────────────────────────────────────
const dt = StyleSheet.create({
  root: { flex: 1, backgroundColor: PICKER_BG, paddingHorizontal: 32, paddingBottom: 48 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 60, paddingBottom: 20 },
  headerSide: { minWidth: 90 },
  headerSideRight: { alignItems: 'flex-end' },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#FFF' },
  cancelText: { fontSize: 16, color: '#888', fontWeight: '500' },
  confirmHeaderText: { fontSize: 16, fontWeight: '700', color: TEAL },
  separator: { height: 1, backgroundColor: '#2A2A2A' },
  drumRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 32 },
  drumCol: { alignItems: 'center', gap: 14 },
  arrowBtn: { padding: 8 },
  displayBox: {
    width: 140, height: 140, borderRadius: 28,
    backgroundColor: PICKER_CARD, borderWidth: 2, borderColor: TEAL,
    alignItems: 'center', justifyContent: 'center',
  },
  displayText: { fontSize: 64, fontWeight: '800', color: TEAL },
  drumLabel: { fontSize: 11, fontWeight: '700', color: '#666', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 4 },
  colonBox: { alignItems: 'center', gap: 10, paddingBottom: 60 },
  colonDot: { fontSize: 16, color: '#666', fontWeight: '900' },
  presetsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 28 },
  presetChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, backgroundColor: PICKER_CARD },
  presetChipActive: { backgroundColor: TEAL + '25', borderWidth: 1.5, borderColor: TEAL },
  presetText: { fontSize: 14, fontWeight: '600', color: '#888' },
  presetTextActive: { color: TEAL, fontWeight: '700' },
  bigBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
    backgroundColor: TEAL, borderRadius: 60, paddingVertical: 18, marginTop: 4,
  },
  bigBtnText: { fontSize: 18, fontWeight: '800', color: '#000' },
});

// ─── SlotRow Styles ───────────────────────────────────────────────────────────
const sr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  timeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.background, borderRadius: Radius.lg,
    paddingHorizontal: 14, paddingVertical: 16,
    borderWidth: 1.5, borderColor: TEAL + '60',
  },
  timeBtnText: { fontSize: 17, fontWeight: '800', color: TEAL },
  deleteBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontSize: 20, color: Colors.muted, lineHeight: 22 },
});

// ─── Main Styles ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  dayGrid: { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 10, gap: 2, borderWidth: 1, borderColor: Colors.border },
  dayCell: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6, position: 'relative' },
  dayName: { fontSize: 9, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase' },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayCircleToday: { backgroundColor: Colors.primary },
  dayCircleSlots: { backgroundColor: TEAL },
  dayNum: { fontSize: 14, fontWeight: '700', color: Colors.muted },
  dayNumActive: { color: Colors.background },
  monthLabel: { fontSize: 8, color: Colors.muted, fontWeight: '600' },
  slotBadge: { position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  slotBadgeText: { fontSize: 8, fontWeight: '800', color: Colors.background },
  dayCard: { marginTop: 10, backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 14, borderWidth: 1, borderColor: Colors.border, gap: 10 },
  dayCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayCardDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TEAL },
  dayCardTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, flex: 1 },
  dayCardCount: { fontSize: 13, color: Colors.muted },
  dayCardSlots: { gap: 4, paddingLeft: 16 },
  dayCardSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayCardSlotTime: { fontSize: 13, fontWeight: '700', color: TEAL },
  emptyHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 },
  emptyHintText: { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },
  overlayContainer: { flex: 1, justifyContent: 'flex-end' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, paddingHorizontal: Spacing.md },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  cardDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: TEAL },
  cardTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground, flex: 1 },
  cardCount: { fontSize: 13, color: Colors.muted },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 22, color: Colors.muted, lineHeight: 24 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  timeBtnPending: { borderColor: TEAL },
  timeBtnEmpty: { borderColor: Colors.border },
  confirmAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: TEAL, borderRadius: Radius.full, paddingVertical: 13, marginTop: 4 },
  confirmAddBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  addDashedBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.lg, padding: 18, marginTop: 4, borderWidth: 2, borderColor: TEAL, borderStyle: 'dashed', backgroundColor: TEAL_BG },
  addDashedBtnText: { fontSize: 16, fontWeight: '700', color: TEAL },
});
