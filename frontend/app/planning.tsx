import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

// ── Constantes ─────────────────────────────────────────────────────────────────
const DAYS_SHORT  = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAYS_LONG   = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const STATUS_CFG: Record<string, { color: string }> = {
  accepted:  { color: Colors.primary },
  pending:   { color: '#FF9500' },
  refused:   { color: '#FF4444' },
  cancelled: { color: Colors.muted },
};

function isoDate(d: Date): string {
  // Use local date (not UTC) to avoid timezone issues
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseDate(s: string): Date {
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}
function bookingDate(b: any): string | null {
  return b?.slot?.slot_date ?? b?.scheduled_at?.slice(0, 10) ?? null;
}
function formatDuration(start: string, end: string): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const mins = (eh * 60 + em) - (sh * 60 + sm);
  if (mins >= 60) return `${Math.floor(mins / 60)}h${mins % 60 > 0 ? (mins % 60) + 'min' : ''}`;
  return `${mins} min`;
}

// ── Hauteurs précises des items pour scrollToOffset ──────────────────────────
const ITEM_H = { header: 56, booking: 60, empty: 38 } as const;
type AgendaItem =
  | { kind: 'header'; date: string }
  | { kind: 'booking'; date: string; booking: any }
  | { kind: 'empty'; date: string };

// ── Bande de semaine ───────────────────────────────────────────────────────────
const DAY_W = 48;

function WeekStrip({
  selectedDate,
  dotDates,
  onSelectDate,
}: {
  selectedDate: string;
  dotDates: Set<string>;
  onSelectDate: (d: string) => void;
}) {
  const stripRef = useRef<ScrollView>(null);
  const today = isoDate(new Date());

  // Générer 90 jours autour d'aujourd'hui
  const days = useMemo(() => {
    const list: string[] = [];
    const base = new Date();
    base.setDate(base.getDate() - 30);
    for (let i = 0; i < 90; i++) {
      list.push(isoDate(base));
      base.setDate(base.getDate() + 1);
    }
    return list;
  }, []);

  const dayIndex = days.indexOf(selectedDate);

  // Centrer la date sélectionnée
  useEffect(() => {
    if (dayIndex >= 0) {
      const offset = dayIndex * DAY_W - 160;
      stripRef.current?.scrollTo({ x: Math.max(0, offset), animated: true });
    }
  }, [selectedDate]);

  return (
    <View style={ws.container}>
      {/* En-têtes jours de la semaine */}
      <ScrollView
        ref={stripRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={ws.scroll}
      >
        {days.map((d) => {
          const date = parseDate(d);
          const isSelected = d === selectedDate;
          const isToday = d === today;
          const hasDot = dotDates.has(d);
          const dayName = DAYS_SHORT[date.getDay()];

          return (
            <TouchableOpacity
              key={d}
              style={ws.dayWrap}
              onPress={() => onSelectDate(d)}
              testID={`strip-day-${d}`}
              activeOpacity={0.7}
            >
              <Text style={[ws.dayName, isSelected && ws.dayNameSel, isToday && !isSelected && ws.dayNameToday]}>
                {dayName}
              </Text>
              <View style={[ws.bubble, isSelected && ws.bubbleSel, isToday && !isSelected && ws.bubbleToday]}>
                <Text style={[ws.dayNum, isSelected && ws.dayNumSel, isToday && !isSelected && ws.dayNumToday]}>
                  {date.getDate()}
                </Text>
              </View>
              {hasDot && <View style={[ws.dot, isSelected && ws.dotSel]} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Carte de réservation style Teams ──────────────────────────────────────────
function BookingCard({ booking, onPress }: { booking: any; onPress: () => void }) {
  const sc = STATUS_CFG[booking.status] || STATUS_CFG.pending;
  const slot = booking.slot || {};
  const time = slot.start_time || '--:--';
  const duration = slot.start_time && slot.end_time
    ? formatDuration(slot.start_time, slot.end_time)
    : null;
  const title = booking.service?.title || 'Séance';
  const coach = booking.coach?.name || 'Coach';

  return (
    <TouchableOpacity
      style={bc.row}
      onPress={onPress}
      activeOpacity={0.75}
      testID={`booking-${booking.booking_id}`}
    >
      {/* Colonne heure */}
      <View style={bc.timeCol}>
        <Text style={bc.time}>{time}</Text>
        {duration && <Text style={bc.duration}>{duration}</Text>}
      </View>

      {/* Barre de couleur + Contenu */}
      <View style={[bc.stripe, { backgroundColor: sc.color }]} />
      <View style={bc.content}>
        <Text style={bc.title} numberOfLines={1}>{title}</Text>
        <Text style={bc.sub} numberOfLines={1}>
          {coach}
          {booking.service?.category ? ` · ${booking.service.category}` : ''}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// ── Écran principal ────────────────────────────────────────────────────────────
export default function PlanningScreen() {
  const router = useRouter();
  const today = isoDate(new Date());

  const [bookings, setBookings]     = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [showTodayBtn, setShowTodayBtn] = useState(false);

  const flatRef = useRef<FlatList>(null);
  const dateIndexMap = useRef<Record<string, number>>({});
  const dateOffsetMap = useRef<Record<string, number>>({});

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const data = await api.get<any[]>('/bookings/mine');
      setBookings(Array.isArray(data) ? data : []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Construire la liste agenda ──────────────────────────────────────────────
  const { items, dotDates } = useMemo(() => {
    // Plage : J-30 → J+60 ou jusqu'au dernier booking
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 60);

    // Étendre si on a des bookings plus loin
    bookings.forEach(b => {
      const d = bookingDate(b);
      if (d) {
        const bd = parseDate(d);
        if (bd > endDate) endDate.setTime(bd.getTime());
      }
    });

    // Index bookings par date
    const byDate: Record<string, any[]> = {};
    const dots = new Set<string>();
    bookings.forEach(b => {
      const d = bookingDate(b);
      if (d) {
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(b);
        dots.add(d);
      }
    });

    const result: AgendaItem[] = [];
    const cursor = new Date(startDate);
    let idx = 0;
    const idxMap: Record<string, number> = {};
    const offMap: Record<string, number> = {};
    let curOffset = 0;

    while (cursor <= endDate) {
      const ds = isoDate(cursor);
      idxMap[ds] = idx;
      offMap[ds] = curOffset;
      result.push({ kind: 'header', date: ds });
      idx++;
      curOffset += ITEM_H.header;

      const dayBookings = byDate[ds] || [];
      if (dayBookings.length > 0) {
        // Trier par heure
        dayBookings.sort((a, b) => (a.slot?.start_time || '') < (b.slot?.start_time || '') ? -1 : 1);
        dayBookings.forEach(bk => {
          result.push({ kind: 'booking', date: ds, booking: bk });
          idx++;
          curOffset += ITEM_H.booking;
        });
      } else {
        result.push({ kind: 'empty', date: ds });
        idx++;
        curOffset += ITEM_H.empty;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    dateIndexMap.current = idxMap;
    dateOffsetMap.current = offMap;
    return { items: result, dotDates: dots };
  }, [bookings]);

  // ── Quand on tape une date dans le strip → scroll précis ───────────────────
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    const offset = dateOffsetMap.current[date];
    if (offset !== undefined && flatRef.current) {
      flatRef.current.scrollToOffset({ offset, animated: true });
    }
  }, []);

  // ── Quand on scroll → mettre à jour la date sélectionnée ───────────────────
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    const first = viewableItems.find((vi: any) => vi.item?.kind === 'header');
    if (first) {
      setSelectedDate(first.item.date);
      setShowTodayBtn(first.item.date !== isoDate(new Date()));
    }
  });

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 100,
  });

  // ── Rendu des items ─────────────────────────────────────────────────────────
  const renderItem = useCallback(({ item }: { item: AgendaItem }) => {
    if (item.kind === 'header') {
      const d = parseDate(item.date);
      const isToday = item.date === today;
      return (
        <View style={ag.header} testID={`header-${item.date}`}>
          <Text style={[ag.headerDay, isToday && ag.headerDayToday]}>
            {isToday ? 'Aujourd\'hui' : `${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`}
          </Text>
          <Text style={ag.headerWeekday}>
            {isToday ? `${d.getDate()} ${MONTHS_LONG[d.getMonth()]}` : DAYS_LONG[d.getDay()]}
          </Text>
        </View>
      );
    }

    if (item.kind === 'empty') {
      return (
        <View style={ag.emptyDay}>
          <Text style={ag.emptyTxt}>Aucune séance</Text>
        </View>
      );
    }

    // booking
    const bk = item.booking;
    const svcId = bk.service?.service_id || bk.service_id;

    return (
      <BookingCard
        booking={bk}
        onPress={() => {
          if (svcId) router.push(`/service/${svcId}` as any);
        }}
      />
    );
  }, [today]);

  const keyExtractor = useCallback((item: AgendaItem, index: number) =>
    item.kind === 'header' ? `hdr-${item.date}`
    : item.kind === 'empty' ? `emp-${item.date}-${index}`
    : `bkg-${(item as any).booking.booking_id}-${index}`,
  []);

  // ── Scroll vers la date sélectionnée dès que les items sont prêts ────────────
  const hasScrolled = useRef(false);

  useEffect(() => {
    if (items.length === 0 || hasScrolled.current) return;
    const idx = dateIndexMap.current[selectedDate];
    if (idx !== undefined) {
      // Petit délai pour laisser le FlatList se monter
      setTimeout(() => {
        flatRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0 });
        hasScrolled.current = true;
      }, 150);
    }
  }, [items.length]);

  // Réinitialiser quand on revient sur l'écran
  useFocusEffect(useCallback(() => {
    return () => { hasScrolled.current = false; };
  }, []));

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      {/* Header sticky */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <View style={s.headerCenter}>
            <Text style={s.headerMonth}>
              {MONTHS_LONG[parseDate(selectedDate).getMonth()].charAt(0).toUpperCase()
                + MONTHS_LONG[parseDate(selectedDate).getMonth()].slice(1)}
            </Text>
            <Text style={s.headerYear}>{parseDate(selectedDate).getFullYear()}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Bande de dates */}
        <WeekStrip
          selectedDate={selectedDate}
          dotDates={dotDates}
          onSelectDate={handleSelectDate}
        />
      </SafeAreaView>

      {/* Agenda */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          getItemLayout={(_, index) => ({ length: 72, offset: 72 * index, index })}
          onScrollToIndexFailed={(info) => {
            // Fallback si getItemLayout est imprécis
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index: info.index, animated: true });
            }, 200);
          }}
          onViewableItemsChanged={onViewableItemsChanged.current}
          viewabilityConfig={viewabilityConfig.current}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={Colors.primary}
            />
          }
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}

      {/* Bouton Aujourd'hui (comme Teams) */}
      {showTodayBtn && (
        <TouchableOpacity
          style={s.todayBtn}
          onPress={() => handleSelectDate(today)}
          testID="today-btn"
          activeOpacity={0.85}
        >
          <Ionicons name="arrow-up" size={14} color={Colors.background} />
          <Text style={s.todayTxt}>Aujourd'hui</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const ws = StyleSheet.create({
  container: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingBottom: 6 },
  scroll: { paddingHorizontal: 8 },
  dayWrap: { width: DAY_W, alignItems: 'center', paddingVertical: 4, gap: 3 },
  dayName: { fontSize: 10, fontWeight: '600', color: Colors.muted, letterSpacing: 0.5 },
  dayNameSel: { color: Colors.primary },
  dayNameToday: { color: Colors.primary },
  bubble: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  bubbleSel: { backgroundColor: Colors.primary },
  bubbleToday: { borderWidth: 1.5, borderColor: Colors.primary },
  dayNum: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  dayNumSel: { color: Colors.background },
  dayNumToday: { color: Colors.primary },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  dotSel: { backgroundColor: Colors.background },
});

const ag = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 6, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  headerDay: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  headerDayToday: { color: Colors.primary },
  headerWeekday: { fontSize: 13, color: Colors.muted },
  emptyDay: { paddingHorizontal: 16, paddingVertical: 10 },
  emptyTxt: { fontSize: 13, color: Colors.muted, fontStyle: 'italic' },
});

const bc = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  timeCol: { width: 52, alignItems: 'flex-end', gap: 2 },
  time: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  duration: { fontSize: 11, color: Colors.muted },
  stripe: { width: 3, height: 40, borderRadius: 2 },
  content: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  sub: { fontSize: 12, color: Colors.muted },
});

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerMonth: { fontSize: 20, fontWeight: '700', color: Colors.foreground, lineHeight: 24 },
  headerYear: { fontSize: 13, color: Colors.muted, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  todayBtn: {
    position: 'absolute', bottom: 28, alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, elevation: 4,
    shadowColor: Colors.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 6,
  },
  todayTxt: { fontSize: 13, fontWeight: '700', color: Colors.background },
});
