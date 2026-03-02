import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';

import { api } from '../lib/api';


// ── Helpers ────────────────────────────────────────────────────────────────────
const DAY_W = 52;
const MONTHS_LONG = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const DAYS_LONG   = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
const DAYS_SHORT  = ['D','L','M','M','J','V','S'];

const isoDate = (d: Date) => d.toISOString().split('T')[0];
const parseDate = (s: string) => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d); };

function formatDuration(start: string, end: string) {
  const [h1,m1] = start.split(':').map(Number);
  const [h2,m2] = end.split(':').map(Number);
  const mins = (h2*60+m2) - (h1*60+m1);
  if (mins <= 0) return null;
  return mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h${mins%60 ? (mins%60)+'min' : ''}`;
}

function bookingDate(b: any): string | null {
  return b.slot?.slot_date || b.slot?.date || null;
}

const STATUS_CFG: Record<string, { color: string; label: string }> = {
  confirmed: { color: Colors.primary,  label: 'Confirmé'  },
  pending:   { color: '#F59E0B',        label: 'En attente'},
  cancelled: { color: '#EF4444',        label: 'Annulé'   },
  completed: { color: Colors.muted,     label: 'Terminé'  },
};

// Couleur des événements SpotYou / SpotMe
const EVENT_COLOR    = '#8B5CF6'; // violet — SpotYou
const SPOTME_COLOR   = '#10B981'; // vert emeraude — SpotMe (mes propres événements)
const CANCELLED_COLOR = '#EF4444'; // rouge — annulé
const CONFLICT_COLOR = '#EF4444';

// ── Détection de conflits ──────────────────────────────────────────────────────
const DEFAULT_DURATION_MIN = 60; // durée assumée si pas d'heure de fin

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function intervalsOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  return timeToMin(s1) < timeToMin(e2) && timeToMin(s2) < timeToMin(e1);
}

/** Retourne le Set des IDs d'items en conflit pour une journée donnée.
 *  Clé booking → booking_id, clé event → point_id_date */
function detectDayConflicts(
  bks: any[],
  evts: any[],
): Set<string> {
  // Construire une liste normalisée {id, start, end}
  const timed: { id: string; start: string; end: string }[] = [];

  bks.forEach(b => {
    const start = b.slot?.start_time;
    const end   = b.slot?.end_time;
    if (start) {
      const endFallback = end || `${String(Math.floor(timeToMin(start) / 60 + DEFAULT_DURATION_MIN / 60)).padStart(2,'0')}:${String((timeToMin(start) + DEFAULT_DURATION_MIN) % 60).padStart(2,'0')}`;
      timed.push({ id: b.booking_id, start, end: endFallback });
    }
  });

  evts.forEach(e => {
    if (e.time) {
      const s = e.time;
      const totalMin = timeToMin(s) + DEFAULT_DURATION_MIN;
      const endFallback = `${String(Math.floor(totalMin / 60)).padStart(2,'0')}:${String(totalMin % 60).padStart(2,'0')}`;
      timed.push({ id: `${e.point_id}_${e.date}`, start: s, end: endFallback });
    }
  });

  const conflicts = new Set<string>();
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (intervalsOverlap(timed[i].start, timed[i].end, timed[j].start, timed[j].end)) {
        conflicts.add(timed[i].id);
        conflicts.add(timed[j].id);
      }
    }
  }
  return conflicts;
}

type AgendaItem =
  | { kind: 'header';  date: string }
  | { kind: 'empty';   date: string }
  | { kind: 'booking'; date: string; booking: any }
  | { kind: 'event';   date: string; event: any };

type FilterType = 'all' | 'bookings' | 'events';

// ── Bande de semaine ───────────────────────────────────────────────────────────
function WeekStrip({ selectedDate, dotDates, eventDates, onSelectDate }: {
  selectedDate: string;
  dotDates: Set<string>;
  eventDates: Set<string>;
  onSelectDate: (d: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const today = isoDate(new Date());

  const days = useMemo(() => {
    const arr: string[] = [];
    const start = new Date(); start.setDate(start.getDate() - 30);
    for (let i = 0; i < 91; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      arr.push(isoDate(d));
    }
    return arr;
  }, []);

  // Auto-scroll vers selectedDate dans le strip
  useEffect(() => {
    const idx = days.indexOf(selectedDate);
    if (idx >= 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ x: Math.max(0, idx * DAY_W - 150), animated: true });
    }
  }, [selectedDate, days]);

  return (
    <View style={ws.container}>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false}
        style={ws.scroll} contentContainerStyle={{ paddingHorizontal: 4 }}>
        {days.map(d => {
          const date = parseDate(d);
          const isSelected = d === selectedDate;
          const isToday = d === today;
          const hasDot = dotDates.has(d);
          const hasEvent = eventDates.has(d);
          const dayName = DAYS_SHORT[date.getDay()];

          return (
            <TouchableOpacity key={d} style={ws.dayWrap} onPress={() => onSelectDate(d)}
              testID={`strip-day-${d}`} activeOpacity={0.7}>
              <Text style={[ws.dayName, isSelected && ws.dayNameSel, isToday && !isSelected && ws.dayNameToday]}>
                {dayName}
              </Text>
              <View style={[ws.bubble, isSelected && ws.bubbleSel, isToday && !isSelected && ws.bubbleToday]}>
                <Text style={[ws.dayNum, isSelected && ws.dayNumSel, isToday && !isSelected && ws.dayNumToday]}>
                  {date.getDate()}
                </Text>
              </View>
              <View style={ws.dots}>
                {hasDot   && <View style={[ws.dot, isSelected && ws.dotSel]} />}
                {hasEvent && <View style={[ws.dot, ws.dotEvent, isSelected && ws.dotSel]} />}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Carte de réservation ───────────────────────────────────────────────────────
function BookingCard({ booking, onPress, isConflict }: { booking: any; onPress: () => void; isConflict?: boolean }) {
  const sc = STATUS_CFG[booking.status] || STATUS_CFG.pending;
  const slot = booking.slot || {};
  const time = slot.start_time || '--:--';
  const duration = slot.start_time && slot.end_time ? formatDuration(slot.start_time, slot.end_time) : null;

  return (
    <TouchableOpacity
      style={[bc.row, isConflict && bc.rowConflict]}
      onPress={onPress} activeOpacity={0.75}
      testID={`booking-${booking.booking_id}`}>
      <View style={bc.timeCol}>
        <Text style={[bc.time, isConflict && bc.timeConflict]}>{time}</Text>
        {duration && <Text style={bc.duration}>{duration}</Text>}
      </View>
      <View style={[bc.stripe, { backgroundColor: sc.color }]} />
      <View style={bc.content}>
        <Text style={[bc.title, isConflict && bc.titleConflict]} numberOfLines={1}>
          {booking.service?.title || 'Séance'}
        </Text>
        <Text style={bc.sub} numberOfLines={1}>
          {booking.coach?.name || 'Coach'}
          {booking.service?.category ? ` · ${booking.service.category}` : ''}
        </Text>
      </View>
      <View style={bc.badges}>
        {isConflict && (
          <View style={bc.conflictBadge}>
            <Ionicons name="warning" size={10} color={CONFLICT_COLOR} />
            <Text style={bc.conflictTxt}>Conflit</Text>
          </View>
        )}
        <View style={[bc.badge, { backgroundColor: sc.color + '22' }]}>
          <Text style={[bc.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// ── Carte d'événement SpotYou / SpotMe ────────────────────────────────────────
function EventCard({ event, onPress, isConflict }: { event: any; onPress: () => void; isConflict?: boolean }) {
  const isOwn      = !!event.is_own;
  const isCancelled = !!event.is_cancelled;
  const chipColor  = isCancelled ? CANCELLED_COLOR : (isOwn ? SPOTME_COLOR : EVENT_COLOR);
  const chipLabel  = isCancelled ? 'Annulé' : (isOwn ? 'SpotMe' : 'SpotYou');
  const chipIcon   = isCancelled ? 'close-circle' : (isOwn ? 'star' : 'location');

  return (
    <TouchableOpacity
      style={[ec.row, isConflict && ec.rowConflict, isCancelled && ec.rowCancelled]}
      onPress={onPress} activeOpacity={0.75}
      testID={`event-${event.point_id}-${event.date}`}>
      <View style={ec.timeCol}>
        <Text style={[ec.time, isConflict && ec.timeConflict, isCancelled && ec.timeCancelled]}>{event.time || '--:--'}</Text>
        {event.time && event.end_time && (
          <Text style={[ec.duration, isCancelled && { textDecorationLine: 'line-through' }]}>{formatDuration(event.time, event.end_time)}</Text>
        )}
        {event.type === 'recurring' && (
          <Ionicons name="repeat" size={10} color={chipColor} />
        )}
      </View>
      <View style={[ec.stripe, { backgroundColor: chipColor }]} />
      <View style={ec.content}>
        <Text style={[ec.title, isConflict && ec.titleConflict, isCancelled && ec.titleCancelled]} numberOfLines={1}>{event.title}</Text>
        <Text style={ec.sub} numberOfLines={1}>
          {event.type === 'recurring' ? 'Récurrent · ' : ''}
          {event.owner_name || chipLabel}
        </Text>
      </View>
      <View style={ec.badges}>
        {isConflict && (
          <View style={ec.conflictBadge}>
            <Ionicons name="warning" size={10} color={CONFLICT_COLOR} />
            <Text style={ec.conflictTxt}>Conflit</Text>
          </View>
        )}
        <View style={[ec.chip, { backgroundColor: chipColor + '22' }]}>
          <Ionicons name={chipIcon as any} size={10} color={chipColor} />
          <Text style={[ec.chipTxt, { color: chipColor }]}>{chipLabel}</Text>
        </View>
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
  const [events, setEvents]         = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [showTodayBtn, setShowTodayBtn] = useState(false);
  const [filter, setFilter]         = useState<FilterType>('all');

  const flatRef = useRef<FlatList>(null);
  const dateIndexMap = useRef<Record<string, number>>({});
  const hasScrolledToday = useRef(false);
  const isUserScrolling = useRef(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [bData, eData] = await Promise.all([
        api.get<any[]>('/bookings/mine').catch(() => []),
        api.get<any[]>('/users/me/planning-events').catch(() => []),
      ]);
      setBookings(Array.isArray(bData) ? bData : []);
      setEvents(Array.isArray(eData) ? eData : []);
    } catch {
      setBookings([]);
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Construire la liste agenda ──────────────────────────────────────────────
  const { items, dotDates, eventDates, conflictIds } = useMemo(() => {
    const startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date();   endDate.setDate(endDate.getDate() + 90);

    // Étendre la plage jusqu'au dernier élément
    [...bookings, ...events].forEach(item => {
      const d = item.date ? parseDate(item.date) : (bookingDate(item) ? parseDate(bookingDate(item)!) : null);
      if (d && d > endDate) endDate.setTime(d.getTime());
    });

    // Indexer bookings et events par date
    const byDate: Record<string, { bks: any[]; evts: any[] }> = {};
    const dots = new Set<string>();
    const evtDots = new Set<string>();

    const showBks = filter !== 'events';
    const showEvts = filter !== 'bookings';

    if (showBks) bookings.forEach(b => {
      const d = bookingDate(b);
      if (d) {
        if (!byDate[d]) byDate[d] = { bks: [], evts: [] };
        byDate[d].bks.push(b);
        dots.add(d);
      }
    });
    if (showEvts) events.forEach(e => {
      if (e.date) {
        if (!byDate[e.date]) byDate[e.date] = { bks: [], evts: [] };
        byDate[e.date].evts.push(e);
        evtDots.add(e.date);
      }
    });

    const result: AgendaItem[] = [];
    const cursor = new Date(startDate);
    let idx = 0;
    const idxMap: Record<string, number> = {};
    const allConflicts = new Set<string>();

    while (cursor <= endDate) {
      const ds = isoDate(cursor);
      idxMap[ds] = idx;
      result.push({ kind: 'header', date: ds });
      idx++;

      const day = byDate[ds];
      const allItems: AgendaItem[] = [];

      const dayBks = day?.bks || [];
      const dayEvts = day?.evts || [];

      // Détecter les conflits pour cette journée
      const dayConflicts = detectDayConflicts(dayBks, dayEvts);
      dayConflicts.forEach(id => allConflicts.add(id));

      if (dayBks.length > 0) {
        dayBks
          .sort((a, b) => (a.slot?.start_time || '') < (b.slot?.start_time || '') ? -1 : 1)
          .forEach(bk => allItems.push({ kind: 'booking', date: ds, booking: bk }));
      }
      if (dayEvts.length > 0) {
        dayEvts
          .sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1)
          .forEach(ev => allItems.push({ kind: 'event', date: ds, event: ev }));
      }

      if (allItems.length > 0) {
        allItems.forEach(i => { result.push(i); idx++; });
      } else {
        result.push({ kind: 'empty', date: ds });
        idx++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    dateIndexMap.current = idxMap;
    hasScrolledToday.current = false;
    return { items: result, dotDates: dots, eventDates: evtDots, conflictIds: allConflicts };
  }, [bookings, events, filter]);

  // ── Scroll vers aujourd'hui après chargement ───────────────────────────────
  useEffect(() => {
    if (!loading && items.length > 0 && !hasScrolledToday.current) {
      const todayIdx = dateIndexMap.current[today];
      if (todayIdx !== undefined && flatRef.current) {
        hasScrolledToday.current = true;
        setTimeout(() => {
          flatRef.current?.scrollToIndex({ index: todayIdx, animated: false, viewPosition: 0 });
        }, 150);
      }
    }
  }, [loading, items, today]);

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    const targetIdx = dateIndexMap.current[date];
    if (targetIdx !== undefined && flatRef.current) {
      flatRef.current.scrollToIndex({ index: targetIdx, animated: true, viewPosition: 0 });
    }
  }, []);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    // Mettre à jour la date seulement quand l'utilisateur fait défiler manuellement
    if (!isUserScrolling.current) return;
    const first = viewableItems.find((vi: any) => vi.item?.kind === 'header');
    if (first) {
      setSelectedDate(first.item.date);
      setShowTodayBtn(first.item.date !== isoDate(new Date()));
    }
  });

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 80, minimumViewTime: 100 });

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
          <Text style={ag.emptyTxt}>Aucune activité</Text>
        </View>
      );
    }
    if (item.kind === 'event') {
      const evtKey = `${item.event.point_id}_${item.date}`;
      return (
        <EventCard
          event={item.event}
          isConflict={conflictIds.has(evtKey)}
          onPress={() => router.push(`/spot-you/${item.event.point_id}` as any)}
        />
      );
    }
    // booking
    const bk = (item as any).booking;
    const svcId = bk.service?.service_id || bk.service_id;
    return (
      <BookingCard
        booking={bk}
        isConflict={conflictIds.has(bk.booking_id)}
        onPress={() => { if (svcId) router.push(`/service/${svcId}` as any); }}
      />
    );
  }, [today, conflictIds]);

  const keyExtractor = useCallback((item: AgendaItem, index: number) => {
    if (item.kind === 'header') return `hdr-${item.date}`;
    if (item.kind === 'empty')   return `emp-${item.date}-${index}`;
    if (item.kind === 'event')   return `evt-${(item as any).event.point_id}-${item.date}`;
    return `bkg-${(item as any).booking.booking_id}-${index}`;
  }, []);

  const filterBtnStyle = (f: FilterType) => [
    s.filterBtn,
    filter === f && s.filterBtnActive,
  ];
  const filterTxtStyle = (f: FilterType) => [
    s.filterTxt,
    filter === f && s.filterTxtActive,
  ];

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

        {/* Filtre : Tout / Réservations / Événements */}
        <View style={s.filterBar}>
          <TouchableOpacity style={filterBtnStyle('all')} onPress={() => setFilter('all')} testID="filter-all">
            <Text style={filterTxtStyle('all')}>Tout</Text>
          </TouchableOpacity>
          <TouchableOpacity style={filterBtnStyle('bookings')} onPress={() => setFilter('bookings')} testID="filter-bookings">
            <Ionicons name="calendar" size={12} color={filter === 'bookings' ? Colors.background : Colors.muted} />
            <Text style={filterTxtStyle('bookings')}>Réservations</Text>
          </TouchableOpacity>
          <TouchableOpacity style={filterBtnStyle('events')} onPress={() => setFilter('events')} testID="filter-events">
            <Ionicons name="location" size={12} color={filter === 'events' ? Colors.background : EVENT_COLOR} />
            <Text style={[filterTxtStyle('events'), filter !== 'events' && { color: EVENT_COLOR }]}>Événements</Text>
          </TouchableOpacity>
        </View>

        {/* Bande de dates */}
        <WeekStrip
          selectedDate={selectedDate}
          dotDates={dotDates}
          eventDates={eventDates}
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
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            flatRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
            }, 200);
          }}
          onScrollBeginDrag={() => { isUserScrolling.current = true; }}
          onMomentumScrollEnd={() => { isUserScrolling.current = false; }}
          onScrollEndDrag={() => { isUserScrolling.current = false; }}
          onViewableItemsChanged={onViewableItemsChanged.current}
          viewabilityConfig={viewabilityConfig.current}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}

      {/* Bouton Aujourd'hui */}
      {showTodayBtn && (
        <TouchableOpacity style={s.todayBtn} onPress={() => handleSelectDate(today)}
          testID="today-btn" activeOpacity={0.85}>
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
  dayWrap: { width: DAY_W, alignItems: 'center', paddingVertical: 4, gap: 2 },
  dayName: { fontSize: 10, fontWeight: '600', color: Colors.muted, letterSpacing: 0.5 },
  dayNameSel: { color: Colors.primary },
  dayNameToday: { color: Colors.primary },
  bubble: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  bubbleSel: { backgroundColor: Colors.primary },
  bubbleToday: { borderWidth: 1.5, borderColor: Colors.primary },
  dayNum: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  dayNumSel: { color: Colors.background },
  dayNumToday: { color: Colors.primary },
  dots: { flexDirection: 'row', gap: 2, height: 6, alignItems: 'center' },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  dotEvent: { backgroundColor: EVENT_COLOR },
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
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  rowConflict: { backgroundColor: '#EF444408' },
  timeCol: { width: 52, alignItems: 'flex-end', gap: 2 },
  time: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  timeConflict: { color: CONFLICT_COLOR },
  duration: { fontSize: 11, color: Colors.muted },
  stripe: { width: 3, height: 40, borderRadius: 2 },
  content: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  titleConflict: { color: CONFLICT_COLOR },
  sub: { fontSize: 12, color: Colors.muted },
  badges: { flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
  conflictBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EF444422', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  conflictTxt: { fontSize: 10, fontWeight: '700', color: CONFLICT_COLOR },
});

const ec = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  rowConflict: { backgroundColor: '#EF444408' },
  rowCancelled: { opacity: 0.55 },
  timeCol: { width: 52, alignItems: 'flex-end', gap: 2 },
  time: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  timeConflict: { color: CONFLICT_COLOR },
  timeCancelled: { textDecorationLine: 'line-through' as const },
  duration: { fontSize: 11, color: Colors.muted },
  stripe: { width: 3, height: 40, borderRadius: 2 },
  content: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  titleConflict: { color: CONFLICT_COLOR },
  titleCancelled: { textDecorationLine: 'line-through' as const },
  sub: { fontSize: 12, color: Colors.muted },
  badges: { flexDirection: 'column', alignItems: 'flex-end', gap: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: EVENT_COLOR + '1A', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  chipTxt: { fontSize: 10, fontWeight: '700', color: EVENT_COLOR },
  conflictBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#EF444422', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  conflictTxt: { fontSize: 10, fontWeight: '700', color: CONFLICT_COLOR },
});

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerMonth: { fontSize: 20, fontWeight: '700', color: Colors.foreground, lineHeight: 24 },
  headerYear: { fontSize: 13, color: Colors.muted, fontWeight: '500' },
  filterBar: {
    flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  filterBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
  },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterTxt: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  filterTxtActive: { color: Colors.background },
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
