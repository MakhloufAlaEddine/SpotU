import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, RefreshControl, Modal, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { TagPointCard } from '../../components/TagPointCard';
import { WButton } from '../../components/WButton';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout, updateUser, refreshUser } = useAuth();
  const { t, lang, setLanguage } = useLang();
  const [myTagPoints, setMyTagPoints] = useState<any[]>([]);
  const [myServices, setMyServices] = useState<any[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editModal, setEditModal] = useState(false);
  const [editName, setEditName] = useState(user?.name || '');
  const [editBio, setEditBio] = useState(user?.bio || '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [becomingCoach, setBecomingCoach] = useState(false);

  const loadUserData = useCallback(async () => {
    if (!user) return;
    setLoadingPoints(true);
    try {
      const [pts, svcs] = await Promise.all([
        api.get('/tag-points/mine'),
        user.role === 'coach' || user.role === 'admin' ? api.get('/services/mine') : Promise.resolve([]),
      ]);
      setMyTagPoints(pts);
      setMyServices(svcs);
    } catch {}
    finally { setLoadingPoints(false); setRefreshing(false); }
  }, [user]);

  React.useEffect(() => {
    loadUserData();
  }, [loadUserData]);

  const onRefresh = () => {
    setRefreshing(true);
    loadUserData();
  };

  const handleLogout = () => {
    Alert.alert(t('logout'), 'Êtes-vous sûr de vouloir vous déconnecter ?', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: () => {
        logout();
        router.replace('/(auth)/login');
      }},
    ]);
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await api.put('/users/profile', {
        name: editName.trim() || undefined,
        bio: editBio.trim() || undefined,
      });
      updateUser(updated);
      setEditModal(false);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally { setSavingProfile(false); }
  };

  const handleBecomeCoach = async () => {
    Alert.alert('Devenir Coach', 'Souhaitez-vous devenir coach sur WINEK ?', [
      { text: t('cancel'), style: 'cancel' },
      { text: 'Confirmer', onPress: async () => {
        setBecomingCoach(true);
        try {
          const updated = await api.post('/users/become-coach');
          updateUser(updated);
          await refreshUser();
        } catch (err: any) { Alert.alert(t('error'), err.message); }
        finally { setBecomingCoach(false); }
      }},
    ]);
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>👤</Text>
          <Text style={styles.emptyText}>Connectez-vous pour accéder à votre profil</Text>
          <WButton label={t('login')} onPress={() => router.push('/(auth)/login')} style={{ marginTop: Spacing.lg }} testID="go-login-from-profile" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Profile Header */}
        <View style={styles.header} testID="profile-header">
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={styles.info}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{user.name}</Text>
              {user.role === 'admin' && <View style={styles.badge}><Text style={styles.badgeText}>{t('adminBadge')}</Text></View>}
              {user.role === 'coach' && <View style={[styles.badge, styles.coachBadge]}><Text style={styles.badgeText}>{t('coachBadge')}</Text></View>}
              {user.is_coach_verified && <View style={[styles.badge, styles.verifiedBadge]}><Text style={styles.badgeText}>✓</Text></View>}
            </View>
            <Text style={styles.email}>{user.email}</Text>
            {user.bio ? <Text style={styles.bio} numberOfLines={2}>{user.bio}</Text> : null}
          </View>
          <TouchableOpacity style={styles.editBtn} onPress={() => { setEditName(user.name); setEditBio(user.bio || ''); setEditModal(true); }} testID="edit-profile-btn">
            <Text style={styles.editBtnText}>✏️</Text>
          </TouchableOpacity>
        </View>

        {/* Language selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('language')}</Text>
          <View style={styles.langRow}>
            {(['fr', 'en'] as const).map((l) => (
              <TouchableOpacity
                key={l}
                style={[styles.langBtn, lang === l && styles.langBtnActive]}
                onPress={() => {
                  setLanguage(l);
                  api.put('/users/profile', { language: l }).catch(() => {});
                }}
                testID={`lang-${l}`}
              >
                <Text style={[styles.langText, lang === l && styles.langTextActive]}>
                  {l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Coach actions */}
        {user.role === 'user' && (
          <View style={styles.section}>
            <WButton
              label={`🎯 ${t('becomeCoach')}`}
              onPress={handleBecomeCoach}
              loading={becomingCoach}
              variant="secondary"
              testID="become-coach-btn"
            />
          </View>
        )}

        {/* Admin panel link */}
        {user.role === 'admin' && (
          <TouchableOpacity style={styles.adminBtn} onPress={() => router.push('/admin')} testID="go-admin-btn">
            <Text style={styles.adminBtnText}>🛠️ {t('adminPanel')}</Text>
          </TouchableOpacity>
        )}

        {/* My TagPoints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📍 {t('myTagPoints')} ({myTagPoints.length})</Text>
          {loadingPoints ? (
            <ActivityIndicator color={Colors.primary} style={{ marginTop: 8 }} />
          ) : myTagPoints.length === 0 ? (
            <Text style={styles.emptySection}>{t('noPoints')}</Text>
          ) : (
            myTagPoints.slice(0, 3).map((pt) => <TagPointCard key={pt.point_id} point={pt} lang={lang} />)
          )}
          {myTagPoints.length > 3 && (
            <TouchableOpacity testID="see-all-tagpoints">
              <Text style={styles.seeAll}>Voir tout →</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* My Services (coach) */}
        {(user.role === 'coach' || user.role === 'admin') && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>🎯 {t('myServices')} ({myServices.length})</Text>
              <TouchableOpacity
                onPress={() => router.push('/create-service')}
                style={styles.addServiceBtn}
                testID="add-service-btn"
              >
                <Text style={styles.addServiceText}>+ Ajouter</Text>
              </TouchableOpacity>
            </View>
            {myServices.length === 0 ? (
              <Text style={styles.emptySection}>{t('noResults')}</Text>
            ) : (
              myServices.slice(0, 2).map((svc) => (
                <View key={svc.service_id} style={styles.serviceRow}>
                  <View style={styles.serviceInfo}>
                    <Text style={styles.serviceTitle} numberOfLines={1}>{svc.title}</Text>
                    <Text style={styles.servicePrice}>{svc.price}€ · {svc.duration_min}min</Text>
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Logout */}
        <WButton
          label={t('logout')}
          onPress={handleLogout}
          variant="danger"
          style={styles.logoutBtn}
          testID="logout-btn"
        />
      </ScrollView>

      {/* Edit Profile Modal */}
      <Modal visible={editModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{t('editProfile')}</Text>
            <View style={styles.modalInput}>
              <Text style={styles.inputLabel}>{t('fullName')}</Text>
              <TextInput
                style={styles.textInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Votre nom"
                placeholderTextColor={Colors.muted}
                testID="edit-name-input"
              />
            </View>
            <View style={styles.modalInput}>
              <Text style={styles.inputLabel}>{t('bio')}</Text>
              <TextInput
                style={[styles.textInput, styles.textInputMulti]}
                value={editBio}
                onChangeText={setEditBio}
                placeholder="Dites quelque chose sur vous…"
                placeholderTextColor={Colors.muted}
                multiline
                numberOfLines={3}
                testID="edit-bio-input"
              />
            </View>
            <View style={styles.modalActions}>
              <WButton label={t('cancel')} onPress={() => setEditModal(false)} variant="secondary" style={{ flex: 1 }} testID="cancel-edit-btn" />
              <WButton label={t('save')} onPress={handleSaveProfile} loading={savingProfile} style={{ flex: 1 }} testID="save-profile-btn" />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: Spacing.md, paddingBottom: 60 },
  header: { 
    flexDirection: 'row', 
    alignItems: 'flex-start', 
    gap: Spacing.sm, 
    padding: Spacing.md, 
    backgroundColor: Colors.card, 
    borderRadius: Radius.xl, 
    marginBottom: Spacing.md 
  },
  avatar: { 
    width: 64, 
    height: 64, 
    borderRadius: 32, 
    backgroundColor: Colors.primary, 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  avatarText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  name: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  badge: { 
    backgroundColor: Colors.card, 
    borderRadius: Radius.full, 
    paddingHorizontal: 8, 
    paddingVertical: 2, 
    borderWidth: 1, 
    borderColor: Colors.border 
  },
  coachBadge: { backgroundColor: Colors.header, borderColor: Colors.primary },
  verifiedBadge: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  badgeText: { fontSize: 10, fontWeight: '700', color: Colors.primary },
  email: { fontSize: 12, color: Colors.muted, marginTop: 3 },
  bio: { fontSize: 13, color: Colors.muted, marginTop: 4, lineHeight: 18 },
  editBtn: { padding: 8 },
  editBtnText: { fontSize: 20 },
  section: { marginBottom: Spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground, marginBottom: 10 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  addServiceBtn: { 
    backgroundColor: Colors.primaryLight, 
    borderRadius: Radius.full, 
    paddingHorizontal: 12, 
    paddingVertical: 5 
  },
  addServiceText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  langRow: { flexDirection: 'row', gap: Spacing.sm },
  langBtn: { 
    flex: 1, 
    paddingVertical: 10, 
    paddingHorizontal: 12, 
    borderRadius: Radius.lg, 
    borderWidth: 1, 
    borderColor: Colors.border, 
    backgroundColor: Colors.card,
    alignItems: 'center' 
  },
  langBtnActive: { backgroundColor: Colors.header, borderColor: Colors.primary },
  langText: { fontSize: 14, fontWeight: '600', color: Colors.foreground },
  langTextActive: { color: Colors.primary },
  adminBtn: { 
    backgroundColor: Colors.card, 
    borderRadius: Radius.lg, 
    padding: Spacing.md, 
    marginBottom: Spacing.md, 
    alignItems: 'center' 
  },
  adminBtnText: { fontSize: 15, fontWeight: '700', color: Colors.warning },
  emptySection: { fontSize: 13, color: Colors.muted, fontStyle: 'italic' },
  seeAll: { fontSize: 14, color: Colors.primary, fontWeight: '600', marginTop: 6 },
  serviceRow: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: Colors.card, 
    borderRadius: Radius.md, 
    padding: Spacing.md, 
    marginBottom: Spacing.sm 
  },
  serviceInfo: { flex: 1 },
  serviceTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  servicePrice: { fontSize: 13, color: Colors.primary, fontWeight: '600', marginTop: 2 },
  logoutBtn: { marginTop: Spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 15, color: Colors.muted, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { 
    backgroundColor: Colors.card, 
    borderTopLeftRadius: Radius.xl, 
    borderTopRightRadius: Radius.xl, 
    padding: Spacing.xl 
  },
  modalTitle: { fontSize: 20, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.lg },
  modalInput: { marginBottom: Spacing.md },
  inputLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, marginBottom: 6 },
  textInput: { 
    borderWidth: 1, 
    borderColor: Colors.border, 
    borderRadius: Radius.md, 
    padding: Spacing.md, 
    fontSize: 15, 
    color: Colors.foreground,
    backgroundColor: Colors.background 
  },
  textInputMulti: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
});
