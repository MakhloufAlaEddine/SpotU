import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

type AdminTab = 'stats' | 'users' | 'spotyou' | 'domains';

export default function AdminScreen() {
  const { user } = useAuth();
  const { t } = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>('stats');
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [SpotYou, setSpotYou] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (user?.role !== 'admin') { router.back(); return; }
    loadData();
  }, [user, tab]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (tab === 'stats') {
        const s = await api.get('/admin/stats');
        setStats(s);
      } else if (tab === 'users') {
        const u = await api.get('/admin/users');
        setUsers(u);
      } else if (tab === 'spotyou') {
        const p = await api.get('/admin/tag-points');
        setSpotYou(p);
      } else if (tab === 'domains') {
        const d = await api.get('/admin/domains');
        setDomains(d);
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const verifyCoach = async (userId: string) => {
    try {
      await api.put(`/admin/users/${userId}/verify-coach`, {});
      loadData();
    } catch {}
  };

  if (user?.role !== 'admin') return null;

  const TABS: { key: AdminTab; label: string; emoji: string }[] = [
    { key: 'stats', label: 'Stats', emoji: '📊' },
    { key: 'users', label: 'Users', emoji: '👥' },
    { key: 'spotyou', label: 'SpotYou', emoji: '📍' },
    { key: 'domains', label: 'Domaines', emoji: '🌍' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            testID={`admin-tab-${t.key}`}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={styles.tabEmoji}>{t.emoji}</Text>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} tintColor={Colors.primary} />}
      >
        {loading ? <ActivityIndicator color={Colors.primary} style={{ marginTop: Spacing.xl }} /> : (
          <>
            {/* STATS */}
            {tab === 'stats' && stats && (
              <View style={styles.statsGrid} testID="admin-stats-grid">
                {[
                  { label: t('totalUsers'), value: stats.total_users, emoji: '👤', color: Colors.accent },
                  { label: t('totalCoaches'), value: stats.total_coaches, emoji: '🎯', color: Colors.coaching },
                  { label: t('totalSpotYou'), value: stats.total_spotyou, emoji: '📍', color: Colors.sport },
                  { label: t('totalBookings'), value: stats.total_bookings, emoji: '📅', color: Colors.warning },
                  { label: t('gmv'), value: `${stats.gmv}€`, emoji: '💰', color: Colors.success },
                  { label: t('platformFee'), value: `${stats.platform_commission}€`, emoji: '🏦', color: Colors.primary },
                ].map((s) => (
                  <View key={s.label} style={[styles.statCard, { borderLeftColor: s.color }]}>
                    <Text style={styles.statEmoji}>{s.emoji}</Text>
                    <Text style={[styles.statValue, { color: s.color }]}>{s.value}</Text>
                    <Text style={styles.statLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* USERS */}
            {tab === 'users' && users.map((u) => (
              <View key={u.user_id} style={styles.rowCard} testID={`user-row-${u.user_id}`}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle}>{u.name}</Text>
                  <Text style={styles.rowSub}>{u.email} · {u.role}</Text>
                </View>
                {u.role !== 'admin' && !u.is_coach_verified && (
                  <TouchableOpacity style={styles.verifyBtn} onPress={() => verifyCoach(u.user_id)} testID={`verify-coach-${u.user_id}`}>
                    <Text style={styles.verifyText}>✓ Vérifier</Text>
                  </TouchableOpacity>
                )}
                {u.is_coach_verified && <Text style={styles.verifiedTag}>✓ Vérifié</Text>}
              </View>
            ))}

            {/* TAGPOINTS */}
            {tab === 'spotyou' && SpotYou.map((pt) => (
              <View key={pt.point_id} style={styles.rowCard} testID={`admin-pt-${pt.point_id}`}>
                <View style={styles.rowInfo}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{pt.title}</Text>
                  <Text style={styles.rowSub}>{pt.domain_id} · {pt.active ? '🟢 actif' : '🔴 inactif'}</Text>
                </View>
              </View>
            ))}

            {/* DOMAINS */}
            {tab === 'domains' && domains.map((d) => (
              <View key={d.domain_id} style={[styles.domainCard, { borderLeftColor: d.color }]} testID={`domain-${d.domain_id}`}>
                <Text style={styles.domainName}>{d.label_fr}</Text>
                <Text style={styles.domainEn}>{d.label_en}</Text>
                <View style={[styles.domainStatus, { backgroundColor: d.active ? Colors.primaryLight : Colors.secondary }]}>
                  <Text style={[styles.domainStatusText, { color: d.active ? Colors.primary : Colors.muted }]}>
                    {d.active ? '🟢 Actif' : '🔴 Inactif'}
                  </Text>
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  tabScroll: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabEmoji: { fontSize: 16 },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  tabTextActive: { color: Colors.primary },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  statCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, borderLeftWidth: 4, flex: 1, minWidth: 140, ...Shadow.soft },
  statEmoji: { fontSize: 24, marginBottom: 4 },
  statValue: { fontSize: 28, fontWeight: '900', marginBottom: 2 },
  statLabel: { fontSize: 12, color: Colors.muted },
  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.card, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.sm, ...Shadow.soft },
  rowInfo: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  rowSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  verifyBtn: { backgroundColor: Colors.primaryLight, borderRadius: Radius.full, paddingHorizontal: 12, paddingVertical: 5 },
  verifyText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  verifiedTag: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  domainCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.sm, borderLeftWidth: 4, ...Shadow.soft, flexDirection: 'row', alignItems: 'center', gap: 10 },
  domainName: { fontSize: 15, fontWeight: '700', color: Colors.foreground, flex: 1 },
  domainEn: { fontSize: 13, color: Colors.muted },
  domainStatus: { borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  domainStatusText: { fontSize: 11, fontWeight: '700' },
});
