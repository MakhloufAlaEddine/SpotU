import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, Modal, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Image,
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
  is_following_back?: boolean;  // followers list: did I follow them?
  follows_back?: boolean;       // following list: do they follow me back?
  is_blocked?: boolean;
};

type ModalType = 'followers' | 'following';
type RoleFilter = 'all' | 'coach' | 'user';

interface Props {
  visible: boolean;
  onClose: () => void;
  profileId: string;           // whose profile
  meId: string | null;         // current logged-in user id
  type: ModalType;
  count: number;
  isOwnProfile: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────────
export function FollowListModal({ visible, onClose, profileId, meId, type, count, isOwnProfile }: Props) {
  const router = useRouter();
  const [users, setUsers]             = useState<FollowUser[]>([]);
  const [loading, setLoading]         = useState(false);
  const [search, setSearch]           = useState('');
  const [roleFilter, setRoleFilter]   = useState<RoleFilter>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const title = type === 'followers' ? 'Abonnés' : 'Abonnements';

  const load = useCallback(async () => {
    if (!visible) return;
    setLoading(true);
    try {
      const data = await api.get<FollowUser[]>(
        `/users/${profileId}/${type === 'followers' ? 'followers' : 'following'}`
      );
      setUsers(Array.isArray(data) ? data : []);
    } catch {}
    finally { setLoading(false); }
  }, [visible, profileId, type]);

  useEffect(() => { load(); }, [load]);

  // Réinitialiser les filtres à l'ouverture
  useEffect(() => {
    if (visible) { setSearch(''); setRoleFilter('all'); }
  }, [visible]);

  // Filtrage local : recherche + rôle
  const filtered = users.filter(u => {
    const matchSearch = search.trim() === '' ||
      u.name.toLowerCase().includes(search.trim().toLowerCase());
    const matchRole = roleFilter === 'all' ||
      (roleFilter === 'coach' && u.role === 'coach') ||
      (roleFilter === 'user'  && u.role !== 'coach');
    return matchSearch && matchRole;
  });

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleFollowToggle = async (u: FollowUser) => {
    if (!meId) return;
    setActionLoading(u.user_id);
    try {
      const isFollowingThem = type === 'followers' ? u.is_following_back : true;
      if (isFollowingThem) {
        // Se désabonner
        await api.delete(`/users/${u.user_id}/follow`);
        setUsers(prev => prev.map(x =>
          x.user_id === u.user_id
            ? { ...x, is_following_back: false, follows_back: false }
            : x
        ));
      } else {
        // Suivre
        await api.post(`/users/${u.user_id}/follow`, {});
        setUsers(prev => prev.map(x =>
          x.user_id === u.user_id ? { ...x, is_following_back: true } : x
        ));
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Action impossible');
    } finally { setActionLoading(null); }
  };

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
          } catch (e: any) { Alert.alert('Erreur', e.message); }
          finally { setActionLoading(null); }
        }},
      ]
    );
  };

  const handleBlock = async (u: FollowUser) => {
    Alert.alert(
      `Bloquer ${u.name} ?`,
      'Cette personne ne pourra plus vous suivre ni voir votre profil. Les deux abonnements seront supprimés.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Bloquer', style: 'destructive', onPress: async () => {
          setActionLoading(u.user_id);
          try {
            await api.post(`/users/${u.user_id}/block`, {});
            // Retirer localement des deux listes
            setUsers(prev => prev.filter(x => x.user_id !== u.user_id));
          } catch (e: any) { Alert.alert('Erreur', e.message); }
          finally { setActionLoading(null); }
        }},
      ]
    );
  };

  const handleMoreOptions = (u: FollowUser) => {
    const options: any[] = [];
    if (type === 'followers' && isOwnProfile) {
      options.push({ text: 'Retirer cet abonné', onPress: () => handleRemoveFollower(u) });
    }
    if (isOwnProfile) {
      options.push({ text: 'Bloquer', style: 'destructive', onPress: () => handleBlock(u) });
    }
    options.push({ text: 'Annuler', style: 'cancel' });
    Alert.alert(u.name, undefined, options);
  };

  // ── Row ───────────────────────────────────────────────────────────────────────
  const renderRow = ({ item: u }: { item: FollowUser }) => {
    const isLoading  = actionLoading === u.user_id;
    const isCoach    = u.role === 'coach';
    // In followers tab: "following" = I follow them back; in following tab: I always follow them (they're in my list)
    const following  = type === 'followers' ? (u.is_following_back ?? false) : true;
    const mutualFollow = type === 'following' && u.follows_back;
    // Show follow btn for any authenticated user (not viewing their own row)
    const canInteract = !!meId && u.user_id !== meId;
    // Show management actions (3-dot menu) only to profile owner
    const canManage  = isOwnProfile && canInteract;

    return (
      <View style={s.row} testID={`follow-row-${u.user_id}`}>
        {/* Avatar + infos — tap → profil */}
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
                <View style={s.mutualBadge}>
                  <Text style={s.mutualText}>Mutuel</Text>
                </View>
              )}
            </View>
            <View style={[s.rolePill, isCoach && s.rolePillCoach]}>
              <Text style={[s.roleText, isCoach && s.roleTextCoach]}>
                {isCoach ? 'Coach' : 'Utilisateur'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Actions */}
        {canInteract && (
          <View style={s.rowActions}>
            {/* Bouton Suivre / Abonné */}
            <TouchableOpacity
              style={[s.followBtn, following && s.followBtnActive]}
              onPress={() => handleFollowToggle(u)}
              disabled={isLoading}
              testID={`follow-btn-${u.user_id}`}
            >
              {isLoading
                ? <ActivityIndicator size="small" color={following ? Colors.foreground : '#fff'} />
                : <Text style={[s.followBtnText, following && s.followBtnTextActive]}>
                    {following ? 'Abonné' : 'Suivre'}
                  </Text>
              }
            </TouchableOpacity>

            {/* ⋯ Plus d'options (propriétaire uniquement) */}
            {canManage && (
              <TouchableOpacity
                style={s.moreBtn}
                onPress={() => handleMoreOptions(u)}
                testID={`more-btn-${u.user_id}`}
              >
                <Ionicons name="ellipsis-horizontal" size={18} color={Colors.muted} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

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
          <Text style={s.headerTitle}>{title} ({count})</Text>
          <TouchableOpacity onPress={onClose} style={s.closeBtn} testID="follow-modal-close">
            <Ionicons name="close" size={22} color={Colors.foreground} />
          </TouchableOpacity>
        </View>

        {/* ── Recherche ──────────────────────────────────────────────── */}
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={16} color={Colors.muted} style={s.searchIcon} />
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

        {/* ── Filtre rôle ────────────────────────────────────────────── */}
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
          {/* Compteur filtré */}
          <Text style={s.filterCount}>
            {filtered.length}/{users.length}
          </Text>
        </View>

        {/* ── Liste ──────────────────────────────────────────────────── */}
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />
        ) : filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="people-outline" size={40} color={Colors.muted} />
            <Text style={s.emptyText}>
              {search ? 'Aucun résultat' : type === 'followers' ? 'Aucun abonné' : 'Aucun abonnement'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={u => u.user_id}
            renderItem={renderRow}
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={s.separator} />}
          />
        )}
      </View>
    </Modal>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.foreground },
  closeBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  // Recherche
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card,
    marginHorizontal: 16, marginTop: 12,
    borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 9,
    gap: 8,
  },
  searchIcon: { },
  searchInput: {
    flex: 1, fontSize: 14, color: Colors.foreground,
    paddingVertical: 0,
  },

  // Filtres rôle
  filterRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  filterTextActive: { color: Colors.background },
  filterCount: { fontSize: 12, color: Colors.muted, marginLeft: 'auto' as any },

  // Lignes utilisateur
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    gap: 10,
  },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  mutualBadge: {
    backgroundColor: Colors.primary + '20',
    paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 4,
  },
  mutualText: { fontSize: 10, fontWeight: '700', color: Colors.primary },

  rolePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(150,150,150,0.12)',
    paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6,
  },
  rolePillCoach: { backgroundColor: Colors.primary + '18' },
  roleText: { fontSize: 11, fontWeight: '600', color: Colors.muted },
  roleTextCoach: { color: Colors.primary },

  // Boutons action
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  followBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.primary,
    minWidth: 72, alignItems: 'center',
  },
  followBtnActive: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: Colors.border,
  },
  followBtnText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  followBtnTextActive: { color: Colors.foreground },
  moreBtn: {
    width: 34, height: 34,
    borderRadius: 17,
    backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center',
  },

  separator: { height: 1, backgroundColor: Colors.border, marginLeft: 74 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 },
  emptyText: { fontSize: 14, color: Colors.muted },
});
