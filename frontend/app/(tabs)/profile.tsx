import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Image, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRefresh } from '../../context/RefreshContext';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';

export default function MenuScreen() {
  const router = useRouter();
  const { user, logout, loading, refreshUser } = useAuth();
  const { lang, setLang } = useLang();
  const [refreshing, setRefreshing] = useState(false);
  const [myTagPoints, setMyTagPoints] = useState<any[]>([]);
  const [showLangModal, setShowLangModal] = useState(false);
  const [isRefreshingUser, setIsRefreshingUser] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      setIsRefreshingUser(true);
      refreshUser().finally(() => setIsRefreshingUser(false));
    }
  }, [loading]);

  useEffect(() => { if (user) loadData(); }, [user]);

  const { profileKey } = useRefresh();
  useEffect(() => { if (user && profileKey > 0) loadData(); }, [profileKey]);

  const loadData = async () => {
    try {
      const points = await api.get('/tag-points/mine');
      setMyTagPoints(points || []);
    } catch {}
    finally { setRefreshing(false); }
  };

  const onRefresh = useCallback(() => { setRefreshing(true); loadData(); }, []);
  const handleLogout = async () => { await logout(); router.replace('/(auth)/login'); };

  if (loading || isRefreshingUser) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.center}>
          <Ionicons name="person-outline" size={48} color={Colors.muted} />
          <Text style={st.emptyText}>Veuillez vous connecter</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initial = user.name?.charAt(0)?.toUpperCase() || '?';
  const isCoach = user.role === 'coach';

  return (
    <SafeAreaView style={st.safe} edges={['top']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* ── HERO PROFILE CARD ─────────────────────────────── */}
        <TouchableOpacity style={st.hero} onPress={() => router.push(`/user/${user.user_id}` as any)} activeOpacity={0.9} testID="profile-hero">
          {/* Accent bar top */}
          <View style={st.heroAccentBar} />

          <View style={st.heroInner}>
            <View style={st.heroLeft}>
              <View style={st.avatarRing}>
                <View style={st.avatar}>
                  {user.picture
                    ? <Image source={{ uri: user.picture }} style={st.avatarImg} />
                    : <Text style={st.avatarInitial}>{initial}</Text>}
                </View>
              </View>
            </View>

            <View style={st.heroInfo}>
              <Text style={st.heroName}>{user.name}</Text>
              <View style={st.heroBadgeRow}>
                <View style={[st.heroBadge, isCoach && st.heroBadgeCoach]}>
                  <Ionicons name={isCoach ? 'trophy-outline' : 'person-outline'} size={11}
                    color={isCoach ? Colors.primary : Colors.muted} />
                  <Text style={[st.heroBadgeText, isCoach && { color: Colors.primary }]}>
                    {isCoach ? 'Coach' : 'Membre'}
                  </Text>
                </View>
              </View>
              <View style={st.heroStats}>
                <View style={st.heroStat}>
                  <Text style={st.heroStatVal}>{myTagPoints.length}</Text>
                  <Text style={st.heroStatLbl}>TagPoints</Text>
                </View>
                <View style={st.heroStatDiv} />
                <View style={st.heroStat}>
                  <Text style={st.heroStatVal}>0</Text>
                  <Text style={st.heroStatLbl}>Avis</Text>
                </View>
              </View>
            </View>

            <Ionicons name="chevron-forward" size={18} color={Colors.primary + '99'} style={{ alignSelf: 'center' }} />
          </View>
        </TouchableOpacity>

        {/* ── QUICK ACTIONS ─────────────────────────────────── */}
        <View style={st.actionsRow}>
          <TouchableOpacity style={st.actionCard} onPress={() => router.push('/saved' as any)} activeOpacity={0.8} testID="saved-nav-btn">
            <View style={st.actionIconBox}>
              <Ionicons name="bookmark" size={22} color={Colors.primary} />
            </View>
            <Text style={st.actionLabel}>Enregistrés</Text>
            <Text style={st.actionSub}>Vos favoris</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionCard} onPress={() => router.push('/events' as any)} activeOpacity={0.8} testID="events-nav-btn">
            <View style={st.actionIconBox}>
              <Ionicons name="calendar" size={22} color={Colors.primary} />
            </View>
            <Text style={st.actionLabel}>Évènements</Text>
            <Text style={st.actionSub}>Agenda</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionCard} onPress={() => router.push('/my-tag-points' as any)} activeOpacity={0.8} testID="my-tp-nav-btn">
            <View style={st.actionIconBox}>
              <Ionicons name="location" size={22} color={Colors.primary} />
            </View>
            <Text style={st.actionLabel}>Mes Points</Text>
            <Text style={st.actionSub}>{myTagPoints.length} créés</Text>
          </TouchableOpacity>
        </View>

        {/* ── MY TAGPOINTS (horizontal scroll) ──────────────── */}
        {myTagPoints.length > 0 && (
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Mes TagPoints</Text>
              {myTagPoints.length > 3 && (
                <TouchableOpacity onPress={() => router.push('/my-tag-points' as any)} testID="see-more-tagpoints-btn">
                  <Text style={st.sectionLink}>Voir tout</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tpScroll}>
              {myTagPoints.slice(0, 6).map((pt) => {
                const thumb = (pt.images as string[] | null)?.[0] || pt.image_url;
                return (
                  <TouchableOpacity key={pt.point_id} style={st.tpCard}
                    onPress={() => router.push(`/tag-point/${pt.point_id}`)} activeOpacity={0.85}
                    testID={`tp-card-${pt.point_id}`}>
                    {thumb
                      ? <Image source={{ uri: thumb }} style={st.tpCardBg} />
                      : <View style={[st.tpCardBg, st.tpCardBgEmpty]}>
                          <Ionicons name="image-outline" size={28} color={Colors.muted} />
                        </View>
                    }
                    <View style={st.tpCardOverlay}>
                      <Text style={st.tpCardTitle} numberOfLines={2}>{pt.title}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {myTagPoints.length === 0 && (
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Mes TagPoints</Text>
            </View>
            <TouchableOpacity style={st.emptyTp} onPress={() => router.push('/(tabs)/create' as any)} activeOpacity={0.8}>
              <Ionicons name="add-circle-outline" size={32} color={Colors.primary} />
              <Text style={st.emptyTpText}>Créer mon premier TagPoint</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── SETTINGS ──────────────────────────────────────── */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Paramètres</Text>
          <View style={st.settingsCard}>
            {user.role === 'admin' && (
              <TouchableOpacity style={st.settingRow} onPress={() => router.push('/(main)/admin')} activeOpacity={0.7}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIconBox, { backgroundColor: '#FF453A22' }]}>
                    <Ionicons name="shield-outline" size={18} color="#FF453A" />
                  </View>
                  <Text style={st.settingLabel}>Administration</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={st.settingRow} onPress={() => {}} activeOpacity={0.7} testID="addresses-btn">
              <View style={st.settingLeft}>
                <View style={st.settingIconBox}>
                  <Ionicons name="location-outline" size={18} color={Colors.primary} />
                </View>
                <Text style={st.settingLabel}>Gérer mes adresses</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity style={[st.settingRow, st.settingRowLast]} onPress={() => setShowLangModal(true)} activeOpacity={0.7} testID="lang-btn">
              <View style={st.settingLeft}>
                <View style={st.settingIconBox}>
                  <Ionicons name="language-outline" size={18} color={Colors.primary} />
                </View>
                <Text style={st.settingLabel}>Langue</Text>
              </View>
              <View style={st.settingRight}>
                <Text style={st.settingRightText}>{lang === 'fr' ? 'Français' : 'English'}</Text>
                <Ionicons name="chevron-expand" size={14} color={Colors.primary} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── LOGOUT ────────────────────────────────────────── */}
        <TouchableOpacity style={st.logoutBtn} onPress={handleLogout} activeOpacity={0.8} testID="logout-btn">
          <Ionicons name="log-out-outline" size={18} color="#FF453A" />
          <Text style={st.logoutText}>Déconnexion</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Language Modal */}
      <Modal visible={showLangModal} transparent animationType="fade">
        <TouchableOpacity style={st.modalOverlay} onPress={() => setShowLangModal(false)} activeOpacity={1}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>Langue</Text>
            {(['fr', 'en'] as const).map(l => (
              <TouchableOpacity key={l} style={[st.langOption, lang === l && st.langOptionActive]}
                onPress={() => { setLang(l); setShowLangModal(false); }}>
                <Text style={st.langOptionText}>{l === 'fr' ? 'Français' : 'English'}</Text>
                {lang === l && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const TEAL_DIM = 'rgba(0,191,165,0.12)';
const TEAL_BORDER = 'rgba(0,191,165,0.3)';

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: Colors.muted },

  // HERO
  hero: {
    marginHorizontal: Spacing.md, marginTop: Spacing.md, marginBottom: Spacing.lg,
    backgroundColor: '#0D1F1F',
    borderRadius: 20, overflow: 'hidden',
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  heroAccentBar: { height: 3, backgroundColor: Colors.primary },
  heroInner: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 16 },
  heroLeft: {},
  avatarRing: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 2, borderColor: Colors.primary,
    padding: 3,
  },
  avatar: { flex: 1, borderRadius: 32, backgroundColor: Colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 28, fontWeight: '800', color: Colors.primary },
  heroInfo: { flex: 1 },
  heroName: { fontSize: 20, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  heroBadgeRow: { flexDirection: 'row', marginTop: 4, marginBottom: 12 },
  heroBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.card, borderRadius: Radius.full,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  heroBadgeCoach: { backgroundColor: TEAL_DIM, borderWidth: 1, borderColor: TEAL_BORDER },
  heroBadgeText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroStat: { alignItems: 'center' },
  heroStatVal: { fontSize: 18, fontWeight: '800', color: Colors.primary },
  heroStatLbl: { fontSize: 10, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  heroStatDiv: { width: 1, height: 28, backgroundColor: Colors.border },

  // ACTIONS
  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.md, marginBottom: Spacing.xl },
  actionCard: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: 16, padding: 14,
    alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  actionIconBox: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: TEAL_DIM,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  actionLabel: { fontSize: 12, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  actionSub: { fontSize: 10, color: Colors.muted, textAlign: 'center' },

  // SECTIONS
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.xl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1.2 },
  sectionLink: { fontSize: 13, color: Colors.muted, fontWeight: '600' },

  // TAGPOINT CARDS (horizontal scroll)
  tpScroll: { gap: 12, paddingRight: 4 },
  tpCard: { width: 160, height: 110, borderRadius: 16, overflow: 'hidden', backgroundColor: Colors.card },
  tpCardBg: { ...StyleSheet.absoluteFillObject },
  tpCardBgEmpty: { alignItems: 'center', justifyContent: 'center' },
  tpCardOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
    padding: 10,
  },
  tpCardTitle: { fontSize: 12, fontWeight: '700', color: '#fff', lineHeight: 16 },
  emptyTp: {
    alignItems: 'center', gap: 10, paddingVertical: 28,
    backgroundColor: TEAL_DIM, borderRadius: 16,
    borderWidth: 1, borderColor: TEAL_BORDER, borderStyle: 'dashed',
  },
  emptyTpText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  // SETTINGS
  settingsCard: { backgroundColor: Colors.card, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border },
  settingRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 15,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  settingRowLast: { borderBottomWidth: 0 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  settingIconBox: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: TEAL_DIM,
    alignItems: 'center', justifyContent: 'center',
  },
  settingLabel: { fontSize: 15, color: Colors.foreground, fontWeight: '500' },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  settingRightText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  // LOGOUT
  logoutBtn: {
    marginHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,69,58,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,69,58,0.25)',
  },
  logoutText: { fontSize: 15, fontWeight: '700', color: '#FF453A' },

  // MODAL
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: Colors.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 320 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: 16, textAlign: 'center' },
  langOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 8 },
  langOptionActive: { backgroundColor: TEAL_DIM },
  langOptionText: { fontSize: 16, color: Colors.foreground },
});

