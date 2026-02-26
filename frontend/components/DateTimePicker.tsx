import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '../constants/Colors';

interface DateTimePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  initialDate?: Date;
  mode?: 'date' | 'time' | 'datetime';
  minDate?: Date;
}

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];
const DAYS_FR = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export function DateTimePickerModal({
  visible, onClose, onConfirm, initialDate, mode = 'datetime', minDate,
}: DateTimePickerModalProps) {
  const today = new Date();
  const init = initialDate || today;

  const [year, setYear] = useState(init.getFullYear());
  const [month, setMonth] = useState(init.getMonth());
  const [day, setDay] = useState(init.getDate());
  const [hour, setHour] = useState(init.getHours());
  const [minute, setMinute] = useState(init.getMinutes());
  const [tab, setTab] = useState<'date' | 'time'>(mode === 'time' ? 'time' : 'date');

  useEffect(() => {
    if (visible) {
      const d = initialDate || new Date();
      setYear(d.getFullYear()); setMonth(d.getMonth());
      setDay(d.getDate()); setHour(d.getHours()); setMinute(d.getMinutes());
      setTab(mode === 'time' ? 'time' : 'date');
    }
  }, [visible]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // First day of month: 0=Sun…6=Sat → convert to Monday-first (0=Mon…6=Sun)
  const rawFirst = new Date(year, month, 1).getDay();
  const firstWeekday = (rawFirst + 6) % 7; // Mon=0

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); setDay(1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); setDay(1); };

  const isDisabled = (d: number) => {
    if (!minDate) return false;
    const candidate = new Date(year, month, d);
    candidate.setHours(0, 0, 0, 0);
    const min = new Date(minDate); min.setHours(0, 0, 0, 0);
    return candidate < min;
  };

  const isToday = (d: number) => {
    return d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  };

  const handleConfirm = () => {
    const result = new Date(year, month, day, hour, minute, 0);
    onConfirm(result);
  };

  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.overlay}>
        <TouchableOpacity style={st.backdrop} activeOpacity={1} onPress={onClose} />
        <SafeAreaView edges={['bottom']} style={st.sheet}>
          {/* Header */}
          <View style={st.header}>
            <TouchableOpacity onPress={onClose} style={st.headerBtn}>
              <Text style={st.headerCancel}>Annuler</Text>
            </TouchableOpacity>
            <Text style={st.headerTitle}>
              {mode === 'time' ? 'Heure' : mode === 'date' ? 'Date' : 'Date & Heure'}
            </Text>
            <TouchableOpacity onPress={handleConfirm} style={st.headerBtn}>
              <Text style={st.headerConfirm}>Confirmer</Text>
            </TouchableOpacity>
          </View>

          {/* Tabs (only for datetime mode) */}
          {mode === 'datetime' && (
            <View style={st.tabs}>
              <TouchableOpacity
                style={[st.tab, tab === 'date' && st.tabActive]}
                onPress={() => setTab('date')}
              >
                <Ionicons name="calendar-outline" size={16} color={tab === 'date' ? Colors.primary : Colors.muted} />
                <Text style={[st.tabText, tab === 'date' && st.tabTextActive]}>Date</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.tab, tab === 'time' && st.tabActive]}
                onPress={() => setTab('time')}
              >
                <Ionicons name="time-outline" size={16} color={tab === 'time' ? Colors.primary : Colors.muted} />
                <Text style={[st.tabText, tab === 'time' && st.tabTextActive]}>Heure</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Date picker */}
          {tab === 'date' && (
            <View style={st.calendarWrap}>
              {/* Month nav */}
              <View style={st.monthNav}>
                <TouchableOpacity onPress={prevMonth} style={st.navBtn}>
                  <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
                </TouchableOpacity>
                <Text style={st.monthTitle}>{MONTHS_FR[month]} {year}</Text>
                <TouchableOpacity onPress={nextMonth} style={st.navBtn}>
                  <Ionicons name="chevron-forward" size={22} color={Colors.foreground} />
                </TouchableOpacity>
              </View>

              {/* Weekday headers */}
              <View style={st.weekRow}>
                {DAYS_FR.map((d, i) => (
                  <Text key={i} style={st.weekDay}>{d}</Text>
                ))}
              </View>

              {/* Day grid */}
              <View style={st.grid}>
                {cells.map((d, i) => {
                  if (!d) return <View key={`e-${i}`} style={st.cell} />;
                  const selected = d === day;
                  const disabled = isDisabled(d);
                  const todayMark = isToday(d);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[st.cell, selected && st.cellSelected, disabled && { opacity: 0.3 }]}
                      onPress={() => !disabled && setDay(d)}
                      disabled={disabled}
                    >
                      {todayMark && !selected && <View style={st.todayDot} />}
                      <Text style={[st.cellText, selected && st.cellTextSelected, todayMark && !selected && { color: Colors.primary }]}>
                        {d}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {mode === 'datetime' && (
                <TouchableOpacity style={st.nextBtn} onPress={() => setTab('time')}>
                  <Text style={st.nextBtnText}>Suivant : Heure</Text>
                  <Ionicons name="arrow-forward" size={16} color={Colors.background} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Time picker */}
          {tab === 'time' && (
            <View style={st.timeWrap}>
              <View style={st.timeRow}>
                {/* Hours */}
                <View style={st.timeCol}>
                  <TouchableOpacity style={st.timeArrow} onPress={() => setHour(h => (h + 1) % 24)}>
                    <Ionicons name="chevron-up" size={24} color={Colors.foreground} />
                  </TouchableOpacity>
                  <View style={st.timeBox}>
                    <Text style={st.timeVal}>{String(hour).padStart(2, '0')}</Text>
                  </View>
                  <TouchableOpacity style={st.timeArrow} onPress={() => setHour(h => (h - 1 + 24) % 24)}>
                    <Ionicons name="chevron-down" size={24} color={Colors.foreground} />
                  </TouchableOpacity>
                  <Text style={st.timeUnitLabel}>Heure</Text>
                </View>

                <Text style={st.timeSep}>:</Text>

                {/* Minutes */}
                <View style={st.timeCol}>
                  <TouchableOpacity style={st.timeArrow} onPress={() => setMinute(m => (m + 5) % 60)}>
                    <Ionicons name="chevron-up" size={24} color={Colors.foreground} />
                  </TouchableOpacity>
                  <View style={st.timeBox}>
                    <Text style={st.timeVal}>{String(minute).padStart(2, '0')}</Text>
                  </View>
                  <TouchableOpacity style={st.timeArrow} onPress={() => setMinute(m => (m - 5 + 60) % 60)}>
                    <Ionicons name="chevron-down" size={24} color={Colors.foreground} />
                  </TouchableOpacity>
                  <Text style={st.timeUnitLabel}>Min</Text>
                </View>
              </View>

              {/* Quick presets */}
              <View style={st.presets}>
                {['07:00', '08:00', '09:00', '10:00', '12:00', '17:00', '18:00', '19:00', '20:00', '21:00'].map(t => {
                  const [h, m] = t.split(':').map(Number);
                  const isSelected = hour === h && minute === m;
                  return (
                    <TouchableOpacity
                      key={t}
                      style={[st.preset, isSelected && st.presetActive]}
                      onPress={() => { setHour(h); setMinute(m); }}
                    >
                      <Text style={[st.presetText, isSelected && st.presetTextActive]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity style={st.confirmBtn} onPress={handleConfirm}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.background} />
                <Text style={st.confirmBtnText}>
                  Confirmer {mode === 'datetime' ? `le ${day} ${MONTHS_FR[month].slice(0, 3)} à ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={{ height: 20 }} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const CELL_SIZE = 44;

const st = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24 },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerBtn: { minWidth: 70 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  headerCancel: { fontSize: 15, color: Colors.muted },
  headerConfirm: { fontSize: 15, fontWeight: '700', color: Colors.primary, textAlign: 'right' },

  tabs: { flexDirection: 'row', margin: Spacing.md, backgroundColor: Colors.card, borderRadius: Radius.md, padding: 4, gap: 4 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: Radius.sm },
  tabActive: { backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },

  calendarWrap: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  navBtn: { padding: 8 },
  monthTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  weekRow: { flexDirection: 'row', marginBottom: 8 },
  weekDay: { width: CELL_SIZE, textAlign: 'center', fontSize: 12, fontWeight: '600', color: Colors.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: CELL_SIZE, height: CELL_SIZE, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  cellSelected: { backgroundColor: Colors.primary, borderRadius: CELL_SIZE / 2 },
  cellText: { fontSize: 15, fontWeight: '500', color: Colors.foreground },
  cellTextSelected: { color: Colors.background, fontWeight: '700' },
  todayDot: { position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.primary },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 13, marginTop: Spacing.md },
  nextBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },

  timeWrap: { padding: Spacing.lg },
  timeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, marginBottom: Spacing.lg },
  timeCol: { alignItems: 'center', gap: 6 },
  timeArrow: { padding: 6 },
  timeBox: { width: 90, height: 80, backgroundColor: Colors.card, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Colors.primary },
  timeVal: { fontSize: 42, fontWeight: '800', color: Colors.primary },
  timeSep: { fontSize: 48, fontWeight: '700', color: Colors.foreground, marginBottom: 30 },
  timeUnitLabel: { fontSize: 11, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: Spacing.lg },
  preset: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  presetActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  presetText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  presetTextActive: { color: Colors.background },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.full, paddingVertical: 14 },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
