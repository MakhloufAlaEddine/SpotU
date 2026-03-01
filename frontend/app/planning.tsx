import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

const DAYS_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTHS = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'aoû', 'sep', 'oct', 'nov', 'déc'];

const STATUS: Record<string, { label: string; color: string; icon: any }> = {
  pending:   { label: 'En attente',  color: '#FF9500',       icon: 'time-outline' },
  accepted:  { label: 'Acceptée',   color: Colors.primary,  icon: 'checkmark-circle' },
  refused:   { label: 'Refusée',    color: '#FF4444',       icon: 'close-circle' },
  cancelled: { label: 'Annulée',    color: Colors.muted,    icon: 'ban-outline' },
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function bookingDate(b: any): string | null {
  if (b.slot?.slot_date) return b.slot.slot_date;
  if (b.scheduled_at) return b.scheduled_at.slice(0, 10);
  return null;
}

// ── Mini calendrier semaine ────────────────────────────────────────────────────
function WeekStrip({
  weekStart, selected, dotDates, onSelect, onPrev, onNext,
}: {
  weekStart: Date; selected: Date;
  dotDates: Set<string>;
  onSelect: (d: Date) => void;
  onPrev: () => void; onNext: () => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
  const selStr = isoDate(selected);
  const todayStr = isoDate(new Date());

  return (
    <View style={wk.wrap}>
      <View style={wk.monthRow}>
        <TouchableOpacity onPress={onPrev} style={wk.arrow} testID="week-prev">
          <Ionicons name="chevron-back" size={20} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={wk.monthLabel}>
          {MONTHS[weekStart.getMonth()]} {weekStart.getFullYear()}
        </Text>
        <TouchableOpacity onPress={onNext} style={wk.arrow} testID="week-next">
          <Ionicons name="chevron-forward" size={20} color={Colors.foreground} />
        </TouchableOpacity>
      </View>

      <View style={wk.daysRow}>
        {days.map((d) => {
          const ds = isoDate(d);
          const active = ds === selStr;
          const isToday = ds === todayStr;
          const hasDot = dotDates.has(ds);
          return (
            <TouchableOpacity
              key={ds}
              style={[wk.day, active && wk.dayActive]}
              onPress={() => onSelect(d)}
              testID={`day-${ds}`}
            >
              <Text style={[wk.dayName, active && wk.dayNameActive]}>
                {DAYS_SHORT[d.getDay()]}
              </Text>
              <Text style={[wk.dayNum, active && wk.dayNumActive, isToday && !active && wk.dayNumToday]}>
                {d.getDate()}
              </Text>
              {hasDot && <View style={[wk.dot, active && wk.dotActive]} />}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// ── Carte réservation (timeline) ──────────────────────────────────────────────
function BookingCard({ item, onPress }: { item: any; onPress: () => void }) {
  const sc = STATUS[item.status] || STATUS.pending;
  const img = item.service?.images?.[0];
  const time = item.slot?.start_time ?? '--:--';

  return (
    <TouchableOpacity style={bc.row} onPress={onPress} activeOpacity={0.75} testID={`booking-${item.booking_id}`}>
      {/* Colonne heure */}
      <View style={bc.timeCol}>
        <Text style={bc.timeText}>{time}</Text>
        <View style={bc.line} />
      </View>

      {/* Carte */}
      <View style={[bc.card, { borderLeftColor: sc.color }]}>
        <View style={bc.cardRow}>
          {/* Image */}
          <View style={bc.imgWrap}>
            {img
              ? <Image source={{ uri: img }} style={bc.img} resizeMode="cover" />
              : <View style={[bc.img, bc.imgFallback]}>
                  <Ionicons name="barbell-outline" size={18} color={sc.color} />
                </View>
            }
          </View>

          {/* Infos */}
          <View style={bc.info}>
            <Text style={bc.title} numberOfLines={1}>{item.service?.title || 'Service'}</Text>
            <View style={bc.metaRow}>
              <Ionicons name="person-outline" size={11} color={Colors.muted} />
              <Text style={bc.meta}>{item.coach?.name || 'Coach'}</Text>
              {item.slot?.duration_minutes && (
                <>
                  <Text style={bc.sep}>·</Text>
                  <Text style={bc.meta}>{item.slot.duration_minutes}min</Text>
                </>
              )}
            </View>
          </View>

          {/* Badge statut */}
          <View style={[bc.badge, { backgroundColor: sc.color + '22' }]}>
            <Ionicons name={sc.icon} size={13} color={sc.color} />
            <Text style={[bc.badgeTxt, { color: sc.color }]}>{sc.label}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Ecran principal ───────────────────────────────────────────────────────────
export default function PlanningScreen() {
  const router = useRouter();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getWeekStart = (d: Date) => {
    const ws = new Date(d);
    ws.setDate(d.getDate() - d.getDay());
    ws.setHours(0, 0, 0, 0);
    return ws;
  };

  const [selected, setSelected] = useState(new Date(today));
  const [weekStart, setWeekStart] = useState(getWeekStart(today));
  const [tab, setTab] = useState<'upcoming' | 'history'>('upcoming');
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

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

  // Dates avec réservations → points sur le calendrier
  const dotDates = React.useMemo(() => {
    const s = new Set<string>();
    bookings.forEach(b => { const d = bookingDate(b); if (d) s.add(d); });
    return s;
  }, [bookings]);

  // Filtres
  const todayStr = isoDate(today);
  const selStr = isoDate(selected);

  const upcoming = bookings.filter(b => {
    const d = bookingDate(b);
    return d ? d >= todayStr : false;
  }).sort((a, b) => (bookingDate(a) ?? '') < (bookingDate(b) ?? '') ? -1 : 1);

  const history = bookings.filter(b => {
    const d = bookingDate(b);
    return d ? d < todayStr : false;
  }).sort((a, b) => (bookingDate(a) ?? '') < (bookingDate(b) ?? '') ? 1 : -1);

  const dayBookings = (tab === 'upcoming' ? upcoming : history).filter(b => bookingDate(b) === selStr);
  const allTabBookings = tab === 'upcoming' ? upcoming : history;

  // Navigation semaine
  const goWeek = (dir: number) => {
    const ws = new Date(weekStart);
    ws.setDate(ws.getDate() + dir * 7);
    setWeekStart(ws);
  };

  const handleSelectDay = (d: Date) => {
    setSelected(d);
    const ws = getWeekStart(d);
    setWeekStart(ws);
  };

  // Données affichées = si résa ce jour → filtrer par jour, sinon tout l'onglet
  const displayData = dayBookings.length > 0 ? dayBookings : allTabBookings;
  const showingDay = dayBookings.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <SafeAreaView edges={['top']} style={{ backgroundColor: Colors.header }}>
        <View style={s.header}>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()} testID="back-btn">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Mon Planning</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      {/* Calendrier semaine */}
      <WeekStrip
        weekStart={weekStart}
        selected={selected}
        dotDates={dotDates}
        onSelect={handleSelectDay}
        onPrev={() => goWeek(-1)}
        onNext={() => goWeek(1)}
      />

      {/* Segmented control */}
      <View style={s.segWrap}>
        <TouchableOpacity
          style={[s.seg, tab === 'upcoming' && s.segActive]}
          onPress={() => setTab('upcoming')}
          testID="tab-upcoming"
        >
          <Text style={[s.segTxt, tab === 'upcoming' && s.segTxtActive]}>
            À venir ({upcoming.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.seg, tab === 'history' && s.segActive]}
          onPress={() => setTab('history')}
          testID="tab-history"
        >
          <Text style={[s.segTxt, tab === 'history' && s.segTxtActive]}>
            Historique ({history.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      ) : displayData.length === 0 ? (
        <View style={s.center} testID="empty-planning">
          <Ionicons name="calendar-outline" size={52} color={Colors.muted} />
          <Text style={s.emptyTitle}>
            {tab === 'upcoming' ? 'Aucune séance à venir' : 'Aucun historique'}
          </Text>
          <Text style={s.emptySub}>
            {tab === 'upcoming'
              ? 'Réservez une séance pour la voir apparaître ici.'
              : 'Vos séances passées apparaîtront ici.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayData}
          keyExtractor={b => b.booking_id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={Colors.primary} />
          }
          ListHeaderComponent={
            <Text style={s.listHeader}>
              {showingDay
                ? `${DAYS_SHORT[selected.getDay()]} ${selected.getDate()} ${MONTHS[selected.getMonth()]}`
                : tab === 'upcoming' ? 'Prochaines séances' : 'Séances passées'}
            </Text>
          }
          renderItem={({ item }) => (
            <BookingCard
              item={item}
              onPress={() => router.push('/planning' as any)}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const wk = StyleSheet.create({
  wrap: { backgroundColor: Colors.header, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingBottom: 8 },
  monthLabel: { fontSize: 15, fontWeight: '700', color: Colors.foreground, textTransform: 'capitalize' },
  arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  daysRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 8 },
  day: { alignItems: 'center', justifyContent: 'center', width: 44, paddingVertical: 6, borderRadius: 22, gap: 2 },
  dayActive: { backgroundColor: Colors.primary },
  dayName: { fontSize: 10, fontWeight: '600', color: Colors.muted, textTransform: 'uppercase' },
  dayNameActive: { color: Colors.background },
  dayNum: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  dayNumActive: { color: Colors.background },
  dayNumToday: { color: Colors.primary },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  dotActive: { backgroundColor: Colors.background },
});

const bc = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  timeCol: { width: 52, alignItems: 'center', paddingTop: 14, gap: 4 },
  timeText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  line: { width: 1, flex: 1, backgroundColor: Colors.border, minHeight: 40 },
  card: { flex: 1, backgroundColor: Colors.card, borderRadius: 16, padding: 14, borderLeftWidth: 4, marginLeft: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  imgWrap: { borderRadius: 10, overflow: 'hidden' },
  img: { width: 44, height: 44, borderRadius: 10 },
  imgFallback: { backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 3 },
  title: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 12, color: Colors.muted },
  sep: { color: Colors.muted, fontSize: 10 },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, alignItems: 'center', gap: 2 },
  badgeTxt: { fontSize: 10, fontWeight: '700' },
});

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: Colors.foreground },
  segWrap: { flexDirection: 'row', margin: 16, backgroundColor: Colors.card, borderRadius: Radius.full, padding: 3 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: Radius.full, alignItems: 'center' },
  segActive: { backgroundColor: Colors.primary },
  segTxt: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  segTxtActive: { color: Colors.background, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  emptySub: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 20 },
  listHeader: { fontSize: 13, fontWeight: '600', color: Colors.muted, paddingTop: 4, paddingBottom: 10 },
});
