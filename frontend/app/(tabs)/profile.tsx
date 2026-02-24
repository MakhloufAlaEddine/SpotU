import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WButton } from '../../components/WButton';
import { WInput } from '../../components/WInput';
import { TagPointCard } from '../../components/TagPointCard';
import { Colors, Spacing, Radius, Shadow } from '../../constants/Colors';
import { Lang } from '../../lib/i18n';

export default function ProfileScreen() {
  const { user, logout, updateUser, refreshUser } = useAuth();
  const { t, lang, setLanguage } = useLang();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [myPoints, setMyPoints] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingPoints, setLoadingPoints] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name || '');
      setBio(user.bio || '');
      loadMyPoints();
    }
  }, [user]);

  const loadMyPoints = async () => {
    setLoadingPoints(true);
    try {
      const pts = await api.get('/tag-points/mine');
      setMyPoints(pts);
    } catch {} finally {
      setLoadingPoints(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await api.put('/users/profile', { name: name.trim(), bio: bio.trim(), language: lang });
      updateUser(updated);
      setEditing(false);
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBecomeCoach = async () => {
    Alert.alert('Devenir coach', 'Voulez-vous activer le mode coach ?', [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('confirm'), onPress: async () => {
          try {
            const updated = await api.post('/users/become-coach', {});
            updateUser(updated);
          } catch (err: any) {
            Alert.alert(t('error'), err.message);
          }
        }
      }
    ]);
  };

  const handleLogout = () => {
    Alert.alert(t('logout'), 'Êtes-vous sûr ?', [
      { text: t('cancel'), style: 'cancel' },
      { text: t('logout'), style: 'destructive', onPress: async () => { await logout(); router.replace('/(auth)/login'); } }
    ]);
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.center}>
          <Text style={styles.loginMsg}>Connectez-vous pour accéder à votre profil</Text>
          <WButton label={t('login')} onPress={() => router.replace('/(auth)/login')} testID="login-from-profile-btn" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Avatar & Header */}
        <View style={styles.header} testID="profile-header">
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name?.[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={styles.headerInfo}>
            <Text style={styles.userName}>{user.name}</Text>
            <Text style={styles.userEmail}>{user.email}</Text>
            <View style={styles.badges}>
              {user.role === 'admin' && <View style={[styles.badge, { backgroundColor: '#FF3B30' }]}><Text style={styles.badgeText}>⚙️ Admin</Text></View>}
              {user.role === 'coach' && <View style={[styles.badge, { backgroundColor: Colors.accent }]}><Text style={styles.badgeText}>🎯 Coach</Text></View>}
              {user.is_coach_verified && <View style={[styles.badge, { backgroundColor: Colors.primaryLight, borderWidth: 1, borderColor: Colors.primary }]}><Text style={[styles.badgeText, { color: Colors.primary }]}>✓ Vérifié</Text></View>}
            </View>
          </View>
        </View>

        {/* Edit profile */}
        {editing ? (
          <View style={styles.card}>
            <WInput label={t('fullName')} value={name} onChangeText={setName} testID="edit-name-input" />
            <WInput label={t('bio')} value={bio} onChangeText={setBio} multiline numberOfLines={3} testID="edit-bio-input" />
            <View style={styles.btnRow}>
              <WButton label={t('cancel')} onPress={() => setEditing(false)} variant="secondary" style={{ flex: 1 }} testID="cancel-edit-btn" />
              <WButton label={t('save')} onPress={handleSave} loading={saving} style={{ flex: 1 }} testID="save-profile-btn" />
            </View>
          </View>
        ) : (
          <TouchableOpacity testID="edit-profile-btn" style={styles.card} onPress={() => setEditing(true)}>
            {user.bio && <Text style={styles.bio}>{user.bio}</Text>}
            <Text style={styles.editHint}>✏️ {t('editProfile')}</Text>
          </TouchableOpacity>
        )}

        {/* Language */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('language')}</Text>
          <View style={styles.langRow}>
            {(['fr', 'en'] as Lang[]).map((l) => (
              <TouchableOpacity
                key={l}
                testID={`lang-switch-${l}`}
                style={[styles.langPill, lang === l && styles.langPillActive]}
                onPress={() => setLanguage(l)}
              >
                <Text style={[styles.langText, lang === l && styles.langTextActive]}>
                  {l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Become coach */}
        {user.role === 'user' && (
          <TouchableOpacity testID="become-coach-btn" style={styles.coachCta} onPress={handleBecomeCoach} activeOpacity={0.85}>
            <Text style={styles.coachCtaTitle}>🎯 {t('becomeCoach')}</Text>
            <Text style={styles.coachCtaDesc}>Proposez vos séances de coaching et gagnez de l'argent</Text>
          </TouchableOpacity>
        )}

        {/* My TagPoints */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('myTagPoints')} ({myPoints.length})</Text>
          {loadingPoints ? <ActivityIndicator color={Colors.primary} /> :
            myPoints.length === 0
              ? <Text style={styles.emptyText}>Aucun TagPoint publié</Text>
              : myPoints.slice(0, 5).map((pt) => <TagPointCard key={pt.point_id} point={pt} lang={lang} />)
          }
        </View>

        {/* Admin panel */}
        {user.role === 'admin' && (
          <TouchableOpacity testID="admin-panel-btn" style={styles.adminBtn} onPress={() => router.push('/admin')}>
            <Text style={styles.adminBtnText}>⚙️ {t('adminPanel')}</Text>
          </TouchableOpacity>
        )}

        {/* Logout */}
        <WButton label={t('logout')} onPress={handleLogout} variant="ghost" style={styles.logoutBtn} testID="logout-btn" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: Spacing.lg },
  loginMsg: { fontSize: 16, color: Colors.muted, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 32, fontWeight: '800', color: Colors.primary },
  headerInfo: { flex: 1 },
  userName: { fontSize: 20, fontWeight: '800', color: Colors.foreground },
  userEmail: { fontSize: 13, color: Colors.muted, marginBottom: 6 },
  badges: { flexDirection: 'row', gap: 6 },
  badge: { borderRadius: Radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  card: { backgroundColor: Colors.secondary, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  bio: { fontSize: 14, color: Colors.foreground, marginBottom: 8 },
  editHint: { fontSize: 13, color: Colors.muted },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: Spacing.sm },
  section: { marginBottom: Spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.sm },
  langRow: { flexDirection: 'row', gap: 10 },
  langPill: { flex: 1, padding: Spacing.sm + 2, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  langPillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  langText: { fontSize: 14, fontWeight: '600', color: Colors.muted },
  langTextActive: { color: Colors.primary },
  coachCta: { backgroundColor: Colors.accent, borderRadius: Radius.lg, padding: Spacing.md, marginBottom: Spacing.md },
  coachCtaTitle: { fontSize: 16, fontWeight: '800', color: '#fff', marginBottom: 4 },
  coachCtaDesc: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  adminBtn: { backgroundColor: Colors.foreground, borderRadius: Radius.lg, padding: Spacing.md, alignItems: 'center', marginBottom: Spacing.md },
  adminBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  logoutBtn: { marginTop: Spacing.sm },
  emptyText: { fontSize: 14, color: Colors.muted },
});
