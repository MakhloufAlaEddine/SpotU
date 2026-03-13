import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert, Pressable, Image,
  TextInput, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { api } from '../../lib/api';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

const { width } = Dimensions.get('window');
const TOTAL_STEPS = 6;

/* ─── Shared animated input ────────────────────────────────── */
function FloatingInput({ label, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, testID, icon }: any) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const active = focused || value.length > 0;
  return (
    <View style={[fi.wrap, focused && fi.wrapFocused]}>
      <View style={fi.iconWrap}>
        <Ionicons name={icon} size={18} color={focused ? Colors.primary : '#5A6B6B'} />
      </View>
      <View style={fi.inputArea}>
        <Text style={[fi.label, active && fi.labelActive]}>{label}</Text>
        <TextInput
          testID={testID} style={fi.input} value={value}
          onChangeText={onChangeText} secureTextEntry={hidden}
          keyboardType={keyboardType ?? 'default'} autoCapitalize={autoCapitalize ?? 'sentences'}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          placeholderTextColor="transparent"
        />
      </View>
      {secureTextEntry && (
        <TouchableOpacity onPress={() => setHidden(!hidden)} style={fi.eye}>
          <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color="#5A6B6B" />
        </TouchableOpacity>
      )}
    </View>
  );
}
const fi = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A2020', borderRadius: 16, borderWidth: 1.5, borderColor: '#1A3A3A', paddingHorizontal: 14, paddingVertical: 4, marginBottom: 14 },
  wrapFocused: { borderColor: Colors.primary + '80' },
  iconWrap: { width: 28, alignItems: 'center', marginRight: 10 },
  inputArea: { flex: 1, paddingVertical: 6 },
  label: { fontSize: 11, fontWeight: '500', color: '#5A6B6B', marginBottom: 0 },
  labelActive: { color: Colors.primary, fontSize: 10 },
  input: { fontSize: 15, color: Colors.foreground, paddingVertical: 2, height: 24 },
  eye: { padding: 6 },
});

/* ─── Chip select (multi or single) ───────────────────────── */
function ChipGrid({ items, selected, onToggle, multi = true, columns = 2 }: {
  items: { id: string; label: string; icon?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  multi?: boolean;
  columns?: number;
}) {
  return (
    <View style={cg.grid}>
      {items.map(item => {
        const active = selected.includes(item.id);
        return (
          <TouchableOpacity
            key={item.id}
            style={[cg.chip, active && cg.chipActive, { width: `${Math.floor(100 / columns) - 3}%` as any }]}
            onPress={() => onToggle(item.id)}
            activeOpacity={0.75}
            testID={`chip-${item.id}`}
          >
            {item.icon && <Text style={cg.chipIcon}>{item.icon}</Text>}
            <Text style={[cg.chipLabel, active && cg.chipLabelActive]} numberOfLines={1}>{item.label}</Text>
            {active && <Ionicons name="checkmark-circle" size={16} color={Colors.primary} style={{ marginLeft: 'auto' }} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
const cg = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0A2020', borderRadius: 14, borderWidth: 1.5, borderColor: '#1A3A3A', paddingVertical: 13, paddingHorizontal: 14 },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '12' },
  chipIcon: { fontSize: 18 },
  chipLabel: { fontSize: 14, fontWeight: '600', color: '#8A9A9A' },
  chipLabelActive: { color: Colors.foreground },
});

/* ─── Progress bar ─────────────────────────────────────────── */
function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={pb.wrap}>
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[pb.dot, i < step && pb.dotActive, i === step - 1 && pb.dotCurrent]} />
      ))}
    </View>
  );
}
const pb = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 6, justifyContent: 'center', paddingVertical: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1A3A3A' },
  dotActive: { backgroundColor: Colors.primary },
  dotCurrent: { width: 24, borderRadius: 4 },
});

/* ─── MAIN SCREEN ──────────────────────────────────────────── */
export default function RegisterScreen() {
  const router = useGuardedRouter();
  const { register, loginWithGoogle } = useAuth();
  const { t, lang } = useLang();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Step 1: Account
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // Step 2: Role
  const [roles, setRoles] = useState<string[]>([]);

  // Step 3: Sports
  const [sports, setSports] = useState<string[]>([]);

  // Step 4: Level
  const [level, setLevel] = useState<string[]>([]);

  // Step 5: Goals
  const [goals, setGoals] = useState<string[]>([]);

  // Step 6: Location
  const [locating, setLocating] = useState(false);
  const [city, setCity] = useState('');

  // Animation helper
  const animateSlide = (direction: 'next' | 'back') => {
    const startVal = direction === 'next' ? width * 0.3 : -width * 0.3;
    slideAnim.setValue(startVal);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };

  const goNext = () => {
    if (step < TOTAL_STEPS) {
      setStep(s => s + 1);
      animateSlide('next');
    }
  };

  const goBack = () => {
    if (step > 1) {
      setStep(s => s - 1);
      animateSlide('back');
    } else {
      router.push('/(auth)/login');
    }
  };

  const toggleItem = (list: string[], setList: (v: string[]) => void, id: string, multi = true) => {
    if (multi) {
      setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    } else {
      setList(list.includes(id) ? [] : [id]);
    }
  };

  /* ─── Step 1: Create account ─── */
  const handleCreateAccount = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert('', 'Veuillez remplir tous les champs');
      return;
    }
    if (password.length < 6) {
      Alert.alert('', 'Le mot de passe doit comporter au moins 6 caractères');
      return;
    }
    setLoading(true);
    try {
      await register(email.trim(), password, name.trim(), lang);
      goNext();
    } catch (err: any) {
      Alert.alert(t('error'), err.message || "Erreur lors de l'inscription");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignup = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
      if (Platform.OS !== 'web') {
        goNext();
      }
    } catch (err: any) {
      Alert.alert(t('error'), 'Connexion Google annulée');
    } finally {
      setLoading(false);
    }
  };

  /* ─── Step 6: Location ─── */
  const handleAutoLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('', "L'accès à la localisation a été refusé");
        setLocating(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({});
      const [addr] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (addr) {
        setCity(addr.city || addr.subregion || addr.region || '');
      }
    } catch {
      Alert.alert('', 'Impossible de déterminer votre position');
    } finally {
      setLocating(false);
    }
  };

  /* ─── Final: Save all onboarding data ─── */
  const handleFinish = async () => {
    setLoading(true);
    try {
      const payload: any = { onboarding_done: true };
      if (roles.length) payload.user_roles = roles;
      if (sports.length) payload.coach_tags = sports;
      if (level.length) payload.sports_level = level[0];
      if (goals.length) payload.goals = goals;
      await api.put('/users/profile', payload);

      // If user chose coach role, become coach
      if (roles.includes('coach')) {
        try { await api.post('/become-coach', {}); } catch {}
      }
      router.replace('/(tabs)/map');
    } catch (err: any) {
      // Silently continue even if save fails
      router.replace('/(tabs)/map');
    } finally {
      setLoading(false);
    }
  };

  /* ─── Skip to home ─── */
  const handleSkipAll = () => {
    api.put('/users/profile', { onboarding_done: true }).catch(() => {});
    router.replace('/(tabs)/map');
  };

  /* ─── ROLE options ─── */
  const ROLE_OPTIONS = [
    { id: 'athlete', label: 'Je veux faire du sport', icon: '\u26BD' },
    { id: 'coach', label: "Je suis coach / j'organise", icon: '\uD83C\uDFC5' },
  ];

  /* ─── SPORTS options ─── */
  const SPORT_OPTIONS = [
    { id: 'tag_running', label: 'Running', icon: '\uD83C\uDFC3' },
    { id: 'tag_musculation', label: 'Musculation', icon: '\uD83D\uDCAA' },
    { id: 'tag_crossfit', label: 'CrossFit', icon: '\uD83E\uDD38' },
    { id: 'tag_yoga', label: 'Yoga', icon: '\uD83E\uDDD8' },
    { id: 'tag_boxe', label: 'Boxe', icon: '\uD83E\uDD4A' },
    { id: 'tag_cardio', label: 'Cardio', icon: '\u2764\uFE0F' },
    { id: 'tag_hiit', label: 'HIIT', icon: '\uD83D\uDD25' },
    { id: 'tag_velo', label: 'Cyclisme', icon: '\uD83D\uDEB4' },
    { id: 'tag_football', label: 'Football', icon: '\u26BD' },
    { id: 'tag_basket', label: 'Basket', icon: '\uD83C\uDFC0' },
    { id: 'tag_tennis', label: 'Tennis', icon: '\uD83C\uDFBE' },
    { id: 'tag_natation', label: 'Natation', icon: '\uD83C\uDFCA' },
  ];

  /* ─── LEVEL options ─── */
  const LEVEL_OPTIONS = [
    { id: 'beginner', label: 'Debutant', icon: '\uD83C\uDF31' },
    { id: 'intermediate', label: 'Intermediaire', icon: '\uD83D\uDCAA' },
    { id: 'advanced', label: 'Confirme', icon: '\uD83D\uDD25' },
    { id: 'athlete', label: 'Athlete', icon: '\uD83C\uDFC6' },
    { id: 'coach', label: 'Coach', icon: '\uD83C\uDFC5' },
  ];

  /* ─── GOAL options ─── */
  const GOAL_OPTIONS = [
    { id: 'restart', label: 'Se remettre au sport', icon: '\uD83D\uDE80' },
    { id: 'find_partners', label: 'Trouver des partenaires', icon: '\uD83E\uDD1D' },
    { id: 'improve', label: 'Progresser', icon: '\uD83D\uDCC8' },
    { id: 'with_coach', label: "S'entrainer avec un coach", icon: '\uD83C\uDFC5' },
    { id: 'meet_people', label: 'Rencontrer des gens', icon: '\uD83D\uDE04' },
  ];

  /* ─── Render steps ─── */
  const renderStep = () => {
    switch (step) {
      case 1: return (
        <View>
          <Text style={s.stepTitle}>{"Cree ton compte"}</Text>
          <Text style={s.stepDesc}>{"Rejoins la communaute SpotU"}</Text>
          <View style={{ marginTop: 20 }}>
            <FloatingInput label="Prenom et nom" value={name} onChangeText={setName} autoCapitalize="words" testID="name-input" icon="person-outline" />
            <FloatingInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="email-input" icon="mail-outline" />
            <FloatingInput label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry testID="password-input" icon="lock-closed-outline" />
          </View>
          <TouchableOpacity style={s.primaryBtn} onPress={handleCreateAccount} disabled={loading} activeOpacity={0.85} testID="register-btn">
            {loading ? <ActivityIndicator color="#000" size="small" /> : (
              <><Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} /></>
            )}
          </TouchableOpacity>
          <View style={s.divider}><View style={s.dividerLine} /><Text style={s.dividerText}>{"Ou continuer avec"}</Text><View style={s.dividerLine} /></View>
          <TouchableOpacity style={s.googleBtn} onPress={handleGoogleSignup} activeOpacity={0.8} testID="google-register-btn">
            <View style={s.googleIconWrap}><Ionicons name="logo-google" size={18} color="#fff" /></View>
            <Text style={s.googleText}>{"Continuer avec Google"}</Text>
          </TouchableOpacity>
          <View style={s.footer}>
            <Text style={s.footerText}>{"Deja un compte ? "}</Text>
            <Pressable onPress={() => router.push('/(auth)/login')} testID="go-login">
              <Text style={s.footerLink}>{"Se connecter"}</Text>
            </Pressable>
          </View>
        </View>
      );

      case 2: return (
        <View>
          <Text style={s.stepTitle}>{"Tu es plutot :"}</Text>
          <Text style={s.stepDesc}>{"Tu peux choisir les deux !"}</Text>
          <View style={{ marginTop: 24 }}>
            <ChipGrid items={ROLE_OPTIONS} selected={roles} onToggle={(id) => toggleItem(roles, setRoles, id)} columns={1} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 28 }]} onPress={goNext} disabled={roles.length === 0} activeOpacity={0.85} testID="step2-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );

      case 3: return (
        <View>
          <Text style={s.stepTitle}>{"Quels sports t'interessent ?"}</Text>
          <Text style={s.stepDesc}>{"Selectionne tout ce qui te plait"}</Text>
          <View style={{ marginTop: 20 }}>
            <ChipGrid items={SPORT_OPTIONS} selected={sports} onToggle={(id) => toggleItem(sports, setSports, id)} columns={2} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 24 }]} onPress={goNext} disabled={sports.length === 0} activeOpacity={0.85} testID="step3-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );

      case 4: return (
        <View>
          <Text style={s.stepTitle}>{"Ton niveau ?"}</Text>
          <Text style={s.stepDesc}>{"Pas de jugement, juste pour mieux te guider"}</Text>
          <View style={{ marginTop: 24 }}>
            <ChipGrid items={LEVEL_OPTIONS} selected={level} onToggle={(id) => toggleItem(level, setLevel, id, false)} columns={1} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 28 }]} onPress={goNext} disabled={level.length === 0} activeOpacity={0.85} testID="step4-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );

      case 5: return (
        <View>
          <Text style={s.stepTitle}>{"Pourquoi SpotU ?"}</Text>
          <Text style={s.stepDesc}>{"Ca nous aide a personnaliser ton experience"}</Text>
          <View style={{ marginTop: 20 }}>
            <ChipGrid items={GOAL_OPTIONS} selected={goals} onToggle={(id) => toggleItem(goals, setGoals, id)} columns={1} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 24 }]} onPress={goNext} disabled={goals.length === 0} activeOpacity={0.85} testID="step5-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );

      case 6: return (
        <View>
          <Text style={s.stepTitle}>{"Ou fais-tu du sport ?"}</Text>
          <Text style={s.stepDesc}>{"Pour te montrer ce qui se passe autour de toi"}</Text>
          <View style={{ marginTop: 24, gap: 12 }}>
            <TouchableOpacity style={s.locationBtn} onPress={handleAutoLocation} disabled={locating} activeOpacity={0.8} testID="auto-location-btn">
              {locating ? <ActivityIndicator color={Colors.primary} size="small" /> : <Ionicons name="navigate" size={20} color={Colors.primary} />}
              <Text style={s.locationBtnText}>{"Utiliser ma position"}</Text>
            </TouchableOpacity>

            <View style={s.orRow}><View style={s.orLine} /><Text style={s.orText}>OU</Text><View style={s.orLine} /></View>

            <FloatingInput label="Ta ville" value={city} onChangeText={setCity} autoCapitalize="words" testID="city-input" icon="location-outline" />
          </View>

          {city.length > 0 && (
            <View style={s.cityPreview}>
              <Ionicons name="location" size={16} color={Colors.primary} />
              <Text style={s.cityPreviewText}>{city}</Text>
            </View>
          )}

          <TouchableOpacity style={[s.primaryBtn, { marginTop: 20 }]} onPress={handleFinish} disabled={loading} activeOpacity={0.85} testID="finish-btn">
            {loading ? <ActivityIndicator color="#000" size="small" /> : (
              <>
                <Text style={s.primaryBtnText}>{"C'est parti !"}</Text>
                <Ionicons name="rocket" size={18} color="#000" style={{ marginLeft: 6 }} />
              </>
            )}
          </TouchableOpacity>
        </View>
      );

      default: return null;
    }
  };

  return (
    <View style={s.root}>
      <View style={s.gradientTop} />
      <SafeAreaView style={s.safe}>
        {/* Header: back + progress + skip */}
        <View style={s.header}>
          <TouchableOpacity onPress={goBack} style={s.backBtn} testID="onboarding-back">
            <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
          </TouchableOpacity>
          {step > 1 && <ProgressBar step={step - 1} total={TOTAL_STEPS - 1} />}
          {step > 1 && (
            <TouchableOpacity onPress={handleSkipAll} testID="skip-btn">
              <Text style={s.skipText}>{"Passer"}</Text>
            </TouchableOpacity>
          )}
          {step === 1 && <View style={{ width: 50 }} />}
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {step === 1 && (
              <View style={s.logoWrap}>
                <Image source={require('../../assets/icon.png')} style={s.logo} resizeMode="contain" />
              </View>
            )}
            <Animated.View style={[s.card, { transform: [{ translateX: slideAnim }] }]}>
              {renderStep()}
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#061818' },
  gradientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '35%', backgroundColor: '#0D3B3B', borderBottomLeftRadius: 40, borderBottomRightRadius: 40 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#0A2020', alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, color: '#5A8A8A', fontWeight: '600' },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingBottom: 40 },

  logoWrap: { alignItems: 'center', marginVertical: 16 },
  logo: { width: 70, height: 70 },

  card: { backgroundColor: '#0E2626', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#1A3A3A' },
  stepTitle: { fontSize: 22, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  stepDesc: { fontSize: 13, color: '#5A8A8A', fontWeight: '500', marginTop: 4 },

  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#000', letterSpacing: 0.3 },

  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1A3A3A' },
  dividerText: { fontSize: 12, color: '#5A6B6B', fontWeight: '500' },

  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#0A1E1E', borderWidth: 1.5, borderColor: '#1A3A3A', borderRadius: 14, paddingVertical: 14 },
  googleIconWrap: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#1A3A3A', alignItems: 'center', justifyContent: 'center' },
  googleText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },

  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  footerText: { fontSize: 14, color: '#5A6B6B' },
  footerLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },

  locationBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.primary + '10', borderWidth: 1.5, borderColor: Colors.primary + '40', borderRadius: 14, paddingVertical: 16 },
  locationBtnText: { fontSize: 15, fontWeight: '700', color: Colors.primary },

  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: '#1A3A3A' },
  orText: { fontSize: 11, color: '#5A6B6B', fontWeight: '600' },

  cityPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '10', borderRadius: 10, padding: 10, marginTop: 8 },
  cityPreviewText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
});
