import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert, Animated, Dimensions,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../constants/Colors';
import { useGuardedRouter } from '../hooks/useGuardedRouter';

const { width } = Dimensions.get('window');
const TOTAL_STEPS = 5;

/* ─── Chip Grid ──────────────────────────────────────────── */
function ChipGrid({ items, selected, onToggle, columns = 2 }: {
  items: { id: string; label: string; icon?: string }[];
  selected: string[]; onToggle: (id: string) => void; columns?: number;
}) {
  return (
    <View style={cg.grid}>
      {items.map(item => {
        const active = selected.includes(item.id);
        return (
          <TouchableOpacity
            key={item.id}
            style={[cg.chip, active && cg.chipActive, { width: `${Math.floor(100 / columns) - 3}%` as any }]}
            onPress={() => onToggle(item.id)} activeOpacity={0.75} testID={`chip-${item.id}`}
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

/* ─── Progress dots ──────────────────────────────────────── */
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

/* ─── Floating Input ─────────────────────────────────────── */
function FloatingInput({ label, value, onChangeText, testID, icon }: any) {
  const [focused, setFocused] = useState(false);
  const active = focused || value.length > 0;
  return (
    <View style={[fi.wrap, focused && fi.wrapFocused]}>
      <View style={fi.iconWrap}><Ionicons name={icon} size={18} color={focused ? Colors.primary : '#5A6B6B'} /></View>
      <View style={fi.inputArea}>
        <Text style={[fi.label, active && fi.labelActive]}>{label}</Text>
        <TextInput testID={testID} style={fi.input} value={value} onChangeText={onChangeText}
          autoCapitalize="words" onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholderTextColor="transparent" />
      </View>
    </View>
  );
}
const fi = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0A2020', borderRadius: 16, borderWidth: 1.5, borderColor: '#1A3A3A', paddingHorizontal: 14, paddingVertical: 4, marginBottom: 14 },
  wrapFocused: { borderColor: Colors.primary + '80' },
  iconWrap: { width: 28, alignItems: 'center', marginRight: 10 },
  inputArea: { flex: 1, paddingVertical: 6 },
  label: { fontSize: 11, fontWeight: '500', color: '#5A6B6B' },
  labelActive: { color: Colors.primary, fontSize: 10 },
  input: { fontSize: 15, color: Colors.foreground, paddingVertical: 2, height: 24 },
});

/* ─── DATA ───────────────────────────────────────────────── */
const ROLE_OPTIONS = [
  { id: 'athlete', label: 'Je veux faire du sport', icon: '\u26BD' },
  { id: 'coach', label: "Je suis coach / j'organise", icon: '\uD83C\uDFC5' },
];
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
const LEVEL_OPTIONS = [
  { id: 'beginner', label: 'Debutant', icon: '\uD83C\uDF31' },
  { id: 'intermediate', label: 'Intermediaire', icon: '\uD83D\uDCAA' },
  { id: 'advanced', label: 'Confirme', icon: '\uD83D\uDD25' },
  { id: 'athlete', label: 'Athlete', icon: '\uD83C\uDFC6' },
  { id: 'coach', label: 'Coach', icon: '\uD83C\uDFC5' },
];
const GOAL_OPTIONS = [
  { id: 'restart', label: 'Se remettre au sport', icon: '\uD83D\uDE80' },
  { id: 'find_partners', label: 'Trouver des partenaires', icon: '\uD83E\uDD1D' },
  { id: 'improve', label: 'Progresser', icon: '\uD83D\uDCC8' },
  { id: 'with_coach', label: "S'entrainer avec un coach", icon: '\uD83C\uDFC5' },
  { id: 'meet_people', label: 'Rencontrer des gens', icon: '\uD83D\uDE04' },
];

const HERO_COPY: Record<number, { eyebrow: string; title: string; body: string; badges: { icon: keyof typeof Ionicons.glyphMap; label: string }[] }> = {
  1: {
    eyebrow: 'Bienvenue sur SpotU',
    title: 'On personnalise votre départ en moins d’une minute.',
    body: 'Choisissez votre posture pour ouvrir directement la bonne expérience au démarrage.',
    badges: [
      { icon: 'sparkles-outline', label: 'Accueil personnalisé' },
      { icon: 'navigate-outline', label: 'Découverte locale' },
      { icon: 'people-outline', label: 'Communauté & coachs' },
    ],
  },
  2: {
    eyebrow: 'Affinités sportives',
    title: 'Votre feed dépend de ce que vous aimez vraiment.',
    body: 'Plus vos intérêts sont précis, plus la carte, les suggestions et les SpotYou seront utiles.',
    badges: [
      { icon: 'fitness-outline', label: 'Sports favoris' },
      { icon: 'map-outline', label: 'Map filtrée' },
      { icon: 'flash-outline', label: 'Suggestions plus justes' },
    ],
  },
  3: {
    eyebrow: 'Niveau & rythme',
    title: 'On adapte l’expérience à votre intensité.',
    body: 'Cela aide à afficher des activités cohérentes et des recommandations plus crédibles.',
    badges: [
      { icon: 'barbell-outline', label: 'Niveau cohérent' },
      { icon: 'trending-up-outline', label: 'Progression utile' },
      { icon: 'shield-checkmark-outline', label: 'Meilleur matching' },
    ],
  },
  4: {
    eyebrow: 'Vos objectifs',
    title: 'Sport, réseau, progression : SpotU s’adapte à votre intention.',
    body: 'Ces choix permettent d’orienter les contacts, les spots et les recommandations vers le bon usage.',
    badges: [
      { icon: 'rocket-outline', label: 'Objectifs clairs' },
      { icon: 'people-circle-outline', label: 'Bons profils' },
      { icon: 'chatbubble-ellipses-outline', label: 'Interactions pertinentes' },
    ],
  },
  5: {
    eyebrow: 'Ancrage local',
    title: 'Dernière étape : montrer ce qu’il se passe près de vous.',
    body: 'Votre ville ou votre position servent à ouvrir directement les services, coachs et SpotYou autour de vous.',
    badges: [
      { icon: 'location-outline', label: 'Ville locale' },
      { icon: 'pin-outline', label: 'Spots proches' },
      { icon: 'compass-outline', label: 'Découverte immédiate' },
    ],
  },
};

/* ─── MAIN ONBOARDING SCREEN ────────────────────────────── */
export default function OnboardingScreen() {
  const router = useGuardedRouter();
  const { updateUser } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const [roles, setRoles] = useState<string[]>([]);
  const [sports, setSports] = useState<string[]>([]);
  const [level, setLevel] = useState<string[]>([]);
  const [goals, setGoals] = useState<string[]>([]);
  const [city, setCity] = useState('');
  const [locating, setLocating] = useState(false);
  const hero = HERO_COPY[step];

  const animateSlide = (dir: 'next' | 'back') => {
    slideAnim.setValue(dir === 'next' ? width * 0.3 : -width * 0.3);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }).start();
  };
  const goNext = () => { if (step < TOTAL_STEPS) { setStep(s => s + 1); animateSlide('next'); } };
  const goBack = () => { if (step > 1) { setStep(s => s - 1); animateSlide('back'); } };

  const toggleItem = (list: string[], setList: (v: string[]) => void, id: string, multi = true) => {
    if (multi) setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
    else setList(list.includes(id) ? [] : [id]);
  };

  const handleAutoLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('', "L'acces a la localisation a ete refuse"); setLocating(false); return; }
      const loc = await Location.getCurrentPositionAsync({});
      const [addr] = await Location.reverseGeocodeAsync({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      if (addr) setCity(addr.city || addr.subregion || addr.region || '');
    } catch { Alert.alert('', 'Impossible de determiner votre position'); }
    finally { setLocating(false); }
  };

  const handleFinish = async () => {
    setLoading(true);
    try {
      const payload: any = { onboarding_done: true };
      if (roles.length) payload.user_roles = roles;
      if (sports.length) payload.coach_tags = sports;
      if (level.length) payload.sports_level = level[0];
      if (goals.length) payload.goals = goals;
      await api.put('/users/profile', payload);
      updateUser({ onboarding_done: true });
      if (roles.includes('coach')) { try { await api.post('/users/become-coach', {}); } catch {} }
    } catch {}
    router.replace('/(tabs)/map');
    setLoading(false);
  };

  const handleSkip = () => {
    api.put('/users/profile', { onboarding_done: true }).catch(() => {});
    updateUser({ onboarding_done: true });
    router.replace('/(tabs)/map');
  };

  const renderStep = () => {
    switch (step) {
      case 1: return (
        <View>
          <Text style={s.stepTitle}>{"Tu es plutot :"}</Text>
          <Text style={s.stepDesc}>{"Tu peux choisir les deux !"}</Text>
          <View style={{ marginTop: 24 }}>
            <ChipGrid items={ROLE_OPTIONS} selected={roles} onToggle={id => toggleItem(roles, setRoles, id)} columns={1} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 28 }]} onPress={goNext} disabled={roles.length === 0} activeOpacity={0.85} testID="onb-step1-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );
      case 2: return (
        <View>
          <Text style={s.stepTitle}>{"Quels sports t'interessent ?"}</Text>
          <Text style={s.stepDesc}>{"Selectionne tout ce qui te plait"}</Text>
          <View style={{ marginTop: 20 }}>
            <ChipGrid items={SPORT_OPTIONS} selected={sports} onToggle={id => toggleItem(sports, setSports, id)} columns={2} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 24 }]} onPress={goNext} disabled={sports.length === 0} activeOpacity={0.85} testID="onb-step2-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );
      case 3: return (
        <View>
          <Text style={s.stepTitle}>{"Ton niveau ?"}</Text>
          <Text style={s.stepDesc}>{"Pas de jugement, juste pour mieux te guider"}</Text>
          <View style={{ marginTop: 24 }}>
            <ChipGrid items={LEVEL_OPTIONS} selected={level} onToggle={id => toggleItem(level, setLevel, id, false)} columns={1} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 28 }]} onPress={goNext} disabled={level.length === 0} activeOpacity={0.85} testID="onb-step3-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );
      case 4: return (
        <View>
          <Text style={s.stepTitle}>{"Pourquoi SpotU ?"}</Text>
          <Text style={s.stepDesc}>{"Ca nous aide a personnaliser ton experience"}</Text>
          <View style={{ marginTop: 20 }}>
            <ChipGrid items={GOAL_OPTIONS} selected={goals} onToggle={id => toggleItem(goals, setGoals, id)} columns={1} />
          </View>
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 24 }]} onPress={goNext} disabled={goals.length === 0} activeOpacity={0.85} testID="onb-step4-next">
            <Text style={s.primaryBtnText}>{"Continuer"}</Text><Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      );
      case 5: return (
        <View>
          <Text style={s.stepTitle}>{"Ou fais-tu du sport ?"}</Text>
          <Text style={s.stepDesc}>{"Pour te montrer ce qui se passe autour de toi"}</Text>
          <View style={{ marginTop: 24, gap: 12 }}>
            <TouchableOpacity style={s.locationBtn} onPress={handleAutoLocation} disabled={locating} activeOpacity={0.8} testID="auto-location-btn">
              {locating ? <ActivityIndicator color={Colors.primary} size="small" /> : <Ionicons name="navigate" size={20} color={Colors.primary} />}
              <Text style={s.locationBtnText}>{"Utiliser ma position"}</Text>
            </TouchableOpacity>
            <View style={s.orRow}><View style={s.orLine} /><Text style={s.orText}>OU</Text><View style={s.orLine} /></View>
            <FloatingInput label="Ta ville" value={city} onChangeText={setCity} testID="city-input" icon="location-outline" />
          </View>
          {city.length > 0 && (
            <View style={s.cityPreview}><Ionicons name="location" size={16} color={Colors.primary} /><Text style={s.cityPreviewText}>{city}</Text></View>
          )}
          <TouchableOpacity style={[s.primaryBtn, { marginTop: 20 }]} onPress={handleFinish} disabled={loading} activeOpacity={0.85} testID="onb-finish-btn">
            {loading ? <ActivityIndicator color="#000" size="small" /> : (
              <><Text style={s.primaryBtnText}>{"C'est parti !"}</Text><Ionicons name="rocket" size={18} color="#000" style={{ marginLeft: 6 }} /></>
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
      <View style={[s.glowOrb, s.glowOrbLeft]} />
      <View style={[s.glowOrb, s.glowOrbRight]} />
      <SafeAreaView style={s.safe}>
        <View style={s.header}>
          {step > 1 ? (
            <TouchableOpacity onPress={goBack} style={s.backBtn} testID="onb-back">
              <Ionicons name="chevron-back" size={22} color={Colors.foreground} />
            </TouchableOpacity>
          ) : <View style={{ width: 36 }} />}
          <ProgressBar step={step} total={TOTAL_STEPS} />
          <TouchableOpacity onPress={handleSkip} testID="onb-skip">
            <Text style={s.skipText}>{"Passer"}</Text>
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={s.heroPanel} testID="onboarding-hero-panel">
              <View style={s.heroEyebrowRow}>
                <View style={s.heroEyebrowDot} />
                <Text style={s.heroEyebrow}>{hero.eyebrow}</Text>
              </View>
              <Text style={s.heroTitle}>{hero.title}</Text>
              <Text style={s.heroBody}>{hero.body}</Text>
              <View style={s.heroBadgeRow}>
                {hero.badges.map((badge) => (
                  <View key={badge.label} style={s.heroBadge}>
                    <Ionicons name={badge.icon} size={14} color={Colors.primary} />
                    <Text style={s.heroBadgeText}>{badge.label}</Text>
                  </View>
                ))}
              </View>
            </View>
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
  root: { flex: 1, backgroundColor: '#031010' },
  gradientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 260, backgroundColor: '#0B2F2F', borderBottomLeftRadius: 34, borderBottomRightRadius: 34 },
  glowOrb: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(0, 191, 165, 0.08)' },
  glowOrbLeft: { top: 46, left: -40 },
  glowOrbRight: { top: 120, right: -55 },
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(8, 29, 29, 0.85)', borderWidth: 1, borderColor: 'rgba(71, 113, 113, 0.35)', alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, color: '#83A9A9', fontWeight: '700' },
  scroll: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 40 },
  heroPanel: { backgroundColor: 'rgba(7, 28, 28, 0.82)', borderRadius: 28, padding: 22, borderWidth: 1, borderColor: 'rgba(91, 142, 142, 0.28)' },
  heroEyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  heroEyebrowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  heroEyebrow: { fontSize: 12, color: Colors.primary, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  heroTitle: { fontSize: 28, lineHeight: 34, color: Colors.foreground, fontWeight: '900', letterSpacing: -0.8 },
  heroBody: { fontSize: 14, lineHeight: 22, color: '#B2C4C4', marginTop: 10, maxWidth: '92%' },
  heroBadgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  heroBadge: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 999, backgroundColor: 'rgba(0, 191, 165, 0.09)', borderWidth: 1, borderColor: 'rgba(0, 191, 165, 0.22)' },
  heroBadgeText: { fontSize: 12, color: '#D6E4E4', fontWeight: '700' },
  card: { marginTop: 18, backgroundColor: '#0A1D1D', borderRadius: 28, padding: 24, borderWidth: 1, borderColor: '#163737', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.18, shadowRadius: 30, elevation: 12 },
  stepTitle: { fontSize: 24, fontWeight: '900', color: Colors.foreground, letterSpacing: -0.5 },
  stepDesc: { fontSize: 13, color: '#5A8A8A', fontWeight: '500', marginTop: 4 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#000', letterSpacing: 0.3 },
  locationBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.primary + '10', borderWidth: 1.5, borderColor: Colors.primary + '40', borderRadius: 14, paddingVertical: 16 },
  locationBtnText: { fontSize: 15, fontWeight: '700', color: Colors.primary },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  orLine: { flex: 1, height: 1, backgroundColor: '#1A3A3A' },
  orText: { fontSize: 11, color: '#5A6B6B', fontWeight: '600' },
  cityPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary + '10', borderRadius: 10, padding: 10, marginTop: 8 },
  cityPreviewText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
});
