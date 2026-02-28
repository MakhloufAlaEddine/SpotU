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
const TEAL_BORDER = 'rgba(0,191,165,0.35)';
const TEAL_DASHED = '#00BFA5';

const MONTHS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const MONTHS_LONG = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
const DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const DAYS_LONG = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
const DAYS_SHORT3 = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

const HOURS = [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22];
const MINUTES = [0,15,30,45];

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
      dayName: DAYS[i], dayLong: DAYS_LONG[i], dayShort: DAYS_SHORT3[i],
      dayNum: d.getDate(), monthAbbr: MONTHS[d.getMonth()], monthLong: MONTHS_LONG[d.getMonth()],
      showMonth: d.getDate() === 1,
    };
  });
}

function getWeekRangeLabel(days: ReturnType<typeof getWeekDays>) {
  const f = days[0], l = days[6];
  if (f.date.getMonth() === l.date.getMonth())
    return `${f.dayNum} – ${l.dayNum} ${MONTHS[l.date.getMonth()]}`;
  return `${f.dayNum} ${MONTHS[f.date.getMonth()]} – ${l.dayNum} ${MONTHS[l.date.getMonth()]}`;
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

// ─── Inline Time Picker ───────────────────────────────────────────────────────
function InlineTimePicker({ title, hour, minute, previewEnd, onHourChange, onMinuteChange, onConfirm, onCancel }: {
  title: string; hour: number; minute: number; previewEnd?: string;
  onHourChange: (h: number) => void; onMinuteChange: (m: number) => void;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <View style={tp.container}>
      <View style={tp.header}>
        <Text style={tp.title}>{title}</Text>
        <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={20} color={Colors.muted} />
        </TouchableOpacity>
      </View>
      <Text style={tp.label}>Heure</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: 6, paddingBottom: 2 }}>
          {HOURS.map(h => (
            <TouchableOpacity key={h} style={[tp.unit, hour === h && tp.unitActive]} onPress={() => onHourChange(h)} testID={`hour-${h}`}>
              <Text style={[tp.unitText, hour === h && tp.unitTextActive]}>{String(h).padStart(2,'0')}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
      <Text style={tp.label}>Minutes</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {MINUTES.map(m => (
          <TouchableOpacity key={m} style={[tp.unit, tp.unitMin, minute === m && tp.unitActive]} onPress={() => onMinuteChange(m)} testID={`minute-${m}`}>
            <Text style={[tp.unitText, minute === m && tp.unitTextActive]}>{String(m).padStart(2,'0')}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={tp.preview}>
        <Ionicons name="time-outline" size={15} color={TEAL} />
        <Text style={tp.previewText}>
          {fmtTime(hour, minute)}{previewEnd ? ` → ${previewEnd}` : ''}
        </Text>
      </View>
      <TouchableOpacity style={tp.confirmBtn} onPress={onConfirm} testID="confirm-time">
        <Ionicons name="checkmark-circle" size={18} color={Colors.background} />
        <Text style={tp.confirmBtnText}>Confirmer</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Slot Row Component ───────────────────────────────────────────────────────
function SlotRow({ startTime, endTime, onStartPress, onEndPress, onDelete, startActive, endActive, testId }: {
  startTime: string; endTime: string | null;
  onStartPress: () => void; onEndPress?: () => void; onDelete: () => void;
  startActive?: boolean; endActive?: boolean; testId?: string;
}) {
  return (
    <View style={sr.row} testID={testId}>
      {/* Start time button */}
      <TouchableOpacity style={[sr.timeBtn, startActive && sr.timeBtnActive]} onPress={onStartPress} testID="start-btn">
        <Ionicons name="play-circle-outline" size={18} color={startTime !== 'Début' ? TEAL : Colors.muted} />
        <Text style={[sr.timeBtnText, startTime !== 'Début' && sr.timeBtnTextFilled]}>{startTime}</Text>
      </TouchableOpacity>
      {/* End time button */}
      <TouchableOpacity
        style={[sr.timeBtn, endActive && sr.timeBtnActive]}
        onPress={onEndPress}
        testID="end-btn"
      >
        <Ionicons name="stop-circle-outline" size={18} color={endTime ? TEAL : Colors.muted} />
        <Text style={[sr.timeBtnText, endTime ? sr.timeBtnTextFilled : sr.timeBtnTextMuted]}>
          {endTime || 'Fin ?'}
        </Text>
      </TouchableOpacity>
      {/* Delete X button */}
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

  // Inline time picker state
  const [showPicker, setShowPicker] = useState(false);
  const [pickingField, setPickingField] = useState<'start' | 'end'>('start');
  const [pickerHour, setPickerHour] = useState(9);
  const [pickerMinute, setPickerMinute] = useState(0);

  // Pending new slot
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

  const handleDayPress = (dateStr: string) => {
    setSelectedDate(dateStr);
    setPendingStartStr(null);
    setPendingEndStr(null);
    setShowPicker(false);
    setShowDayModal(true);
  };

  const openStartPicker = () => {
    setPickingField('start');
    if (pendingStartStr) { const [h, m] = pendingStartStr.split(':').map(Number); setPickerHour(h); setPickerMinute(m); }
    else { setPickerHour(9); setPickerMinute(0); }
    setShowPicker(true);
  };

  const openEndPicker = () => {
    if (!pendingStartStr) { Alert.alert('', "Définissez d'abord l'heure de début"); return; }
    setPickingField('end');
    if (pendingEndStr) { const [h, m] = pendingEndStr.split(':').map(Number); setPickerHour(h); setPickerMinute(m); }
    else { const ae = addMins(pendingStartStr, durationMin); const [h, m] = ae.split(':').map(Number); setPickerHour(h); setPickerMinute(m); }
    setShowPicker(true);
  };

  const confirmPickerTime = () => {
    const timeStr = fmtTime(pickerHour, pickerMinute);
    if (pickingField === 'start') {
      setPendingStartStr(timeStr);
      setPendingEndStr(addMins(timeStr, durationMin));
    } else {
      if (pendingStartStr) {
        if (toMins(timeStr) <= toMins(pendingStartStr)) { Alert.alert('Heure invalide', 'La fin doit être après le début'); return; }
        if (toMins(timeStr) - toMins(pendingStartStr) < durationMin) { Alert.alert('Durée insuffisante', `Minimum ${durationMin} minutes`); return; }
      }
      setPendingEndStr(timeStr);
    }
    setShowPicker(false);
  };

  const handleAddSlot = () => {
    if (!selectedDate || !pendingStartStr || !pendingEndStr) return;
    const daySlots = getDateSlots(selectedDate);
    if (hasOverlap(daySlots, pendingStartStr, pendingEndStr)) {
      Alert.alert('Chevauchement', `${pendingStartStr}→${pendingEndStr} chevauche un créneau existant.`); return;
    }
    onSlotsChange([...slots, {
      id: `slot_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      date: selectedDate, startTime: pendingStartStr, endTime: pendingEndStr,
    }]);
    setPendingStartStr(null);
    setPendingEndStr(null);
    setShowPicker(false);
  };

  const selectedDaySlots = selectedDate ? getDateSlots(selectedDate) : [];
  const selectedDayInfo = selectedDate
    ? weekDays.find(d => d.dateStr === selectedDate) || (() => {
        const d = new Date(selectedDate + 'T00:00:00');
        return { dayShort: DAYS_SHORT3[d.getDay() === 0 ? 6 : d.getDay() - 1], dayLong: DAYS_LONG[d.getDay() === 0 ? 6 : d.getDay() - 1], dayNum: d.getDate(), monthLong: MONTHS_LONG[d.getMonth()] };
      })() : null;

  const hasPendingSlot = pendingStartStr !== null;
  const totalSlots = selectedDaySlots.length + (hasPendingSlot && pendingEndStr ? 1 : 0);

  const pickerPreviewEnd = pickingField === 'start'
    ? addMins(fmtTime(pickerHour, pickerMinute), durationMin)
    : undefined;

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

      {/* ── Day cards (slot summary below calendar) ───────────────────── */}
      {weekDays.filter(d => getDateSlots(d.dateStr).length > 0).map(day => (
        <TouchableOpacity
          key={day.dateStr}
          style={s.dayCard}
          onPress={() => handleDayPress(day.dateStr)}
          activeOpacity={0.8}
          testID={`day-card-${day.dateStr}`}
        >
          <View style={s.dayCardHeader}>
            <View style={s.dayCardDot} />
            <Text style={s.dayCardTitle}>{day.dayShort}</Text>
            <Text style={s.dayCardCount}>{getDateSlots(day.dateStr).length} créneau{getDateSlots(day.dateStr).length > 1 ? 'x' : ''}</Text>
          </View>
          <View style={s.dayCardSlots}>
            {getDateSlots(day.dateStr).map(slot => (
              <View key={slot.id} style={s.dayCardSlotRow}>
                <Ionicons name="play-circle-outline" size={14} color={TEAL} />
                <Text style={s.dayCardSlotTime}>{slot.startTime}</Text>
                <Ionicons name="arrow-forward" size={11} color={Colors.muted} />
                <Text style={s.dayCardSlotTime}>{slot.endTime}</Text>
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

      {/* ── Day Modal ────────────────────────────────────────────────── */}
      <Modal visible={showDayModal} animationType="slide" transparent onRequestClose={() => { setShowDayModal(false); setShowPicker(false); }}>
        <View style={s.overlayContainer}>
          <TouchableOpacity style={s.backdropDismiss} activeOpacity={1} onPress={() => { setShowDayModal(false); setShowPicker(false); }} />
          <View style={s.sheet}>
            <View style={s.sheetHandle} />

            {/* ── Card header: dot + day + count + close ── */}
            <View style={s.cardHeader}>
              <View style={s.cardDot} />
              <Text style={s.cardTitle}>
                {selectedDayInfo ? (selectedDayInfo as any).dayLong : ''}
              </Text>
              <Text style={s.cardCount}>
                {totalSlots} créneau{totalSlots !== 1 ? 'x' : ''}
              </Text>
              <TouchableOpacity onPress={() => { setShowDayModal(false); setShowPicker(false); }} style={s.closeBtn}>
                <Text style={s.closeBtnText}>×</Text>
              </TouchableOpacity>
            </View>

            {/* ── Time picker inline ── */}
            {showPicker ? (
              <InlineTimePicker
                title={pickingField === 'start' ? 'Heure de début' : 'Heure de fin'}
                hour={pickerHour}
                minute={pickerMinute}
                previewEnd={pickerPreviewEnd}
                onHourChange={setPickerHour}
                onMinuteChange={setPickerMinute}
                onConfirm={confirmPickerTime}
                onCancel={() => setShowPicker(false)}
              />
            ) : (
              <View style={s.slotsSection}>
                {/* ── Existing saved slots ── */}
                {selectedDaySlots.map(slot => (
                  <SlotRow
                    key={slot.id}
                    startTime={slot.startTime}
                    endTime={slot.endTime}
                    startActive={false}
                    endActive={false}
                    onStartPress={() => {}}
                    onEndPress={() => {}}
                    onDelete={() => onSlotsChange(slots.filter(ss => ss.id !== slot.id))}
                    testId={`existing-slot-${slot.id}`}
                  />
                ))}

                {/* ── Pending new slot ── */}
                {hasPendingSlot && (
                  <SlotRow
                    startTime={pendingStartStr || 'Début'}
                    endTime={pendingEndStr}
                    startActive={true}
                    endActive={false}
                    onStartPress={openStartPicker}
                    onEndPress={openEndPicker}
                    onDelete={() => { setPendingStartStr(null); setPendingEndStr(null); }}
                    testId="pending-slot-row"
                  />
                )}

                {/* ── Add confirm button (when pending slot is ready) ── */}
                {hasPendingSlot && pendingEndStr && (
                  <TouchableOpacity style={s.confirmAddBtn} onPress={handleAddSlot} testID="confirm-slot">
                    <Ionicons name="add-circle" size={18} color={Colors.background} />
                    <Text style={s.confirmAddBtnText}>Enregistrer ce créneau</Text>
                  </TouchableOpacity>
                )}

                {/* ── Add new créneau dashed button ── */}
                {!hasPendingSlot && (
                  <TouchableOpacity style={s.addDashedBtn} onPress={openStartPicker} testID="add-slot-btn">
                    <Ionicons name="add-circle-outline" size={22} color={TEAL} />
                    <Text style={s.addDashedBtnText}>Ajouter un créneau</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── SlotRow Styles ───────────────────────────────────────────────────────────
const sr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  timeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.background, borderRadius: Radius.lg,
    paddingHorizontal: 14, paddingVertical: 16,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  timeBtnActive: { borderColor: TEAL, backgroundColor: 'rgba(0,191,165,0.08)' },
  timeBtnText: { fontSize: 17, fontWeight: '800' },
  timeBtnTextFilled: { color: TEAL },
  timeBtnTextMuted: { color: Colors.muted, fontWeight: '600', fontSize: 15 },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 20, fontWeight: '400', color: Colors.muted, lineHeight: 22 },
});

// ─── InlineTimePicker Styles ──────────────────────────────────────────────────
const tp = StyleSheet.create({
  container: { gap: 10, paddingTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  label: { fontSize: 10, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  unit: { width: 42, height: 42, borderRadius: 10, backgroundColor: Colors.background, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  unitMin: { width: 54 },
  unitActive: { backgroundColor: 'rgba(0,191,165,0.15)', borderColor: TEAL },
  unitText: { fontSize: 14, fontWeight: '700', color: Colors.muted },
  unitTextActive: { color: TEAL },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,191,165,0.10)', borderRadius: Radius.md, padding: 10, borderWidth: 1, borderColor: 'rgba(0,191,165,0.30)' },
  previewText: { fontSize: 15, fontWeight: '800', color: TEAL },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: TEAL, borderRadius: Radius.full, paddingVertical: 12 },
  confirmBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
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
  // Day cards below calendar
  dayCard: {
    marginTop: 10, backgroundColor: Colors.card, borderRadius: Radius.xl,
    padding: 14, borderWidth: 1, borderColor: Colors.border, gap: 10,
  },
  dayCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayCardDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: TEAL },
  dayCardTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, flex: 1 },
  dayCardCount: { fontSize: 13, color: Colors.muted, fontWeight: '500' },
  dayCardSlots: { gap: 4, paddingLeft: 16 },
  dayCardSlotRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dayCardSlotTime: { fontSize: 13, fontWeight: '700', color: TEAL },
  emptyHint: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 4 },
  emptyHintText: { fontSize: 12, color: Colors.muted, fontStyle: 'italic' },
  // Modal
  overlayContainer: { flex: 1, justifyContent: 'flex-end' },
  backdropDismiss: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, paddingHorizontal: Spacing.md },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginTop: 10, marginBottom: 16 },
  // Card header in modal
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  cardDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: TEAL },
  cardTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground, flex: 1 },
  cardCount: { fontSize: 13, color: Colors.muted },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.backgroundSecondary, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 22, color: Colors.muted, lineHeight: 24 },
  // Slots section
  slotsSection: { gap: 4 },
  // Confirm add button
  confirmAddBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: TEAL, borderRadius: Radius.full, paddingVertical: 13, marginTop: 4 },
  confirmAddBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
  // Add dashed button
  addDashedBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: Radius.lg, padding: 18, marginTop: 4,
    borderWidth: 2, borderColor: TEAL_DASHED, borderStyle: 'dashed',
    backgroundColor: TEAL_BG,
  },
  addDashedBtnText: { fontSize: 16, fontWeight: '700', color: TEAL },
});
