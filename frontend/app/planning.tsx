import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl, InteractionManager,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '../constants/Colors';
import { api } from '../lib/api';

const CACHE_KEY = 'planning_events_cache';


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

// Couleur des événements SpotYou / SpotMe / Réservations
const EVENT_COLOR    = '#8B5CF6'; // violet — SpotYou
const SPOTME_COLOR   = '#10B981'; // vert emeraude — SpotMe (mes propres événements)
const BOOKING_COLOR  = '#0A84FF'; // bleu — Réservation (payeur)
const BOOKING_OWN_COLOR = '#FF9500'; // orange — Réservation reçue (coach)
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

/** Retourne le Set des IDs d'événements en conflit pour une journée donnée. */
function detectDayConflicts(evts: any[]): Set<string> {
  const timed: { id: string; start: string; end: string }[] = [];

  evts.forEach(e => {
    if (e.time) {
      const s = e.time;
      const totalMin = timeToMin(s) + DEFAULT_DURATION_MIN;
      const endFallback = `${String(Math.floor(totalMin / 60)).padStart(2,'0')}:${String(totalMin % 60).padStart(2,'0')}`;
      timed.push({ id: `${e.point_id}_${e.date}`, start: s, end: e.end_time || endFallback });
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
  | { kind: 'header'; date: string }
  | { kind: 'empty';  date: string }
  | { kind: 'event';  date: string; event: any };

type FilterType = 'all' | 'events' | 'bookings';

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

// ── Écran principal ────────────────────────────────────────────────────────────
function EventCard({ event, onPress, isConflict }: { event: any; onPress: () => void; isConflict?: boolean }) {
  const isBooking   = event.type === 'booking';
  const isPayer     = event.is_payer !== false;
  const isOwn       = !!event.is_own;
  const isCancelled = !!event.is_cancelled;
  const isPending   = isBooking && event.booking_status === 'awaiting_payment';

  let chipColor: string;
  let chipLabel: string;
  let chipIcon: string;

  if (isCancelled) {
    chipColor = CANCELLED_COLOR; chipLabel = 'Annulé'; chipIcon = 'close-circle';
  } else if (isBooking) {
    chipColor = isPayer ? BOOKING_COLOR : BOOKING_OWN_COLOR;
    chipLabel = isPending ? 'En attente' : (isPayer ? 'Réservé' : 'Réservation');
    chipIcon  = isPending ? 'time-outline' : 'calendar';
  } else if (isOwn) {
    chipColor = SPOTME_COLOR; chipLabel = 'SpotMe'; chipIcon = 'star';
  } else {
    chipColor = EVENT_COLOR; chipLabel = 'SpotYou'; chipIcon = 'location';
  }

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

  const [events, setEvents]         = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(today);
  const [showTodayBtn, setShowTodayBtn] = useState(false);
  const [filter, setFilter]         = useState<FilterType>('all');
  const [focusTrigger, setFocusTrigger] = useState(0);

  const flatRef = useRef<FlatList>(null);
  const dateIndexMap = useRef<Record<string, number>>({});
  const hasScrolledToday = useRef(false);
  const isProgrammaticScroll = useRef(false);

  // Fetch frais en arrière-plan, applique la diff si besoin
  const fetchAndSync = useCallback(async () => {
    try {
      const fresh = await api.get<any[]>('/users/me/planning-events').catch(() => null);
      if (!fresh) return;
      const freshArr = Array.isArray(fresh) ? fresh : [];
      const cached = await AsyncStorage.getItem(CACHE_KEY);
      const hasChanged = JSON.stringify(freshArr) !== cached;
      if (hasChanged) {
        setEvents(freshArr);
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(freshArr));
      }
    } catch (_) {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    hasScrolledToday.current = false;
    setSelectedDate(today);
    setFocusTrigger(t => t + 1);

    AsyncStorage.getItem(CACHE_KEY).then(cached => {
      if (cached) {
        const cachedArr = JSON.parse(cached);
        setEvents(Array.isArray(cachedArr) ? cachedArr : []);
        setLoading(false);
      } else {
        setLoading(true);
      }
      fetchAndSync();
    }).catch(() => {
      setLoading(true);
      fetchAndSync();
    });
  }, [fetchAndSync]));

  // ── Construire la liste agenda ──────────────────────────────────────────────
  // ── Filtre des événements selon le type sélectionné ──────────────────────
  const filteredEvents = useMemo(() => {
    if (filter === 'bookings') return events.filter(e => e.type === 'booking');
    if (filter === 'events')   return events.filter(e => e.type !== 'booking');
    return events;
  }, [events, filter]);

  const { items, dotDates, eventDates, conflictIds } = useMemo(() => {
    const startDate = new Date(); startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date();   endDate.setDate(endDate.getDate() + 90);

    filteredEvents.forEach(item => {
      if (item.date) {
        const d = parseDate(item.date);
        if (d > endDate) endDate.setTime(d.getTime());
      }
    });

    const byDate: Record<string, any[]> = {};
    const dots = new Set<string>();
    const evtDots = new Set<string>();

    filteredEvents.forEach(e => {
      if (e.date) {
        if (!byDate[e.date]) byDate[e.date] = [];
        byDate[e.date].push(e);
        evtDots.add(e.date);
        dots.add(e.date);
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

      const dayEvts = (byDate[ds] || []).sort((a, b) => (a.time || '') < (b.time || '') ? -1 : 1);
      const dayConflicts = detectDayConflicts(dayEvts);
      dayConflicts.forEach(id => allConflicts.add(id));

      if (dayEvts.length > 0) {
        dayEvts.forEach(ev => { result.push({ kind: 'event', date: ds, event: ev }); idx++; });
      } else {
        result.push({ kind: 'empty', date: ds });
        idx++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    dateIndexMap.current = idxMap;
    return { items: result, dotDates: dots, eventDates: evtDots, conflictIds: allConflicts };
  }, [filteredEvents]);

  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    const targetIdx = dateIndexMap.current[date];
    if (targetIdx !== undefined && flatRef.current) {
      isProgrammaticScroll.current = true;
      flatRef.current.scrollToIndex({ index: targetIdx, animated: true, viewPosition: 0 });
    }
  }, []);

  // Scroll vers aujourd'hui après chaque prise de focus, une fois les items prêts
  useEffect(() => {
    if (focusTrigger === 0 || loading || items.length === 0) return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!hasScrolledToday.current) {
        hasScrolledToday.current = true;
        handleSelectDate(today);
      }
    });
    return () => task.cancel();
  }, [focusTrigger, loading, items.length, today, handleSelectDate]);

  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    // Ignorer les mises à jour déclenchées par un scroll programmatique (tap sur calendrier)
    if (isProgrammaticScroll.current) return;
    const first = viewableItems.find((vi: any) => vi.item?.kind === 'header');
    if (first) {
      setSelectedDate(first.item.date);
      setShowTodayBtn(first.item.date !== isoDate(new Date()));
    }
  });

  // Seuils bas : déclenche dès qu'un header entre dans le viewport, sans délai minimum
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 10, minimumViewTime: 0 });

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
      const isBooking = item.event.type === 'booking';
      return (
        <EventCard
          event={item.event}
          isConflict={conflictIds.has(evtKey)}
          onPress={() => {
            if (isBooking) {
              router.push('/bookings' as any);
            } else {
              router.push(`/spot-you/${item.event.point_id}` as any);
            }
          }}
        />
      );
    }
    return null;
  }, [today, conflictIds]);

  const keyExtractor = useCallback((item: AgendaItem, index: number) => {
    if (item.kind === 'header') return `hdr-${item.date}`;
    if (item.kind === 'empty')   return `emp-${item.date}-${index}`;
    if (item.kind === 'event')   return `evt-${(item as any).event.point_id}-${item.date}`;
    return `item-${index}`;
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
              {MONTHS_LONG[parseDate(selectedDate || today).getMonth()].charAt(0).toUpperCase()
                + MONTHS_LONG[parseDate(selectedDate || today).getMonth()].slice(1)}
            </Text>
            <Text style={s.headerYear}>{parseDate(selectedDate || today).getFullYear()}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Filtre : Tout / Événements / Réservations */}
        <View style={s.filterBar}>
          <TouchableOpacity style={filterBtnStyle('all')} onPress={() => setFilter('all')} testID="filter-all">
            <Text style={filterTxtStyle('all')}>Tout</Text>
          </TouchableOpacity>
          <TouchableOpacity style={filterBtnStyle('events')} onPress={() => setFilter('events')} testID="filter-events">
            <Ionicons name="location" size={12} color={filter === 'events' ? Colors.background : EVENT_COLOR} />
            <Text style={[filterTxtStyle('events'), filter !== 'events' && { color: EVENT_COLOR }]}>Événements</Text>
          </TouchableOpacity>
          <TouchableOpacity style={filterBtnStyle('bookings')} onPress={() => setFilter('bookings')} testID="filter-bookings">
            <Ionicons name="calendar" size={12} color={filter === 'bookings' ? Colors.background : BOOKING_COLOR} />
            <Text style={[filterTxtStyle('bookings'), filter !== 'bookings' && { color: BOOKING_COLOR }]}>Réservations</Text>
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

      {/* Skeleton pendant le chargement initial */}
      {loading ? (
        <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 12 }}>
          {[0,1,2,3,4,5,6].map(i => (
            <View key={i} style={{ marginBottom: 14 }}>
              <View style={{ width: 130, height: 14, borderRadius: 7, backgroundColor: Colors.card, marginBottom: 10 }} />
              <View style={{ height: 68, borderRadius: 14, backgroundColor: Colors.card, flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 }}>
                <View style={{ width: 4, height: 40, borderRadius: 2, backgroundColor: Colors.border }} />
                <View style={{ flex: 1, gap: 9 }}>
                  <View style={{ width: '65%', height: 11, borderRadius: 6, backgroundColor: Colors.border }} />
                  <View style={{ width: '40%', height: 9, borderRadius: 5, backgroundColor: Colors.border }} />
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : (
        /* Données prêtes : FlatList visible directement, handleSelectDate(today) a déjà scrollé */
        <FlatList
          ref={flatRef}
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            flatRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
            }, 200);
          }}
          onScrollBeginDrag={() => { isProgrammaticScroll.current = false; }}
          onMomentumScrollEnd={() => { isProgrammaticScroll.current = false; }}
          onViewableItemsChanged={onViewableItemsChanged.current}
          viewabilityConfig={viewabilityConfig.current}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAndSync(); }} tintColor={Colors.primary} />
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
