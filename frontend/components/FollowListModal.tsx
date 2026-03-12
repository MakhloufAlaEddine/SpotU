import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api } from '../lib/api';
import { Colors, Radius, Spacing } from '../constants/Colors';
import { UserAvatar } from './UserAvatar';

// ── Types ──────────────────────────────────────────────────────────────────────
type FollowUser = {
  user_id: string;
  name: string;
  picture: string | null;
  role: string;
  is_following_back?: boolean;
  follows_back?: boolean;
  is_blocked?: boolean;
};

type SuggestionUser = {
  user_id: string;
  name: string;
  picture: string | null;
  role: string;
  common_count: number;
  common_interests: { tag_id: string; label: string }[];
};

type Tab = 'followers' | 'following' | 'suggestions';
type RoleFilter = 'all' | 'coach' | 'user';

interface Props {
  visible: boolean;
  onClose: () => void;
  profileId: string;
  meId: string | null;
  initialTab?: Tab;
  followersCount: number;
  followingCount: number;
  isOwnProfile: boolean;
  onFollowersCountChange?: (delta: number) => void;
  onFollowingCountChange?: (delta: number) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function FollowListModal({
  visible, onClose, profileId, meId,
  initialTab = 'followers',
  followersCount, followingCount,
  isOwnProfile,
  onFollowersCountChange,
  onFollowingCountChange,
}: Props) {
  const router = useRouter();

  // ── Tab state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // ── Followers / Following state ───────────────────────────────────────────────
  const [users, setUsers]             = useState<FollowUser[]>([]);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState<RoleFilter>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── Suggestions state ─────────────────────────────────────────────────────────
  const [suggestions, setSuggestions]       = useState<SuggestionUser[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestSkip, setSuggestSkip]       = useState(0);
  const [hasMoreSuggestions, setHasMoreSuggestions] = useState(true);
  const [hasInterests, setHasInterests]     = useState<boolean | null>(null);
  const [isPopularFallback, setIsPopularFallback] = useState(false);
  const suggestFollowing = useRef<Set<string>>(new Set()); // tracks who user just followed

  const LIMIT = 10;

  // ── Reset on open / tab change ────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setActiveTab(initialTab);
      setSearch('');
      setRoleFilter('all');
    }
  }, [visible, initialTab]);

  // Load followers/following on tab switch
  useEffect(() => {
    if (!visible) return;
    if (activeTab === 'followers' || activeTab === 'following') loadUsers();
    if (activeTab === 'suggestions') { resetAndLoadSuggestions(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeTab]);

  // ── Load followers / following ────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const path = activeTab === 'followers'
        ? `/users/${profileId}/followers`
        : `/users/${profileId}/following`;
      const data = await api.get<FollowUser[]>(path);
      setUsers(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  }, [activeTab, profileId]);

  // ── Load suggestions (paginated) ──────────────────────────────────────────────
  const loadSuggestions = useCallback(async (skip: number, reset: boolean) => {
    if (!meId) return;
    if (reset) setSuggestLoading(true);
    try {
      const data = await api.get<{
        suggestions: SuggestionUser[];
        has_interests: boolean;
        count: number;
      }>(`/users/${profileId}/suggestions?skip=${skip}&limit=${LIMIT}`);
      setHasInterests(data.has_interests);
      setIsPopularFallback(data.has_interests && data.suggestions.length > 0 &&
        data.suggestions[0].common_count === 0);
      if (reset) {
        setSuggestions(data.suggestions);
      } else {
        setSuggestions(prev => [...prev, ...data.suggestions]);
      }
      setHasMoreSuggestions(data.count === LIMIT);
      setSuggestSkip(skip + data.count);
    } catch {}
    finally { setSuggestLoading(false); }
  }, [meId, profileId]);

  const resetAndLoadSuggestions = useCallback(() => {
    setSuggestions([]);
    setSuggestSkip(0);
    setHasMoreSuggestions(true);
    suggestFollowing.current = new Set();
    loadSuggestions(0, true);
  }, [loadSuggestions]);

  // ── Follow / Unfollow (followers + following tabs) ────────────────────────────
  const handleFollowToggle = async (u: FollowUser) => {
    if (!meId) return;
    setActionLoading(u.user_id);
    try {
      const isFollowingThem = activeTab === 'followers' ? (u.is_following_back ?? false) : true;
      if (isFollowingThem) {
        await api.delete(`/users/${u.user_id}/follow`);
        if (activeTab === 'following') {
          // Dans "abonnements": retirer de la liste + décrémenter le compteur parent
          setUsers(prev => prev.filter(x => x.user_id !== u.user_id));
          onFollowingCountChange?.(-1);
        } else {
          // Dans "abonnés": basculer vers "Suivre" (on ne suit plus en retour)
          setUsers(prev => prev.map(x =>
            x.user_id === u.user_id
              ? { ...x, is_following_back: false, follows_back: false }
              : x
          ));
        }
      } else {
        await api.post(`/users/${u.user_id}/follow`, {});
        if (activeTab === 'following') {
          onFollowingCountChange?.(+1);
        }
        setUsers(prev => prev.map(x =>
          x.user_id === u.user_id ? { ...x, is_following_back: true } : x
        ));
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Action impossible');
    } finally { setActionLoading(null); }
  };

  // ── Follow from suggestions ───────────────────────────────────────────────────
  const handleSuggestionFollow = async (u: SuggestionUser) => {
    if (!meId) return;
    setActionLoading(u.user_id);
    try {
      await api.post(`/users/${u.user_id}/follow`, {});
      suggestFollowing.current.add(u.user_id);
      // Retirer de la liste: déjà suivi → plus une suggestion
      setSuggestions(prev => prev.filter(x => x.user_id !== u.user_id));
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Action impossible');
    } finally { setActionLoading(null); }
  };

  // ── Remove follower / Block ───────────────────────────────────────────────────
  const handleRemoveFollower = async (u: FollowUser) => {
    Alert.alert(
      'Retirer cet abonné ?',
      `${u.name} ne pourra plus voir vos contenus s'ils sont privés.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Retirer', style: 'destructive', onPress: async () => {
          setActionLoading(u.user_id);
          try {
            await api.delete(`/users/${profileId}/followers/${u.user_id}`);
            setUsers(prev => prev.filter(x => x.user_id !== u.user_id));
            onFollowersCountChange?.(-1);
          } catch (e: any) { Alert.alert('Erreur', e.message); }
          finally { setActionLoading(null); }
        }},
      ]
    );
  };

  const handleBlock = async (u: FollowUser) => {
    Alert.alert(
      `Bloquer ${u.name} ?`,
      'Cette personne ne pourra plus vous suivre ni voir votre profil.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Bloquer', style: 'destructive', onPress: async () => {
          setActionLoading(u.user_id);
          try {
            await api.post(`/users/${u.user_id}/block`, {});
            setUsers(prev => prev.filter(x => x.user_id !== u.user_id));
            // Le blocage supprime les liens dans les deux sens
            if (activeTab === 'followers') onFollowersCountChange?.(-1);
            if (activeTab === 'following') onFollowingCountChange?.(-1);
          } catch (e: any) { Alert.alert('Erreur', e.message); }
          finally { setActionLoading(null); }
        }},
      ]
    );
  };

  const handleMoreOptions = (u: FollowUser) => {
    const options: any[] = [];
    if (activeTab === 'followers' && isOwnProfile) {
      options.push({ text: 'Retirer cet abonné', onPress: () => handleRemoveFollower(u) });
    }
    if (isOwnProfile) {
      options.push({ text: 'Bloquer', style: 'destructive', onPress: () => handleBlock(u) });
    }
    options.push({ text: 'Annuler', style: 'cancel' });
    Alert.alert(u.name, undefined, options);
  };

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const filtered = users.filter(u => {
    const matchSearch = search.trim() === '' ||
      u.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchRole = roleFilter === 'all' ||
      (roleFilter === 'coach' && u.role === 'coach') ||
      (roleFilter === 'user'  && u.role !== 'coach');
    return matchSearch && matchRole;
  });

  // ── Row renderers ─────────────────────────────────────────────────────────────
  const renderFollowRow = ({ item: u }: { item: FollowUser }) => {
    const isLoad  = actionLoading === u.user_id;
    const isCoach = u.role === 'coach';
    const following  = activeTab === 'followers' ? (u.is_following_back ?? false) : true;
    const mutualFollow = activeTab === 'following' && u.follows_back;
    const canInteract = !!meId && u.user_id !== meId;
    const canManage   = isOwnProfile && canInteract;

    return (
      <View style={s.row} testID={`follow-row-${u.user_id}`}>
        <TouchableOpacity
          style={s.rowLeft}
          onPress={() => { onClose(); router.push(`/user/${u.user_id}` as any); }}
          activeOpacity={0.7}
        >
          <UserAvatar uri={u.picture} name={u.name} size={46} />
          <View style={s.rowInfo}>
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1}>{u.name}</Text>
              {mutualFollow && (
                <View style={s.mutualBadge}><Text style={s.mutualText}>Mutuel</Text></View>
              )}
            </View>
            <View style={[s.rolePill, isCoach && s.rolePillCoach]}>
              <Text style={[s.roleText, isCoach && s.roleTextCoach]}>
                {isCoach ? 'Coach' : 'Utilisateur'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {canInteract && (
          <View style={s.rowActions}>
            <TouchableOpacity
              style={[s.followBtn, following && s.followBtnActive]}
              onPress={() => handleFollowToggle(u)}
              disabled={isLoad}
              testID={`follow-btn-${u.user_id}`}
            >
              {isLoad
                ? <ActivityIndicator size="small" color={following ? Colors.foreground : '#fff'} />
                : <Text style={[s.followBtnText, following && s.followBtnTextActive]}>
                    {following ? 'Abonné' : 'Suivre'}
                  </Text>
              }
            </TouchableOpacity>
            {canManage && (
              <TouchableOpacity style={s.moreBtn} onPress={() => handleMoreOptions(u)} testID={`more-btn-${u.user_id}`}>
                <Ionicons name="ellipsis-horizontal" size={18} color={Colors.muted} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  const renderSuggestionRow = ({ item: u }: { item: SuggestionUser }) => {
    const isLoad  = actionLoading === u.user_id;
    const isCoach = u.role === 'coach';

    return (
      <View style={s.row} testID={`suggestion-row-${u.user_id}`}>
        <TouchableOpacity
          style={s.rowLeft}
          onPress={() => { onClose(); router.push(`/user/${u.user_id}` as any); }}
          activeOpacity={0.7}
        >
          <UserAvatar uri={u.picture} name={u.name} size={46} />
          <View style={s.rowInfo}>
            <Text style={s.name} numberOfLines={1}>{u.name}</Text>
            <View style={s.suggestMeta}>
              <View style={[s.rolePill, isCoach && s.rolePillCoach]}>
                <Text style={[s.roleText, isCoach && s.roleTextCoach]}>
                  {isCoach ? 'Coach' : 'Utilisateur'}
                </Text>
              </View>
              {u.common_count > 0 && (
                <View style={s.commonBadge}>
                  <Ionicons name="heart-circle-outline" size={11} color={Colors.primary} />
                  <Text style={s.commonText}>
                    {u.common_count} intérêt{u.common_count > 1 ? 's' : ''} commun{u.common_count > 1 ? 's' : ''}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </TouchableOpacity>

        {meId && u.user_id !== meId && (
          <TouchableOpacity
            style={s.followBtn}
            onPress={() => handleSuggestionFollow(u)}
            disabled={isLoad}
            testID={`suggest-follow-btn-${u.user_id}`}
          >
            {isLoad
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={s.followBtnText}>Suivre</Text>
            }
          </TouchableOpacity>
        )}
      </View>
    );
  };

  // ── Tab counts & labels ───────────────────────────────────────────────────────
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'followers',   label: 'Abonnés',      count: followersCount },
    { key: 'following',   label: 'Abonnements',  count: followingCount },
    ...(isOwnProfile && meId ? [{ key: 'suggestions' as Tab, label: 'Suggestions' }] : []),
  ];

  const headerTitle =
    activeTab === 'followers'   ? `Abonnés (${followersCount})`    :
    activeTab === 'following'   ? `Abonnements (${followingCount})` :
    'Suggestions';

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={s.container}>
        {/* ── Header ─────────────────────────────────────────────────── */}
        <View style={s.header}>
          <View style={{ width: 40 }} />
          <Text style={s.headerTitle}>{headerTitle}</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} testID="follow-modal-close">
            <Ionicons name="close" size={22} color={Colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* ── Onglets ─────────────────────────────────────────────────── */}
        <View style={s.tabBar}>
          {tabs.map(t => (
            <TouchableOpacity
              key={t.key}
              style={[s.tabItem, activeTab === t.key && s.tabItemActive]}
              onPress={() => setActiveTab(t.key)}
              testID={`tab-${t.key}`}
            >
              <Text style={[s.tabLabel, activeTab === t.key && s.tabLabelActive]}>
                {t.label}
                {t.count !== undefined ? ` · ${t.count}` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Contenu selon l'onglet actif ─────────────────────────────── */}
        {activeTab === 'suggestions' ? (
          // ── Onglet Suggestions ──
          <SuggestionsTab
            suggestions={suggestions}
            loading={suggestLoading}
            hasInterests={hasInterests}
            isPopularFallback={isPopularFallback}
            hasMore={hasMoreSuggestions}
            onLoadMore={() => loadSuggestions(suggestSkip, false)}
            renderRow={renderSuggestionRow}
            onEditInterests={() => { onClose(); router.push('/edit-profile' as any); }}
            meId={meId}
          />
        ) : (
          // ── Onglets Abonnés / Abonnements ──
          <>
            <View style={s.searchWrap}>
              <Ionicons name="search-outline" size={16} color={Colors.muted} />
              <TextInput
                style={s.searchInput}
                placeholder="Rechercher..."
                placeholderTextColor={Colors.muted}
                value={search}
                onChangeText={setSearch}
                clearButtonMode="while-editing"
                testID="follow-search-input"
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch('')}>
                  <Ionicons name="close-circle" size={16} color={Colors.muted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={s.filterRow}>
              {(['all', 'coach', 'user'] as RoleFilter[]).map(f => (
                <TouchableOpacity
                  key={f}
                  style={[s.filterPill, roleFilter === f && s.filterPillActive]}
                  onPress={() => setRoleFilter(f)}
                  testID={`filter-${f}`}
                >
                  <Text style={[s.filterText, roleFilter === f && s.filterTextActive]}>
                    {f === 'all' ? 'Tous' : f === 'coach' ? 'Coachs' : 'Utilisateurs'}
                  </Text>
                </TouchableOpacity>
              ))}
              <Text style={s.filterCount}>{filtered.length}/{users.length}</Text>
            </View>

            {loading ? (
              <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
            ) : filtered.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="people-outline" size={40} color={Colors.muted} />
                <Text style={s.emptyText}>
                  {search
                    ? 'Aucun résultat'
                    : activeTab === 'followers' ? 'Aucun abonné' : 'Aucun abonnement'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filtered}
                keyExtractor={u => u.user_id}
                renderItem={renderFollowRow}
                contentContainerStyle={{ paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
                ItemSeparatorComponent={() => <View style={s.separator} />}
              />
            )}
          </>
        )}
      </View>
    </Modal>
  );
}

// ── Suggestions Tab sub-component ─────────────────────────────────────────────
function SuggestionsTab({
  suggestions, loading, hasInterests, isPopularFallback, hasMore,
  onLoadMore, renderRow, onEditInterests, meId,
}: {
  suggestions: SuggestionUser[];
  loading: boolean;
  hasInterests: boolean | null;
  isPopularFallback: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  renderRow: (info: { item: SuggestionUser }) => React.ReactElement;
  onEditInterests: () => void;
  meId: string | null;
}) {
  const showNoInterestsCTA = hasInterests === false;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: 40 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ── CTA "Aucun intérêt" ─── */}
      {showNoInterestsCTA && (
        <View style={s.interestCTA} testID="no-interests-cta">
          <View style={s.interestCTAIcon}>
            <Ionicons name="heart-outline" size={28} color={Colors.primary} />
          </View>
          <Text style={s.interestCTATitle}>Personnalisez vos suggestions</Text>
          <Text style={s.interestCTADesc}>
            Ajoutez des centres d'intérêts à votre profil pour découvrir des personnes qui partagent vos passions.
          </Text>
          <TouchableOpacity
            style={s.interestCTABtn}
            onPress={onEditInterests}
            testID="edit-interests-btn"
          >
            <Text style={s.interestCTABtnText}>Ajouter mes intérêts</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── En-tête section suggestions populaires ─── */}
      {(showNoInterestsCTA || isPopularFallback) && suggestions.length > 0 && (
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>
            {showNoInterestsCTA ? 'Utilisateurs populaires' : 'Populaires dans la communauté'}
          </Text>
        </View>
      )}

      {/* ── Liste ─── */}
      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
      ) : suggestions.length === 0 && !loading ? (
        <View style={s.empty}>
          <Ionicons name="sparkles-outline" size={40} color={Colors.muted} />
          <Text style={s.emptyText}>
            {hasInterests
              ? 'Aucune suggestion avec vos intérêts actuels'
              : 'Aucun utilisateur à suggérer'}
          </Text>
        </View>
      ) : (
        <>
          {suggestions.map((item, index) => (
            <React.Fragment key={item.user_id}>
              {renderRow({ item })}
              {index < suggestions.length - 1 && (
                <View style={s.separator} />
              )}
            </React.Fragment>
          ))}
          {/* ── Bouton "Voir plus" ─── */}
          {hasMore && (
            <TouchableOpacity
              style={s.loadMoreBtn}
              onPress={onLoadMore}
              testID="load-more-suggestions"
            >
              <Text style={s.loadMoreText}>Voir 10 de plus</Text>
              <Ionicons name="chevron-down" size={14} color={Colors.primary} />
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Onglets
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tabItem: {
    flex: 1, paddingVertical: 12, alignItems: 'center',
    borderBottomWidth: 2, borderBottomColor: 'transparent',
  },
  tabItemActive: { borderBottomColor: Colors.primary },
  tabLabel: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  tabLabelActive: { color: Colors.primary },

  // Recherche
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card,
    marginHorizontal: 16, marginTop: 12,
    borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.foreground, paddingVertical: 0 },

  // Filtres
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  filterTextActive: { color: Colors.background },
  filterCount: { fontSize: 12, color: Colors.muted, marginLeft: 'auto' as any },

  // Lignes
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, gap: 10,
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  mutualBadge: {
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4,
  },
  mutualText: { fontSize: 10, fontWeight: '700', color: Colors.primary },

  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(150,150,150,0.12)',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  rolePillCoach: { backgroundColor: Colors.primary + '18' },
  roleText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  roleTextCoach: { color: Colors.primary },

  // Suggestions row meta
  suggestMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  commonBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: Colors.primary + '15',
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6,
  },
  commonText: { fontSize: 11, fontWeight: '600', color: Colors.primary },

  // Boutons action
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  followBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: Radius.full, backgroundColor: Colors.primary,
    minWidth: 72, alignItems: 'center',
  },
  followBtnActive: {
    backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border,
  },
  followBtnText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  followBtnTextActive: { color: Colors.foreground },
  moreBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },

  // No interests CTA
  interestCTA: {
    margin: 16, padding: 20,
    backgroundColor: Colors.card,
    borderRadius: Radius.lg,
    alignItems: 'center', gap: 8,
    borderWidth: 1, borderColor: Colors.primary + '30',
  },
  interestCTAIcon: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  interestCTATitle: { fontSize: 15, fontWeight: '700', color: Colors.foreground, textAlign: 'center' },
  interestCTADesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  interestCTABtn: {
    marginTop: 8, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: Colors.primary, borderRadius: Radius.full,
  },
  interestCTABtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },

  // Section header
  sectionHeader: { paddingHorizontal: 16, paddingVertical: 10 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Voir plus
  loadMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 12, paddingVertical: 12,
    backgroundColor: Colors.card, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  loadMoreText: { fontSize: 14, fontWeight: '600', color: Colors.primary },

  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 74 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.muted },
});
