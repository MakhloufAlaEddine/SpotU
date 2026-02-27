import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, Image, Alert, Switch,
  KeyboardAvoidingView, Platform,
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

// ── Local components ──────────────────────────────────────────────────────────
function Section({ title, icon, subtitle, action, children }: any) {
  return (
    <View style={st.sectionCard}>
      <View style={st.sectionHeader}>
        <View style={st.sectionHeaderLeft}>
          <View style={st.sectionIconBox}>
            <Ionicons name={icon} size={15} color={Colors.primary} />
          </View>
          <View>
            <Text style={st.sectionTitle}>{title}</Text>
            {subtitle && <Text style={st.sectionSubtitle}>{subtitle}</Text>}
          </View>
        </View>
        {action && (
          <TouchableOpacity onPress={action.onPress} style={st.sectionAction}>
            <Text style={st.sectionActionText}>{action.label}</Text>
          </TouchableOpacity>
        )}
      </View>
      <View style={st.sectionBody}>{children}</View>
    </View>
  );
}

function Field({ label, required, children }: any) {
  return (
    <View style={st.field}>
      <Text style={st.fieldLabel}>{label}{required && <Text style={{ color: Colors.primary }}> *</Text>}</Text>
      {children}
    </View>
  );
}

function SwitchRow({ label, desc, value, onValueChange, testID }: any) {
  return (
    <View style={st.switchRow}>
      <View style={{ flex: 1 }}>
        <Text style={st.switchLabel}>{label}</Text>
        {desc && <Text style={st.switchDesc}>{desc}</Text>}
      </View>
      <Switch value={value} onValueChange={onValueChange}
        trackColor={{ false: Colors.border, true: Colors.primary }}
        thumbColor={Colors.background} testID={testID} />
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function EditProfileScreen() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  // Profile fields
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');
  const [pictureUri, setPictureUri] = useState<string | undefined>(undefined);

  // Privacy
  const [showPhone, setShowPhone] = useState(false);
  const [showReviews, setShowReviews] = useState(true);

  // Banking
  const [iban, setIban] = useState('');
  const [bic, setBic] = useState('');
  const [ibanName, setIbanName] = useState('');

  // Password
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
  const initial = user?.name?.charAt(0)?.toUpperCase() || '?';

  useEffect(() => { if (user) init(); }, [user]);

  const init = async () => {
    try {
      // Fetch enriched profile (includes banking + review stats)
      const profileData = await api.get('/users/profile').catch(() => null);

      setName(user?.name || '');
      setBio(user?.bio || '');
      setPhone(user?.phone || '');
      setHourlyRate(user?.hourly_rate ? String(user.hourly_rate) : '');
      setSelectedTagIds(user?.coach_tags || []);
      setShowPhone(user?.show_phone ?? false);
      setShowReviews(user?.show_reviews ?? true);
      setPictureUri(user?.picture || undefined);

      if (profileData) {
        setIban(profileData.iban || '');
        setBic(profileData.bic || '');
        setIbanName(profileData.iban_name || '');
      }

      const [tags, doms] = await Promise.all([api.get('/tags'), api.get('/domains')]);
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

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission requise', "L'accès à la galerie est nécessaire.");
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

  const toggleTag = (id: string) => {
    setSelectedTagIds(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Requis', 'Le nom est obligatoire.'); return; }
    setSaving(true);
    try {
      await api.put('/users/profile', {
        name: name.trim(),
        bio: bio.trim() || null,
        phone: phone.trim() || null,
        coach_tags: selectedTagIds,
        show_phone: showPhone,
        show_reviews: showReviews,
        iban: iban.trim() || null,
        bic: bic.trim() || null,
        iban_name: ibanName.trim() || null,
        ...(pictureUri !== user?.picture ? { picture: pictureUri || null } : {}),
        ...(isCoach && hourlyRate ? { hourly_rate: parseFloat(hourlyRate) } : {}),
      });
      await refreshUser();
      Alert.alert('Succès', 'Profil mis à jour !');
      router.back();
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de sauvegarder.');
    } finally {
      setSaving(false);
    }
  };

  const handleBecomeCoach = async () => {
    setBecomeCoachLoading(true);
    try {
      await api.post('/users/become-coach', {});
      await refreshUser();
      Alert.alert('Félicitations !', 'Vous êtes maintenant Coach !');
    } catch (e: any) {
      Alert.alert('Erreur', e.message);
    } finally {
      setBecomeCoachLoading(false);
    }
  };

  const handleDeleteService = (svcId: string, title: string) => {
    Alert.alert('Supprimer', `Supprimer le service "${title}" ?`, [
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

  const handleChangePassword = async () => {
    if (!currentPwd || !newPwd || !confirmPwd) {
      Alert.alert('Champs requis', 'Remplissez les trois champs.');
      return;
    }
    if (newPwd !== confirmPwd) {
      Alert.alert('Erreur', 'Les mots de passe ne correspondent pas.');
      return;
    }
    if (newPwd.length < 6) {
      Alert.alert('Erreur', 'Minimum 6 caractères requis.');
      return;
    }
    setPwdSaving(true);
    try {
      await api.put('/auth/change-password', { current_password: currentPwd, new_password: newPwd });
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      Alert.alert('Succès', 'Mot de passe mis à jour !');
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Mot de passe actuel incorrect.');
    } finally {
      setPwdSaving(false);
    }
  };

  const filteredTags = activeDomainFilter
    ? allTags.filter(t => t.domain_id === activeDomainFilter)
    : allTags;

  if (loading) {
    return (
      <View style={[st.safe, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={st.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={st.header}>
        <TouchableOpacity style={st.headerBtn} onPress={() => router.back()} testID="back-btn">
          <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
        </TouchableOpacity>
        <Text style={st.headerTitle}>Mon Profil</Text>
        <TouchableOpacity style={st.saveBtn} onPress={handleSave} disabled={saving} testID="save-profile-btn">
          {saving
            ? <ActivityIndicator size="small" color={Colors.background} />
            : <Text style={st.saveBtnText}>Enregistrer</Text>
          }
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <ScrollView
          contentContainerStyle={st.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── 1. AVATAR ─────────────────────────── */}
          <View style={st.avatarSection}>
            <TouchableOpacity onPress={pickImage} style={st.avatarRing}
              activeOpacity={0.8} testID="avatar-pick-btn">
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

          {/* ── 2. INFORMATIONS PERSONNELLES ────────── */}
          <Section title="Informations personnelles" icon="person-outline">
            <Field label="Nom affiché" required>
              <TextInput style={st.input} value={name} onChangeText={setName}
                placeholder="Votre nom" placeholderTextColor={Colors.muted}
                autoCapitalize="words" returnKeyType="next" testID="name-input" />
            </Field>
            <Field label="Bio">
              <TextInput style={[st.input, st.inputMulti]} value={bio} onChangeText={setBio}
                placeholder="Parlez de vous, vos sports favoris…" placeholderTextColor={Colors.muted}
                multiline numberOfLines={3} textAlignVertical="top" testID="bio-input" />
            </Field>
            <Field label="Téléphone">
              <TextInput style={st.input} value={phone} onChangeText={setPhone}
                placeholder="+33 6 00 00 00 00" placeholderTextColor={Colors.muted}
                keyboardType="phone-pad" returnKeyType="done" testID="phone-input" />
            </Field>
          </Section>

          {/* ── 3. CONFIDENTIALITÉ ──────────────────── */}
          <Section title="Confidentialité" icon="shield-outline">
            <SwitchRow
              label="Afficher mon téléphone"
              desc="Visible sur votre profil public"
              value={showPhone}
              onValueChange={setShowPhone}
              testID="show-phone-toggle"
            />
            <SwitchRow
              label="Autoriser les avis"
              desc="Les autres membres peuvent vous noter"
              value={showReviews}
              onValueChange={setShowReviews}
              testID="show-reviews-toggle"
            />
          </Section>

          {/* ── 4. CENTRES D'INTÉRÊT ────────────────── */}
          <Section
            title={isCoach ? 'Spécialisations' : "Centres d'intérêt"}
            icon="heart-outline"
            subtitle={`${selectedTagIds.length} sélectionné${selectedTagIds.length > 1 ? 's' : ''}`}
          >
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={st.domainFilters} keyboardShouldPersistTaps="handled">
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
                <Text style={{ color: Colors.muted, fontSize: 13, padding: 8 }}>Aucun tag disponible</Text>
              )}
            </View>
          </Section>

          {/* ── 5. COACH ────────────────────────────── */}
          {isCoach ? (
            <>
              <Section title="Paramètres Coach" icon="trophy-outline">
                <Field label="Taux horaire (€)">
                  <TextInput style={st.input} value={hourlyRate} onChangeText={setHourlyRate}
                    placeholder="ex: 50" placeholderTextColor={Colors.muted}
                    keyboardType="numeric" returnKeyType="done" testID="hourly-rate-input" />
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
          ) : (
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

          {/* ── 6. COORDONNÉES BANCAIRES ────────────── */}
          <Section title="Coordonnées bancaires" icon="card-outline">
            <View style={st.bankInfoBanner}>
              <Ionicons name="lock-closed-outline" size={13} color={Colors.primary} />
              <Text style={st.bankInfoText}>
                Ces informations sont utilisées uniquement pour vous verser vos paiements. Elles ne sont pas visibles publiquement.
              </Text>
            </View>
            <Field label="Titulaire du compte">
              <TextInput
                style={st.input}
                value={ibanName}
                onChangeText={setIbanName}
                placeholder="Prénom Nom"
                placeholderTextColor={Colors.muted}
                autoCapitalize="words"
                returnKeyType="next"
                testID="iban-name-input"
              />
            </Field>
            <Field label="IBAN">
              <TextInput
                style={st.input}
                value={iban}
                onChangeText={v => setIban(v.toUpperCase().replace(/\s/g, ''))}
                placeholder="FR76 0000 0000 0000 0000 0000 000"
                placeholderTextColor={Colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="next"
                testID="iban-input"
              />
            </Field>
            <Field label="BIC / SWIFT">
              <TextInput
                style={st.input}
                value={bic}
                onChangeText={v => setBic(v.toUpperCase().replace(/\s/g, ''))}
                placeholder="ex: BNPAFRPP"
                placeholderTextColor={Colors.muted}
                autoCapitalize="characters"
                autoCorrect={false}
                returnKeyType="done"
                testID="bic-input"
              />
            </Field>
          </Section>

          {/* ── 7. COMPTE & SÉCURITÉ ────────────────── */}
          <Section title="Compte & Sécurité" icon="lock-closed-outline">
            <Field label="Adresse e-mail">
              <View style={[st.input, st.inputReadOnly]}>
                <Text style={st.inputReadOnlyText}>{user?.email}</Text>
                <Ionicons name="lock-closed-outline" size={14} color={Colors.muted} />
              </View>
            </Field>

            <View style={st.pwdDivider}>
              <View style={st.pwdDividerLine} />
              <Text style={st.pwdDividerText}>Changer le mot de passe</Text>
              <View style={st.pwdDividerLine} />
            </View>

            <Field label="Mot de passe actuel">
              <TextInput style={st.input} value={currentPwd} onChangeText={setCurrentPwd}
                placeholder="••••••••" placeholderTextColor={Colors.muted}
                secureTextEntry returnKeyType="next" testID="current-pwd-input" />
            </Field>
            <Field label="Nouveau mot de passe">
              <TextInput style={st.input} value={newPwd} onChangeText={setNewPwd}
                placeholder="Min. 6 caractères" placeholderTextColor={Colors.muted}
                secureTextEntry returnKeyType="next" testID="new-pwd-input" />
            </Field>
            <Field label="Confirmer le nouveau mot de passe">
              <TextInput style={st.input} value={confirmPwd} onChangeText={setConfirmPwd}
                placeholder="Répétez le nouveau mot de passe" placeholderTextColor={Colors.muted}
                secureTextEntry returnKeyType="done" onSubmitEditing={handleChangePassword}
                testID="confirm-pwd-input" />
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

          <View style={{ height: 60 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.foreground },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 16, paddingVertical: 8, minWidth: 90, alignItems: 'center',
  },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: Colors.background },
  scroll: { paddingVertical: Spacing.md, gap: 12 },

  // Avatar
  avatarSection: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  avatarRing: {
    width: 92, height: 92, borderRadius: 46,
    borderWidth: 2.5, borderColor: Colors.primary, padding: 4, position: 'relative',
  },
  avatar: {
    flex: 1, borderRadius: 42, backgroundColor: Colors.card,
    overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 32, fontWeight: '800', color: Colors.primary },
  cameraBadge: {
    position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: 13,
    backgroundColor: Colors.primary, borderWidth: 2, borderColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarHint: { fontSize: 11, color: Colors.muted },
  rolePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: Colors.card, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.border,
  },
  rolePillCoach: { backgroundColor: TEAL_DIM, borderColor: TEAL_BORDER },
  rolePillText: { fontSize: 12, fontWeight: '700', color: Colors.muted },

  // Section card
  sectionCard: {
    marginHorizontal: Spacing.md, backgroundColor: Colors.card,
    borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionIconBox: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center',
  },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: Colors.foreground },
  sectionSubtitle: { fontSize: 11, color: Colors.primary, marginTop: 1 },
  sectionAction: {
    backgroundColor: TEAL_DIM, borderRadius: Radius.full,
    paddingHorizontal: 12, paddingVertical: 5,
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  sectionActionText: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  sectionBody: { paddingVertical: 4 },

  // Fields
  field: { paddingHorizontal: 16, paddingVertical: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: Colors.background, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, color: Colors.foreground,
  },
  inputMulti: { minHeight: 80 },
  inputReadOnly: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: 0.7 },
  inputReadOnlyText: { fontSize: 14, color: Colors.muted, flex: 1 },

  // Switch
  switchRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  switchLabel: { fontSize: 14, fontWeight: '600', color: Colors.foreground, marginBottom: 2 },
  switchDesc: { fontSize: 12, color: Colors.muted },

  // Tags
  domainFilters: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  domainChip: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  domainChipActive: { backgroundColor: TEAL_DIM, borderColor: TEAL_BORDER },
  domainChipText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  domainChipTextActive: { color: Colors.primary },
  tagsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  tagChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  tagChipActive: { backgroundColor: TEAL_DIM, borderColor: TEAL_BORDER },
  tagIcon: { fontSize: 14 },
  tagChipText: { fontSize: 12, fontWeight: '600', color: Colors.muted },
  tagChipTextActive: { color: Colors.primary },

  // Coach
  emptyServices: { alignItems: 'center', paddingVertical: 20, gap: 8 },
  emptyServicesText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  serviceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  serviceIconBox: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: TEAL_DIM, alignItems: 'center', justifyContent: 'center',
  },
  serviceTitle: { fontSize: 14, fontWeight: '700', color: Colors.foreground },
  serviceMeta: { fontSize: 12, color: Colors.muted, marginTop: 2 },
  serviceDeleteBtn: { padding: 6 },
  coachCta: { alignItems: 'center', padding: 24, gap: 10 },
  coachCtaTitle: { fontSize: 18, fontWeight: '800', color: Colors.foreground },
  coachCtaDesc: { fontSize: 13, color: Colors.muted, textAlign: 'center', lineHeight: 19 },
  coachCtaBtn: {
    marginTop: 6, backgroundColor: Colors.primary, borderRadius: Radius.full,
    paddingHorizontal: 28, paddingVertical: 13,
  },
  coachCtaBtnText: { fontSize: 15, fontWeight: '700', color: Colors.background },

  // Banking
  bankInfoBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    margin: 16, marginBottom: 4, padding: 12,
    backgroundColor: TEAL_DIM, borderRadius: 10,
    borderWidth: 1, borderColor: TEAL_BORDER,
  },
  bankInfoText: { fontSize: 12, color: Colors.primary, flex: 1, lineHeight: 17 },

  // Password
  pwdDivider: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
  },
  pwdDividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  pwdDividerText: { fontSize: 11, color: Colors.muted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4 },
  pwdSaveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    margin: 16, marginTop: 8, backgroundColor: Colors.primary,
    borderRadius: Radius.full, paddingVertical: 12,
  },
  pwdSaveBtnText: { fontSize: 14, fontWeight: '700', color: Colors.background },
});
