import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/Colors';
import { Spacing, Radius } from '../constants/Spacing';
import { api } from '../lib/api';
import WeekStrip from '../components/WeekStrip';

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

// Couleur des événements SpotYou
const EVENT_COLOR = '#8B5CF6';

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
function BookingCard({ booking, onPress }: { booking: any; onPress: () => void }) {
  const sc = STATUS_CFG[booking.status] || STATUS_CFG.pending;
  const slot = booking.slot || {};
  const time = slot.start_time || '--:--';
  const duration = slot.start_time && slot.end_time ? formatDuration(slot.start_time, slot.end_time) : null;

  return (
    <TouchableOpacity style={bc.row} onPress={onPress} activeOpacity={0.75}
      testID={`booking-${booking.booking_id}`}>
      <View style={bc.timeCol}>
        <Text style={bc.time}>{time}</Text>
        {duration && <Text style={bc.duration}>{duration}</Text>}
      </View>
      <View style={[bc.stripe, { backgroundColor: sc.color }]} />
      <View style={bc.content}>
        <Text style={bc.title} numberOfLines={1}>{booking.service?.title || 'Séance'}</Text>
        <Text style={bc.sub} numberOfLines={1}>
          {booking.coach?.name || 'Coach'}
          {booking.service?.category ? ` · ${booking.service.category}` : ''}
        </Text>
      </View>
      <View style={[bc.badge, { backgroundColor: sc.color + '22' }]}>
        <Text style={[bc.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
    </TouchableOpacity>
  );
}

// ── Carte d'événement SpotYou ──────────────────────────────────────────────────
function EventCard({ event, onPress }: { event: any; onPress: () => void }) {
  return (
    <TouchableOpacity style={ec.row} onPress={onPress} activeOpacity={0.75}
      testID={`event-${event.point_id}-${event.date}`}>
      <View style={ec.timeCol}>
        <Text style={ec.time}>{event.time || '--:--'}</Text>
        {event.type === 'recurring' && (
          <Ionicons name="repeat" size={10} color={EVENT_COLOR} />
        )}
      </View>
      <View style={[ec.stripe, { backgroundColor: EVENT_COLOR }]} />
      <View style={ec.content}>
        <Text style={ec.title} numberOfLines={1}>{event.title}</Text>
        <Text style={ec.sub} numberOfLines={1}>
          {event.type === 'recurring' ? 'Récurrent · ' : ''}
          {event.owner_name || 'SpotYou'}
        </Text>
      </View>
      <View style={ec.chip}>
        <Ionicons name="location" size={10} color={EVENT_COLOR} />
        <Text style={ec.chipTxt}>SpotYou</Text>
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
  const { items, dotDates, eventDates } = useMemo(() => {
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

    while (cursor <= endDate) {
      const ds = isoDate(cursor);
      idxMap[ds] = idx;
      result.push({ kind: 'header', date: ds });
      idx++;

      const day = byDate[ds];
      const allItems: AgendaItem[] = [];

      if (day?.bks?.length) {
        day.bks
          .sort((a, b) => (a.slot?.start_time || '') < (b.slot?.start_time || '') ? -1 : 1)
          .forEach(bk => allItems.push({ kind: 'booking', date: ds, booking: bk }));
      }
      if (day?.evts?.length) {
        day.evts
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
    return { items: result, dotDates: dots, eventDates: evtDots };
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
      return (
        <EventCard
          event={item.event}
          onPress={() => router.push(`/spot-you/${item.event.point_id}` as any)}
        />
      );
    }
    // booking
    const bk = (item as any).booking;
    const svcId = bk.service?.service_id || bk.service_id;
    return (
      <BookingCard booking={bk} onPress={() => { if (svcId) router.push(`/service/${svcId}` as any); }} />
    );
  }, [today]);

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
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  timeCol: { width: 52, alignItems: 'flex-end', gap: 2 },
  time: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  duration: { fontSize: 11, color: Colors.muted },
  stripe: { width: 3, height: 40, borderRadius: 2 },
  content: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  sub: { fontSize: 12, color: Colors.muted },
  badge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
});

const ec = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  timeCol: { width: 52, alignItems: 'flex-end', gap: 3 },
  time: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  stripe: { width: 3, height: 40, borderRadius: 2 },
  content: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  sub: { fontSize: 12, color: Colors.muted },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: EVENT_COLOR + '1A', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  chipTxt: { fontSize: 10, fontWeight: '700', color: EVENT_COLOR },
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
  const hasScrolledToday = useRef(false);

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

    while (cursor <= endDate) {
      const ds = isoDate(cursor);
      idxMap[ds] = idx;

      result.push({ kind: 'header', date: ds });
      idx++;

      const dayBookings = byDate[ds] || [];
      if (dayBookings.length > 0) {
        dayBookings.sort((a, b) => (a.slot?.start_time || '') < (b.slot?.start_time || '') ? -1 : 1);
        dayBookings.forEach(bk => {
          result.push({ kind: 'booking', date: ds, booking: bk });
          idx++;
        });
      } else {
        result.push({ kind: 'empty', date: ds });
        idx++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    dateIndexMap.current = idxMap;
    hasScrolledToday.current = false; // reset so useEffect re-scrolls to today
    return { items: result, dotDates: dots };
  }, [bookings]);

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

  // ── Quand on tape une date dans le strip → scrollToIndex ──────────────────
  const handleSelectDate = useCallback((date: string) => {
    setSelectedDate(date);
    const targetIdx = dateIndexMap.current[date];
    if (targetIdx !== undefined && flatRef.current) {
      flatRef.current.scrollToIndex({ index: targetIdx, animated: true, viewPosition: 0 });
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
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            // Scroll to approximate position using FlatList's own average measurement
            const approxOffset = index * averageItemLength;
            flatRef.current?.scrollToOffset({ offset: approxOffset, animated: false });
            // Then retry the precise scroll once items are in render window
            setTimeout(() => {
              flatRef.current?.scrollToIndex({ index, animated: false, viewPosition: 0 });
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
