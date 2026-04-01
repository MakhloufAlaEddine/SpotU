import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Image, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useRefresh } from '../../context/RefreshContext';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { StaleBanner, ErrorNoData } from '../../components/OfflineBanner';
import { buildCacheKey, cacheGet, cacheSet, isFresh, getTtl, SCHEMA_VERSION } from '../../lib/cache';
import { ScreenLoader } from '../../components/ScreenLoader';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';
import { useCart } from '../../context/CartContext';

export default function MenuScreen() {
  const router = useGuardedRouter();
  const { user, logout, loading, refreshUser } = useAuth();
  const { lang, setLanguage } = useLang();
  const { totalItems: cartCount } = useCart();
  const [refreshing, setRefreshing] = useState(false);
  const [mySpotYou, setMySpotYou] = useState<any[]>([]);
  const [showLangModal, setShowLangModal] = useState(false);
  const [isRefreshingUser, setIsRefreshingUser] = useState(false);
  const [reviewStats, setReviewStats] = useState<{ avg_rating: number | null; review_count: number }>({ avg_rating: null, review_count: 0 });
  const [dataScreenState, setDataScreenState] = useState<'loading_initial' | 'ready_fresh' | 'ready_cached' | 'error_no_data'>('loading_initial');
  const [staleMinutes, setStaleMinutes] = useState<number | null>(null);
  const [networkFailed, setNetworkFailed] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      setIsRefreshingUser(true);
      const timeout = setTimeout(() => setIsRefreshingUser(false), 8000);
      refreshUser().finally(() => {
        clearTimeout(timeout);
        setIsRefreshingUser(false);
      });
    }
  }, [loading]);

  useEffect(() => { if (user) loadData(false); }, [user]);

  const { profileKey } = useRefresh();
  useEffect(() => { if (user && profileKey > 0) loadData(false); }, [profileKey]);

  // Reload when tab comes into focus (fix: stats not updating after profile edit)
  useFocusEffect(
    useCallback(() => {
      if (user) loadData(false);
    }, [user?.user_id])
  );

  const loadData = async (isRefresh = false) => {
    const userId = user?.user_id;
    const tpCacheKey = buildCacheKey({ path: '/tag-points/mine', userId, schemaVersion: SCHEMA_VERSION });
    const profileCacheKey = buildCacheKey({ path: '/users/profile', userId, schemaVersion: SCHEMA_VERSION });
    const tpTtl = getTtl('/tag-points/mine') ?? 5 * 60_000;
    const profileTtl = getTtl('/users/profile') ?? 5 * 60_000;

    // Étape 1 : lecture cache sur le premier chargement
    if (!isRefresh) {
      const [cachedTp, cachedProfile] = await Promise.all([
        cacheGet<any[]>(tpCacheKey),
        cacheGet<any>(profileCacheKey),
      ]);
      if (cachedTp || cachedProfile) {
        if (cachedTp) setMySpotYou(Array.isArray(cachedTp.data) ? cachedTp.data : []);
        if (cachedProfile?.data) {
          setReviewStats({
            avg_rating: cachedProfile.data.avg_rating ?? null,
            review_count: cachedProfile.data.review_count ?? 0,
          });
        }
        const tpFresh = !cachedTp || isFresh(cachedTp);
        const profileFresh = !cachedProfile || isFresh(cachedProfile);
        if (tpFresh && profileFresh) {
          setDataScreenState('ready_fresh');
          setStaleMinutes(null);
          return;
        }
        setDataScreenState('ready_cached');
        const minAge = Math.max(
          cachedTp ? (Date.now() - cachedTp.cachedAt) : 0,
          cachedProfile ? (Date.now() - cachedProfile.cachedAt) : 0,
        );
        setStaleMinutes(Math.floor(minAge / 60_000));
      }
    }

    if (isRefresh) setRefreshing(true);

    // Étape 2 : fetch réseau
    try {
      const [points, profileData] = await Promise.all([
        api.get('/tag-points/mine'),
        api.get('/users/profile'),
      ]);
      setMySpotYou(points || []);
      if (profileData) {
        setReviewStats({
          avg_rating: profileData.avg_rating ?? null,
          review_count: profileData.review_count ?? 0,
        });
      }
      setDataScreenState('ready_fresh');
      setStaleMinutes(null);
      setNetworkFailed(false);
      await Promise.all([
        cacheSet(tpCacheKey, points || [], tpTtl),
        cacheSet(profileCacheKey, profileData || {}, profileTtl),
      ]);
    } catch {
      setNetworkFailed(true);
      setMySpotYou(prev => {
        if (prev.length > 0) {
          setDataScreenState('ready_cached');
        } else {
          setDataScreenState('error_no_data');
        }
        return prev;
      });
    } finally {
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => { loadData(true); }, []);
  const handleLogout = async () => { await logout(); router.replace('/(auth)/login'); };

  if (loading || isRefreshingUser) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.center}><ScreenLoader /></View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={st.safe}>
        <ErrorNoData
          onRetry={() => refreshUser()}
          message="Session introuvable. Vérifiez votre connexion et réessayez."
          testID="profile-no-user"
        />
      </SafeAreaView>
    );
  }

  const initial = user.name?.charAt(0)?.toUpperCase() || '?';
  const isCoach = user.role === 'coach';

  // Badge computation (only positive, minimum 3 reviews)
  const avgR = reviewStats.avg_rating;
  const revCount = reviewStats.review_count;
  let badge: { label: string; color: string; bg: string; icon: string } | null = null;
  if (avgR && revCount >= 3 && avgR >= 3.5) {
    if (avgR >= 4.8 && revCount >= 10)     badge = { label: 'Elite',         color: '#FFD700', bg: 'rgba(255,215,0,0.15)',   icon: 'diamond' };
    else if (avgR >= 4.5 && revCount >= 5) badge = { label: 'Top Joueur',    color: '#FFD700', bg: 'rgba(255,215,0,0.12)',   icon: 'trophy' };
    else if (avgR >= 4.0 && revCount >= 3) badge = { label: 'Très Apprécié', color: '#C0C0C0', bg: 'rgba(192,192,192,0.15)', icon: 'star' };
    else                                   badge = { label: 'Bien Noté',     color: '#CD7F32', bg: 'rgba(205,127,50,0.15)',  icon: 'thumbs-up' };
  }

  // Progress toward next badge (to show as motivation)
  let progressMsg: string | null = null;
  let progressTarget = 0;
  let progressCurrent = revCount;
  if (revCount < 3) {
    progressMsg = `Obtenez ${3 - revCount} avis de plus pour débloquer votre 1er badge`;
    progressTarget = 3;
  } else if (!badge || badge.label === 'Bien Noté') {
    const need = 5 - revCount;
    if (need > 0) { progressMsg = `${need} avis de plus pour atteindre "Top Joueur"`; progressTarget = 5; }
  } else if (badge.label === 'Top Joueur') {
    const need = 10 - revCount;
    if (need > 0) { progressMsg = `${need} avis de plus pour atteindre "Elite"`; progressTarget = 10; }
  }

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
                {/* Achievement badge — only positive */}
                {badge && (
                  <View style={[st.heroBadge, { backgroundColor: badge.bg, borderWidth: 1, borderColor: badge.color + '44' }]}
                    testID="hero-achievement-badge">
                    <Ionicons name={badge.icon as any} size={11} color={badge.color} />
                    <Text style={[st.heroBadgeText, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                )}
              </View>
              <View style={st.heroStats}>
                <View style={st.heroStat}>
                  <Text style={st.heroStatVal}>{mySpotYou.length}</Text>
                  <Text style={st.heroStatLbl}>SpotYou</Text>
                </View>
                <View style={st.heroStatDiv} />
                <View style={st.heroStat} testID="hero-review-count">
                  <Text style={st.heroStatVal}>{revCount}</Text>
                  <Text style={st.heroStatLbl}>Avis</Text>
                </View>
                {avgR != null && (
                  <>
                    <View style={st.heroStatDiv} />
                    <View style={st.heroStat} testID="hero-avg-rating">
                      <Text style={[st.heroStatVal, { color: '#FFD700' }]}>{avgR}</Text>
                      <Text style={st.heroStatLbl}>Moy.</Text>
                    </View>
                  </>
                )}
              </View>
            </View>

            <Ionicons name="chevron-forward" size={18} color={Colors.primary + '99'} style={{ alignSelf: 'center' }} />
          </View>

          {/* ── Progress toward next badge ── */}
          {progressMsg && (
            <View style={st.progressBanner} testID="badge-progress-banner">
              <Ionicons name="ribbon-outline" size={14} color={Colors.primary} />
              <View style={{ flex: 1, gap: 5 }}>
                <Text style={st.progressText}>{progressMsg}</Text>
                <View style={st.progressTrack}>
                  <View style={[st.progressFill, {
                    width: `${Math.min(100, (progressCurrent / progressTarget) * 100)}%` as any
                  }]} />
                </View>
              </View>
              <Text style={st.progressCount}>{progressCurrent}/{progressTarget}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── QUICK ACTIONS ─────────────────────────────────── */}
        <View style={st.actionsGrid}>
          <TouchableOpacity style={st.actionCard} onPress={() => router.push('/saved' as any)} activeOpacity={0.8} testID="saved-nav-btn">
            <View style={st.actionIconBox}>
              <Ionicons name="bookmark" size={22} color={Colors.primary} />
            </View>
            <Text style={st.actionLabel}>Enregistrés</Text>
            <Text style={st.actionSub}>Vos favoris</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionCard} onPress={() => router.push('/spot-me' as any)} activeOpacity={0.8} testID="my-tp-nav-btn">
            <View style={st.actionIconBox}>
              <Ionicons name="location" size={22} color={Colors.primary} />
            </View>
            <Text style={st.actionLabel}>Mes SpotMe</Text>
            <Text style={st.actionSub}>{mySpotYou.length} créés</Text>
          </TouchableOpacity>

          <TouchableOpacity style={st.actionCard} onPress={() => router.push('/planning' as any)} activeOpacity={0.8} testID="planning-nav-btn">
            <View style={st.actionIconBox}>
              <Ionicons name="calendar-number" size={22} color={Colors.primary} />
            </View>
            <Text style={st.actionLabel}>Planning</Text>
            <Text style={st.actionSub}>Mes séances</Text>
          </TouchableOpacity>
        </View>

        {/* ── COACH SECTION ─────────────────────────────────── */}
        {isCoach && (
          <View style={st.section}>
            <Text style={st.sectionTitle}>Espace Coach</Text>
            <TouchableOpacity
              style={st.coachCreateBtn}
              onPress={() => router.push('/create-service' as any)}
              activeOpacity={0.85}
              testID="coach-create-service-btn"
            >
              <View style={st.coachCreateIconBox}>
                <Ionicons name="add-circle" size={26} color="#FF9500" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.coachCreateTitle}>Créer un service</Text>
                <Text style={st.coachCreateSub}>Publiez vos prestations de coaching</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#FF9500" />
            </TouchableOpacity>

          </View>
        )}

        {/* ── Stale data indicator — uniquement si le refresh réseau a échoué ── */}
        {dataScreenState === 'ready_cached' && networkFailed && <StaleBanner staleMinutes={staleMinutes} />}

        {/* ── MY TAGPOINTS (horizontal scroll) ──────────────── */}
        {mySpotYou.length > 0 && (
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Mes SpotMe</Text>
              {mySpotYou.length > 3 && (
                <TouchableOpacity onPress={() => router.push('/spot-me' as any)} testID="see-more-spotyou-btn">
                  <Text style={st.sectionLink}>Voir tout</Text>
                </TouchableOpacity>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.tpScroll}>
              {mySpotYou.slice(0, 6).map((pt) => {
                const thumb = (pt.images as string[] | null)?.[0];
                return (
                  <TouchableOpacity key={pt.point_id} style={st.tpCard}
                    onPress={() => router.push(`/spot-you/${pt.point_id}`)} activeOpacity={0.85}
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

        {mySpotYou.length === 0 && dataScreenState !== 'loading_initial' && (
          <View style={st.section}>
            <View style={st.sectionHeader}>
              <Text style={st.sectionTitle}>Mes SpotMe</Text>
            </View>
            {dataScreenState === 'error_no_data' ? (
              <TouchableOpacity style={st.emptyTp} onPress={() => loadData(true)} activeOpacity={0.8} testID="profile-retry-data-btn">
                <Ionicons name="wifi-outline" size={32} color={Colors.muted} />
                <Text style={[st.emptyTpText, { color: Colors.muted }]}>Données indisponibles</Text>
                <Text style={{ fontSize: 12, color: Colors.muted, textAlign: 'center' }}>Touchez pour réessayer</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={st.emptyTp} onPress={() => router.push('/(tabs)/create' as any)} activeOpacity={0.8}>
                <Ionicons name="add-circle-outline" size={32} color={Colors.primary} />
                <Text style={st.emptyTpText}>Créer mon premier SpotMe</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── MES PRODUITS ────────────────────────────────────── */}
        <View style={st.section}>
          <View style={st.sectionHeader}>
            <Text style={st.sectionTitle}>Mes produits</Text>
            <TouchableOpacity onPress={() => router.push('/products/my-products' as any)} testID="see-my-products-btn">
              <Text style={st.sectionLink}>Voir tout</Text>
            </TouchableOpacity>
          </View>
          <View style={st.settingsCard}>
            <TouchableOpacity
              style={st.settingRow}
              onPress={() => router.push('/products/my-products' as any)}
              activeOpacity={0.7}
              testID="my-products-menu-btn"
            >
              <View style={st.settingLeft}>
                <View style={[st.settingIconBox, { backgroundColor: 'rgba(59,130,246,0.14)' }]}>
                  <Ionicons name="cube-outline" size={18} color="#3B82F6" />
                </View>
                <Text style={st.settingLabel}>Mes annonces de location</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.settingRow, { borderTopWidth: 1, borderTopColor: Colors.border }]}
              onPress={() => router.push('/products/create' as any)}
              activeOpacity={0.7}
              testID="create-product-menu-btn"
            >
              <View style={st.settingLeft}>
                <View style={[st.settingIconBox, { backgroundColor: 'rgba(59,130,246,0.14)' }]}>
                  <Ionicons name="add-circle-outline" size={18} color="#3B82F6" />
                </View>
                <Text style={st.settingLabel}>Ajouter un produit</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── RÉSERVATIONS & ABONNEMENTS ────────────────────── */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Réservations & Services</Text>
          <View style={st.settingsCard}>

            {/* Mon panier */}
            <TouchableOpacity
              style={st.settingRow}
              onPress={() => router.push('/cart' as any)}
              activeOpacity={0.7}
              testID="cart-menu-btn"
            >
              <View style={st.settingLeft}>
                <View style={[st.settingIconBox, { backgroundColor: 'rgba(59,130,246,0.14)' }]}>
                  <Ionicons name="cart-outline" size={18} color="#3B82F6" />
                </View>
                <Text style={st.settingLabel}>Mon panier</Text>
              </View>
              {cartCount > 0 && (
                <View style={{ backgroundColor: '#3B82F6', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>{cartCount}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={st.settingRow}
              onPress={() => router.push('/bookings' as any)}
              activeOpacity={0.7}
              testID="my-bookings-btn"
            >
              <View style={st.settingLeft}>
                <View style={[st.settingIconBox, { backgroundColor: '#007AFF22' }]}>
                  <Ionicons name="calendar-outline" size={18} color="#007AFF" />
                </View>
                <Text style={st.settingLabel}>Mes réservations</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>

            {isCoach && (
              <TouchableOpacity
                style={st.settingRow}
                onPress={() => router.push('/bookings/received' as any)}
                activeOpacity={0.7}
                testID="received-bookings-btn"
              >
                <View style={st.settingLeft}>
                  <View style={[st.settingIconBox, { backgroundColor: '#FF950022' }]}>
                    <Ionicons name="mail-open-outline" size={18} color="#FF9500" />
                  </View>
                  <Text style={st.settingLabel}>Demandes reçues</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[st.settingRow, st.settingRowLast]}
              onPress={() => router.push('/subscriptions' as any)}
              activeOpacity={0.7}
              testID="subscriptions-btn"
            >
              <View style={st.settingLeft}>
                <View style={[st.settingIconBox, { backgroundColor: '#BF5AF222' }]}>
                  <Ionicons name="ribbon-outline" size={18} color="#BF5AF2" />
                </View>
                <Text style={st.settingLabel}>Abonnements</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── SETTINGS ──────────────────────────────────────── */}
        <View style={st.section}>
          <Text style={st.sectionTitle}>Paramètres</Text>
          <View style={st.settingsCard}>
            {user.role === 'admin' && (
              <TouchableOpacity style={st.settingRow} onPress={() => router.push('/admin' as any)} activeOpacity={0.7}>
                <View style={st.settingLeft}>
                  <View style={[st.settingIconBox, { backgroundColor: '#FF453A22' }]}>
                    <Ionicons name="shield-outline" size={18} color="#FF453A" />
                  </View>
                  <Text style={st.settingLabel}>Administration</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={st.settingRow} onPress={() => router.push('/manage-addresses' as any)} activeOpacity={0.7} testID="addresses-btn">
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
                onPress={() => { setLanguage(l); setShowLangModal(false); }}>
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

  // Badge progress
  progressBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 20, marginBottom: 16, padding: 12,
    backgroundColor: 'rgba(0,191,165,0.08)', borderRadius: 12,
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  progressText: { fontSize: 12, color: Colors.primary, fontWeight: '600', flex: 1 },
  progressTrack: { height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
  progressCount: { fontSize: 11, color: Colors.muted, fontWeight: '700', minWidth: 28, textAlign: 'right' },

  // ACTIONS
  actionsRow: { flexDirection: 'row', gap: 10, paddingHorizontal: Spacing.md, marginBottom: Spacing.xl },
  actionsGrid: { flexDirection: 'row', gap: 8, paddingHorizontal: Spacing.md, marginBottom: Spacing.xl },
  actionCard: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: 16, padding: 12,
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

  // COACH CREATE SERVICE
  coachCreateBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: 'rgba(255,149,0,0.10)', borderRadius: 16, padding: 16,
    borderWidth: 1.5, borderColor: 'rgba(255,149,0,0.35)',
  },
  coachCreateIconBox: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: 'rgba(255,149,0,0.18)', alignItems: 'center', justifyContent: 'center',
  },
  coachCreateTitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground },
  coachCreateSub: { fontSize: 12, color: Colors.muted, marginTop: 2 },

  // MODAL
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { backgroundColor: Colors.card, borderRadius: 20, padding: 24, width: '100%', maxWidth: 320 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.foreground, marginBottom: 16, textAlign: 'center' },
  langOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 8 },
  langOptionActive: { backgroundColor: TEAL_DIM },
  langOptionText: { fontSize: 16, color: Colors.foreground },
});

