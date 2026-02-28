import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DateTimePickerModal } from './DateTimePicker';
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
const ORANGE = '#FF9500';
const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const DAYS_LONG = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const toMins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const addMins = (t: string, mins: number) => {
  const total = toMins(t) + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
};
const fmtDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const fmtTimeFromDate = (d: Date) =>
  `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

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
      date: d,
      dateStr: fmtDateKey(d),
      dayName: DAYS[i],
      dayLong: DAYS_LONG[i],
      dayNum: d.getDate(),
      monthAbbr: MONTHS[d.getMonth()],
      monthLong: MONTHS_LONG[d.getMonth()],
      showMonth: d.getDate() === 1,
    };
  });
}

function getWeekRangeLabel(days: ReturnType<typeof getWeekDays>) {
  const f = days[0], l = days[6];
  if (f.date.getMonth() === l.date.getMonth()) {
    return `${f.dayNum} – ${l.dayNum} ${MONTHS[l.date.getMonth()]}`;
  }
  return `${f.dayNum} ${MONTHS[f.date.getMonth()]} – ${l.dayNum} ${MONTHS[l.date.getMonth()]}`;
}

function hasOverlap(daySlots: DaySlot[], start: string, end: string, excludeId?: string): boolean {
  const [ns, ne] = [toMins(start), toMins(end)];
  return daySlots.filter(s => s.id !== excludeId).some(s => {
    return ns < toMins(s.endTime) && ne > toMins(s.startTime);
  });
}

function getPrevDateStr(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return fmtDateKey(d);
}

// ─── WeekCalendar Component ────────────────────────────────────────────────────
export function WeekCalendar({ slots, durationMin, onSlotsChange }: WeekCalendarProps) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showDayModal, setShowDayModal] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [pendingStart, setPendingStart] = useState<Date | null>(null);
  const [pendingEnd, setPendingEnd] = useState<Date | null>(null);

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
      Alert.alert(
        'Semaine suivante',
        'Copier les créneaux de cette semaine vers la semaine suivante ?',
        [
          { text: 'Non', style: 'cancel', onPress: () => setWeekOffset(nextOffset) },
          {
            text: 'Copier',
            onPress: () => {
              const newSlots: DaySlot[] = [];
              for (let i = 0; i < 7; i++) {
                for (const s of getDateSlots(weekDays[i].dateStr)) {
                  newSlots.push({ ...s, id: `slot_${Date.now()}_${Math.random()}`, date: nextWeekDays[i].dateStr });
                }
              }
              onSlotsChange([...slots, ...newSlots]);
              setWeekOffset(nextOffset);
            },
          },
        ]
      );
    } else {
      setWeekOffset(nextOffset);
    }
  };

  const handleDayPress = (dateStr: string) => {
    setSelectedDate(dateStr);
    setPendingStart(null);
    setPendingEnd(null);
    setShowDayModal(true);
  };

  const handleAddSlot = () => {
    if (!selectedDate || !pendingStart || !pendingEnd) return;
    const start = fmtTimeFromDate(pendingStart);
    const end = fmtTimeFromDate(pendingEnd);
    const daySlots = getDateSlots(selectedDate);
    if (hasOverlap(daySlots, start, end)) {
      Alert.alert('Chevauchement', `${start}→${end} chevauche un créneau existant.`);
      return;
    }
    onSlotsChange([...slots, { id: `slot_${Date.now()}_${Math.random().toString(36).slice(2)}`, date: selectedDate, startTime: start, endTime: end }]);
    setPendingStart(null);
    setPendingEnd(null);
  };

  const handleCloneFromPrev = () => {
    if (!selectedDate) return;
    const prevDate = getPrevDateStr(selectedDate);
    const prevSlots = getDateSlots(prevDate);
    const daySlots = getDateSlots(selectedDate);
    const newSlots = prevSlots
      .filter(s => !hasOverlap(daySlots, s.startTime, s.endTime))
      .map(s => ({ ...s, id: `slot_${Date.now()}_${Math.random()}`, date: selectedDate }));
    if (newSlots.length > 0) {
      onSlotsChange([...slots, ...newSlots]);
    } else {
      Alert.alert('Info', 'Tous les créneaux à copier chevauchent des créneaux existants.');
    }
  };

  const selectedDaySlots = selectedDate ? getDateSlots(selectedDate) : [];
  const prevDate = selectedDate ? getPrevDateStr(selectedDate) : null;
  const prevDayHasSlots = prevDate ? getDateSlots(prevDate).length > 0 : false;
  const selectedDayInfo = selectedDate ? weekDays.find(d => d.dateStr === selectedDate) ||
    (() => {
      const d = new Date(selectedDate + 'T00:00:00');
      return { dayLong: DAYS_LONG[d.getDay() === 0 ? 6 : d.getDay() - 1], dayNum: d.getDate(), monthLong: MONTHS_LONG[d.getMonth()] };
    })() : null;

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

      {/* ── Slot previews ────────────────────────────────────────────── */}
      {weekDays.filter(d => getDateSlots(d.dateStr).length > 0).map(day => (
        <View key={day.dateStr} style={s.slotPreview}>
          <View style={s.slotPreviewHeader}>
            <View style={s.slotDot} />
            <Text style={s.slotPreviewDay}>{day.dayName} {day.dayNum} {day.monthAbbr}</Text>
          </View>
          <View style={s.slotPreviewTimes}>
            {getDateSlots(day.dateStr).map(slot => (
              <View key={slot.id} style={s.timeChip}>
                <Text style={s.timeChipText}>{slot.startTime} → {slot.endTime}</Text>
                <TouchableOpacity onPress={() => onSlotsChange(slots.filter(s => s.id !== slot.id))} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={15} color={Colors.muted} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        </View>
      ))}

      {slots.length === 0 && (
        <View style={s.emptyHint}>
          <Ionicons name="tap-outline" size={16} color={Colors.muted} />
          <Text style={s.emptyHintText}>Appuyez sur un jour pour ajouter un créneau</Text>
        </View>
      )}

      {/* ── Day Modal ────────────────────────────────────────────────── */}
      <Modal visible={showDayModal} animationType="slide" transparent onRequestClose={() => setShowDayModal(false)}>
        <View style={s.overlayContainer}>
          <TouchableOpacity style={s.backdropDismiss} activeOpacity={1} onPress={() => setShowDayModal(false)} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />

            {/* Header */}
            <View style={s.sheetHeader}>
              <View>
                <Text style={s.sheetTitle}>
                  {selectedDayInfo ? `${(selectedDayInfo as any).dayLong} ${(selectedDayInfo as any).dayNum}` : ''}
                </Text>
                <Text style={s.sheetSubtitle}>
                  {selectedDayInfo ? (selectedDayInfo as any).monthLong : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowDayModal(false)}>
                <Ionicons name="close" size={22} color={Colors.muted} />
              </TouchableOpacity>
            </View>

            {/* Clone from prev day */}
            {prevDayHasSlots && (
              <TouchableOpacity style={s.cloneBtn} onPress={handleCloneFromPrev} testID="clone-prev-day">
                <Ionicons name="copy-outline" size={15} color={ORANGE} />
                <Text style={s.cloneBtnText}>Copier les créneaux d'hier</Text>
              </TouchableOpacity>
            )}

            {/* Existing slots */}
            {selectedDaySlots.length > 0 && (
              <View style={s.existingSection}>
                <Text style={s.sectionLabel}>Créneaux ({selectedDaySlots.length})</Text>
                {selectedDaySlots.map(slot => (
                  <View key={slot.id} style={s.existingRow}>
                    <Ionicons name="time-outline" size={15} color={ORANGE} />
                    <Text style={s.existingTime}>{slot.startTime} → {slot.endTime}</Text>
                    <TouchableOpacity onPress={() => { onSlotsChange(slots.filter(s => s.id !== slot.id)); }} style={s.removeBtn}>
                      <Ionicons name="trash-outline" size={15} color={Colors.destructive} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            {/* Add new slot */}
            <View style={s.addSection}>
              <Text style={s.sectionLabel}>Nouveau créneau</Text>
              <View style={s.timeRow}>
                <TouchableOpacity style={[s.timeBtn, pendingStart && s.timeBtnFilled]} onPress={() => setShowStartPicker(true)} testID="start-btn">
                  <Ionicons name="play-circle-outline" size={16} color={pendingStart ? ORANGE : Colors.muted} />
                  <Text style={[s.timeBtnText, !pendingStart && { color: Colors.muted }]}>
                    {pendingStart ? fmtTimeFromDate(pendingStart) : 'Début'}
                  </Text>
                </TouchableOpacity>
                <Ionicons name="arrow-forward" size={14} color={Colors.muted} />
                <TouchableOpacity
                  style={[s.timeBtn, pendingEnd && s.timeBtnFilled]}
                  onPress={() => {
                    if (!pendingStart) { Alert.alert('', "Définissez d'abord l'heure de début"); return; }
                    setShowEndPicker(true);
                  }}
                  testID="end-btn"
                >
                  <Ionicons name="stop-circle-outline" size={16} color={pendingEnd ? ORANGE : Colors.muted} />
                  <Text style={[s.timeBtnText, !pendingEnd && { color: Colors.muted }]}>
                    {pendingEnd ? fmtTimeFromDate(pendingEnd) : 'Fin (auto)'}
                  </Text>
                </TouchableOpacity>
              </View>
              {pendingStart && pendingEnd && (
                <TouchableOpacity style={s.addSlotBtn} onPress={handleAddSlot} testID="confirm-slot">
                  <Ionicons name="add-circle" size={18} color={Colors.background} />
                  <Text style={s.addSlotBtnText}>Ajouter ce créneau</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ── Time pickers ─────────────────────────────────────────────── */}
      <DateTimePickerModal
        visible={showStartPicker}
        mode="time"
        onClose={() => setShowStartPicker(false)}
        onConfirm={d => {
          setPendingStart(d);
          const endStr = addMins(fmtTimeFromDate(d), durationMin);
          const [eh, em] = endStr.split(':').map(Number);
          const end = new Date(d); end.setHours(eh, em, 0, 0);
          setPendingEnd(end);
          setShowStartPicker(false);
        }}
        initialDate={pendingStart || undefined}
      />
      <DateTimePickerModal
        visible={showEndPicker}
        mode="time"
        onClose={() => setShowEndPicker(false)}
        onConfirm={d => {
          if (pendingStart) {
            const sm = toMins(fmtTimeFromDate(pendingStart));
            const em = d.getHours() * 60 + d.getMinutes();
            if (em <= sm) { Alert.alert('Heure invalide', "La fin doit être après le début"); setShowEndPicker(false); return; }
            if (em - sm < durationMin) { Alert.alert('Durée insuffisante', `Minimum ${durationMin} minutes`); setShowEndPicker(false); return; }
          }
          setPendingEnd(d);
          setShowEndPicker(false);
        }}
        initialDate={pendingEnd || undefined}
      />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  // Navigation
  navRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  // Day grid
  dayGrid: { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: Radius.xl, padding: 10, gap: 2, borderWidth: 1, borderColor: Colors.border },
  dayCell: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6, position: 'relative' },
  dayName: { fontSize: 9, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase' },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayCircleToday: { backgroundColor: Colors.primary, borderWidth: 0 },
  dayCircleSlots: { backgroundColor: ORANGE },
  dayNum: { fontSize: 14, fontWeight: '700', color: Colors.muted },
  dayNumActive: { color: Colors.background },
  monthLabel: { fontSize: 8, color: Colors.muted, fontWeight: '600' },
  slotBadge: { position: 'absolute', top: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  slotBadgeText: { fontSize: 8, fontWeight: '800', color: Colors.background },
  // Slot previews
  slotPreview: { marginTop: 10, gap: 6 },
  slotPreviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  slotDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: ORANGE },
  slotPreviewDay: { fontSize: 12, fontWeight: '700', color: Colors.foreground },
  slotPreviewTimes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 12 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.card, borderRadius: Radius.md, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: Colors.border },
  timeChipText: { fontSize: 12, fontWeight: '700', color: Colors.foreground },
  emptyHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 },
  emptyHintText: { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },
  // Modal
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, paddingHorizontal: Spacing.md },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 16 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  sheetSubtitle: { fontSize: 13, color: Colors.muted, marginTop: 2 },
  cloneBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: ORANGE + '18', borderRadius: Radius.md, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: ORANGE + '40' },
  cloneBtnText: { fontSize: 13, fontWeight: '600', color: ORANGE },
  existingSection: { marginBottom: 16 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  existingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  existingTime: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foreground },
  removeBtn: { padding: 4 },
  addSection: { gap: 10 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.background, borderRadius: Radius.md, padding: 12, borderWidth: 1.5, borderColor: Colors.border },
  timeBtnFilled: { borderColor: ORANGE, backgroundColor: ORANGE + '10' },
  timeBtnText: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  addSlotBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: ORANGE, borderRadius: Radius.full, paddingVertical: 13 },
  addSlotBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
