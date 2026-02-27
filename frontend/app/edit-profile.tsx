import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Image, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { Colors, Spacing, Radius } from '../constants/Colors';

const TEAL_DIM = 'rgba(0,191,165,0.12)';
const TEAL_BORDER = 'rgba(0,191,165,0.3)';

export default function EditProfileScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  // Form state
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [showPhone, setShowPhone] = useState(false);
  const [showReviews, setShowReviews] = useState(true);
  // Photo
  const [pictureUri, setPictureUri] = useState<string | undefined>(undefined);
  // Password change
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);

  // Data
  const [allTags, setAllTags] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [domains, setDomains] = useState<any[]>([]);

  // UI
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [becomeCoachLoading, setBecomeCoachLoading] = useState(false);
  const [activeDomainFilter, setActiveDomainFilter] = useState<string | null>(null);

  const isCoach = user?.role === 'coach';

  useEffect(() => { if (user) init(); }, [user]);

  const init = async () => {
    try {
      setName(user?.name || '');
      setBio(user?.bio || '');
      setPhone(user?.phone || '');
      setHourlyRate(user?.hourly_rate ? String(user.hourly_rate) : '');
      setSelectedTagIds(user?.coach_tags || []);
      setShowPhone(user?.show_phone ?? false);
      setShowReviews(user?.show_reviews ?? true);
      setPictureUri(user?.picture || undefined);

      const [tags, doms] = await Promise.all([
        api.get('/tags'),
        api.get('/domains'),
      ]);
      setAllTags(tags || []);
      setDomains(doms || []);

      if (isCoach) {
        const svcs = await api.get('/services/mine');
        setServices(svcs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const pickImage = async () => {    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "L'accès à la galerie est nécessaire pour changer votre photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.5,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      setPictureUri(`data:image/jpeg;base64,${result.assets[0].base64}`);
    }
  };

  const handleSave = async () => {    if (!name.trim()) { Alert.alert('Nom requis', 'Veuillez entrer votre nom.'); return; }
    setSaving(true);
    try {
      await api.put('/users/profile', {
        name: name.trim(),
        bio: bio.trim() || null,
        phone: phone.trim() || null,
        coach_tags: selectedTagIds,
        show_phone: showPhone,
        show_reviews: showReviews,
        ...(pictureUri !== user?.picture ? { picture: pictureUri || null } : {}),
        ...(isCoach && hourlyRate ? { hourly_rate: parseFloat(hourlyRate) } : {}),
      });
      await refreshUser();
      Alert.alert('Succès', 'Profil mis à jour !', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de sauvegarder.');
    } finally {
      setSaving(false);
    }
  };

  const handleBecomeCoach = () => {
    Alert.alert(
      'Devenir Coach',
      'En devenant coach, vous pourrez proposer des services et recevoir des réservations. Continuer ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer', onPress: async () => {
            setBecomeCoachLoading(true);
            try {
              await api.post('/users/become-coach', {});
              await refreshUser();
              Alert.alert('Félicitations !', 'Vous êtes maintenant Coach.');
            } catch (e: any) {
              Alert.alert('Erreur', e.message);
            } finally {
              setBecomeCoachLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleDeleteService = (svcId: string, title: string) => {    Alert.alert('Supprimer', `Supprimer le service "${title}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          try {
            await api.delete(`/services/${svcId}`);
            setServices(prev => prev.filter(s => s.service_id !== svcId));
          } catch (e: any) {
            Alert.alert('Erreur', e.message);
          }
        }
      }
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={st.safe}>
        <View style={st.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  const initial = name?.charAt(0)?.toUpperCase() || '?';
  const filteredTags = activeDomainFilter
    ? allTags.filter(t => t.domain_id === activeDomainFilter)
    : allTags;

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.headerBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Mon Profil</Text>
        <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving} testID="save-profile-btn">
          {saving ? <ActivityIndicator size="small" color={Colors.background} />
            : <Text style={st.saveBtnText}>Enregistrer</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={st.scroll} showsVerticalScrollIndicator={false}>

        {/* ── AVATAR (cliquable pour modifier la photo) ──────── */}
        <View style={st.avatarSection}>
          <TouchableOpacity onPress={pickImage} style={st.avatarRing} activeOpacity={0.8}
            testID="avatar-pick-btn">
            <View style={st.avatar}>
              {pictureUri
                ? <Image source={{ uri: pictureUri }} style={st.avatarImg} />
                : <Text style={st.avatarInitial}>{initial}</Text>}
            </View>
            <View style={st.cameraBadge}>
              <Ionicons name="camera" size={13} color={Colors.background} />
            </View>
          </TouchableOpacity>
          <Text style={st.avatarHint}>Appuyez pour modifier</Text>
          <View style={[st.rolePill, isCoach && st.rolePillCoach]}>
            <Ionicons name={isCoach ? 'trophy-outline' : 'person-outline'} size={12}
              color={isCoach ? Colors.primary : Colors.muted} />
            <Text style={[st.rolePillText, isCoach && { color: Colors.primary }]}>
              {isCoach ? 'Coach' : 'Membre'}
            </Text>
          </View>
        </View>

        {/* ── INFOS PERSONNELLES ──────────────────── */}
        <Section title="Informations personnelles" icon="person-outline">
          <Field label="Nom affiché" required>
            <TextInput style={st.input} value={name} onChangeText={setName}
              placeholder="Votre nom" placeholderTextColor={Colors.muted}
              autoCapitalize="words" testID="name-input" />
          </Field>
          <Field label="Bio">
            <TextInput style={[st.input, st.inputMulti]} value={bio} onChangeText={setBio}
              placeholder="Parlez de vous, vos sports favoris…" placeholderTextColor={Colors.muted}
              multiline numberOfLines={3} textAlignVertical="top" testID="bio-input" />
          </Field>
          <Field label="Téléphone">
            <TextInput style={st.input} value={phone} onChangeText={setPhone}
              placeholder="+33 6 00 00 00 00" placeholderTextColor={Colors.muted}
              keyboardType="phone-pad" testID="phone-input" />
          </Field>
        </Section>

        {/* ── CENTRES D'INTÉRÊT ──────────────────── */}
        <Section
          title={isCoach ? 'Spécialisations' : "Centres d'intérêt"}
          icon="heart-outline"
          subtitle={`${selectedTagIds.length} sélectionné${selectedTagIds.length > 1 ? 's' : ''}`}
        >
          {/* Filtres par domaine */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}
            contentContainerStyle={st.domainFilters}>
            <TouchableOpacity
              style={[st.domainChip, !activeDomainFilter && st.domainChipActive]}
              onPress={() => setActiveDomainFilter(null)}>
              <Text style={[st.domainChipText, !activeDomainFilter && st.domainChipTextActive]}>Tout</Text>
            </TouchableOpacity>
            {domains.map(d => (
              <TouchableOpacity key={d.domain_id}
                style={[st.domainChip, activeDomainFilter === d.domain_id && st.domainChipActive]}
                onPress={() => setActiveDomainFilter(
                  activeDomainFilter === d.domain_id ? null : d.domain_id
                )} testID={`domain-filter-${d.domain_id}`}>
                <Text style={[st.domainChipText, activeDomainFilter === d.domain_id && st.domainChipTextActive]}>
                  {d.label_fr || d.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Grille de tags */}
          <View style={st.tagsGrid}>
            {filteredTags.map(tag => {
              const active = selectedTagIds.includes(tag.tag_id);
              return (
                <TouchableOpacity key={tag.tag_id}
                  style={[st.tagChip, active && st.tagChipActive]}
                  onPress={() => toggleTag(tag.tag_id)}
                  testID={`tag-${tag.tag_id}`}>
                  {tag.icon && <Text style={st.tagIcon}>{tag.icon}</Text>}
                  <Text style={[st.tagChipText, active && st.tagChipTextActive]}>
                    {tag.label_fr || tag.name}
                  </Text>
                  {active && <Ionicons name="checkmark-circle" size={14} color={Colors.primary} />}
                </TouchableOpacity>
              );
            })}
            {filteredTags.length === 0 && (
              <Text style={{ color: Colors.muted, fontSize: 13, padding: 8 }}>
                Aucun tag disponible
              </Text>
            )}
          </View>
        </Section>

        {/* ── CONFIDENTIALITÉ ────────────────────── */}
        <Section title="Confidentialité" icon="shield-outline">
          <View style={st.switchRow} testID="privacy-section">
            <View style={{ flex: 1 }}>
              <Text style={st.switchLabel}>Afficher mon téléphone</Text>
              <Text style={st.switchDesc}>Visible sur votre profil public</Text>
            </View>
            <Switch
              value={showPhone}
              onValueChange={setShowPhone}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.background}
              testID="show-phone-toggle"
            />
          </View>
          <View style={[st.switchRow, { borderBottomWidth: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={st.switchLabel}>Autoriser les avis</Text>
              <Text style={st.switchDesc}>Les autres membres peuvent vous noter</Text>
            </View>
            <Switch
              value={showReviews}
              onValueChange={setShowReviews}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.background}
              testID="show-reviews-toggle"
            />
          </View>
        </Section>

        {/* ── SECTION COACH ──────────────────────── */}
        {isCoach && (
          <>
            <Section title="Paramètres Coach" icon="trophy-outline">
              <Field label="Taux horaire (€)">
                <TextInput style={st.input} value={hourlyRate} onChangeText={setHourlyRate}
                  placeholder="ex: 50" placeholderTextColor={Colors.muted}
                  keyboardType="numeric" testID="hourly-rate-input" />
              </Field>
            </Section>

            <Section title="Mes Services" icon="briefcase-outline"
              action={{ label: '+ Créer', onPress: () => router.push('/create-service' as any) }}>
              {services.length === 0 && (
                <TouchableOpacity style={st.emptyServices}
                  onPress={() => router.push('/create-service' as any)}>
                  <Ionicons name="add-circle-outline" size={28} color={Colors.primary} />
                  <Text style={st.emptyServicesText}>Proposer un service</Text>
                </TouchableOpacity>
              )}
              {services.map(svc => (
                <View key={svc.service_id} style={st.serviceRow} testID={`service-row-${svc.service_id}`}>
                  <View style={st.serviceIconBox}>
                    <Ionicons name="briefcase-outline" size={18} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.serviceTitle} numberOfLines={1}>{svc.title}</Text>
                    <Text style={st.serviceMeta}>{svc.price}€ · {svc.duration_min} min</Text>
                  </View>
                  <TouchableOpacity style={st.serviceDeleteBtn}
                    onPress={() => handleDeleteService(svc.service_id, svc.title)}
                    testID={`delete-service-${svc.service_id}`}>
                    <Ionicons name="trash-outline" size={18} color="#FF453A" />
                  </TouchableOpacity>
                </View>
              ))}
            </Section>
          </>
        )}

        {/* ── DEVENIR COACH ──────────────────────── */}
        {!isCoach && (
          <Section title="Coaching" icon="rocket-outline">
            <View style={st.coachCta}>
              <Ionicons name="trophy-outline" size={32} color={Colors.primary} />
              <Text style={st.coachCtaTitle}>Devenez Coach</Text>
              <Text style={st.coachCtaDesc}>
                Proposez vos services, créez des sessions et développez votre activité.
              </Text>
              <TouchableOpacity style={st.coachCtaBtn} onPress={handleBecomeCoach}
                disabled={becomeCoachLoading} testID="become-coach-btn">
                {becomeCoachLoading
                  ? <ActivityIndicator size="small" color={Colors.background} />
                  : <Text style={st.coachCtaBtnText}>Devenir Coach</Text>}
              </TouchableOpacity>
            </View>
          </Section>
        )}

        {/* ── COMPTE & SÉCURITÉ ─────────────────── */}
        <Section title="Compte & Sécurité" icon="lock-closed-outline">
          <Field label="Adresse e-mail">
            <View style={[st.input, st.inputReadOnly]}>
              <Text style={st.inputReadOnlyText}>{user?.email}</Text>
              <Ionicons name="lock-closed-outline" size={14} color={Colors.muted} />
            </View>
          </Field>
          <Text style={st.pwdSectionLabel}>Changer le mot de passe</Text>
          <Field label="Mot de passe actuel">
            <TextInput style={st.input} value={currentPwd} onChangeText={setCurrentPwd}
              placeholder="••••••••" placeholderTextColor={Colors.muted}
              secureTextEntry testID="current-pwd-input" />
          </Field>
          <Field label="Nouveau mot de passe">
            <TextInput style={st.input} value={newPwd} onChangeText={setNewPwd}
              placeholder="Min. 6 caractères" placeholderTextColor={Colors.muted}
              secureTextEntry testID="new-pwd-input" />
          </Field>
          <Field label="Confirmer le nouveau mot de passe">
            <TextInput style={st.input} value={confirmPwd} onChangeText={setConfirmPwd}
              placeholder="Répétez le nouveau mot de passe" placeholderTextColor={Colors.muted}
              secureTextEntry testID="confirm-pwd-input" />
          </Field>
          <TouchableOpacity style={[st.pwdSaveBtn, pwdSaving && { opacity: 0.6 }]}
            onPress={handleChangePassword} disabled={pwdSaving} testID="change-pwd-btn">
            {pwdSaving
              ? <ActivityIndicator size="small" color={Colors.background} />
              : <>
                  <Ionicons name="shield-checkmark-outline" size={15} color={Colors.background} />
                  <Text style={st.pwdSaveBtnText}>Mettre à jour le mot de passe</Text>
                </>
            }
          </TouchableOpacity>
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Composants internes ──────────────────────────────────────────────────────

function Section({ title, icon, subtitle, action, children }: {
  title: string; icon: string; subtitle?: string;
  action?: { label: string; onPress: () => void };
  children: React.ReactNode;
}) {
  return (
    <View style={st.section}>
      <View style={st.sectionHeader}>
        <View style={st.sectionTitleRow}>
          <View style={st.sectionIconBox}>
            <Ionicons name={icon as any} size={14} color={Colors.primary} />
          </View>
          <Text style={st.sectionTitle}>{title}</Text>
          {subtitle && <Text style={st.sectionSubtitle}>{subtitle}</Text>}
        </View>
        {action && (
          <TouchableOpacity onPress={action.onPress}>
            <Text style={st.sectionAction}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={st.sectionCard}>{children}</View>
    </View>
  );
}

function Field({ label, required, children }: {
  label: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={st.field}>
      <Text style={st.fieldLabel}>{label}{required ? ' *' : ''}</Text>
      {children}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 40 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: '#0D1F1F',
    borderBottomWidth: 1, borderBottomColor: TEAL_BORDER,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: Colors.foreground },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 16, paddingVertical: 7, minWidth: 40, alignItems: 'center',
  },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: Colors.background },

  // Avatar
  avatarSection: { alignItems: 'center', paddingVertical: 28, gap: 10 },
  avatarRing: {
    width: 92, height: 92, borderRadius: 46,
    borderWidth: 2.5, borderColor: Colors.primary, padding: 4,
  },
  avatar: {
    flex: 1, borderRadius: 42, backgroundColor: Colors.card,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 32, fontWeight: '800', color: Colors.primary },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.border,
  },
  rolePillCoach: { backgroundColor: TEAL_DIM, borderColor: TEAL_BORDER },
  rolePillText: { fontSize: 12, fontWeight: '700', color: Colors.muted },

  // Section
  section: { paddingHorizontal: Spacing.md, marginBottom: Spacing.xl },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionIconBox: {
    width: 26, height: 26, borderRadius: 8,
    backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: 12, fontWeight: '800', color: Colors.primary,
    textTransform: 'uppercase', letterSpacing: 1.2,
  },
  sectionSubtitle: { fontSize: 11, color: Colors.muted, marginLeft: 2 },
  sectionAction: { fontSize: 13, color: Colors.primary, fontWeight: '700' },
  sectionCard: {
    backgroundColor: Colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },

  // Field
  field: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  fieldLabel: { fontSize: 11, fontWeight: '700', color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 },
  input: {
    backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15, color: Colors.foreground,
  },
  inputMulti: { minHeight: 90, paddingTop: 12 },

  // Tags
  domainFilters: { gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },
  domainChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  domainChipActive: { backgroundColor: TEAL_DIM, borderColor: TEAL_BORDER },
  domainChipText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  domainChipTextActive: { color: Colors.primary },
  tagsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: Radius.full,
    backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border,
  },
  tagChipActive: { backgroundColor: TEAL_DIM, borderColor: TEAL_BORDER },
  tagIcon: { fontSize: 14 },
  tagChipText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  tagChipTextActive: { color: Colors.primary, fontWeight: '700' },

  // Switch rows (privacy)
  switchRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  switchLabel: { fontSize: 14, fontWeight: '600', color: Colors.foreground, marginBottom: 2 },
  switchDesc: { fontSize: 12, color: Colors.muted },

  // Services
  serviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  serviceIconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center',
  },
  serviceTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  serviceMeta: { fontSize: 12, color: Colors.primary, marginTop: 2 },
  serviceDeleteBtn: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,69,58,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyServices: {
    alignItems: 'center', gap: 8, paddingVertical: 28,
    margin: 16, borderRadius: 12,
    backgroundColor: TEAL_DIM, borderWidth: 1, borderColor: TEAL_BORDER, borderStyle: 'dashed',
  },
  emptyServicesText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  // Become coach CTA
  coachCta: {
    alignItems: 'center', padding: 24, gap: 10,
  },
  coachCtaTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  coachCtaDesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  coachCtaBtn: {
    marginTop: 6, backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 28, paddingVertical: 13,
  },
  coachCtaBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },
});
