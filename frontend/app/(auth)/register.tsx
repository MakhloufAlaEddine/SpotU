import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert, Pressable, Image,
  TextInput, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors } from '../../constants/Colors';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

function FloatingInput({ label, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, testID, icon }: any) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const active = focused || value.length > 0;
  return (
    <View style={[fi.wrap, focused && fi.wrapFocused]}>
      <View style={fi.iconWrap}><Ionicons name={icon} size={18} color={focused ? Colors.primary : '#5A6B6B'} /></View>
      <View style={fi.inputArea}>
        <Text style={[fi.label, active && fi.labelActive]}>{label}</Text>
        <TextInput testID={testID} style={fi.input} value={value} onChangeText={onChangeText}
          secureTextEntry={hidden} keyboardType={keyboardType ?? 'default'} autoCapitalize={autoCapitalize ?? 'sentences'}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} placeholderTextColor="transparent" />
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
  label: { fontSize: 11, fontWeight: '500', color: '#5A6B6B' },
  labelActive: { color: Colors.primary, fontSize: 10 },
  input: { fontSize: 15, color: Colors.foreground, paddingVertical: 2, height: 24 },
  eye: { padding: 6 },
});

export default function RegisterScreen() {
  const router = useGuardedRouter();
  const { register, loginWithGoogle } = useAuth();
  const { t, lang } = useLang();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const logoAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.stagger(200, [
      Animated.spring(logoAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 8 }),
      Animated.spring(formAnim, { toValue: 1, useNativeDriver: true, tension: 40, friction: 9 }),
    ]).start();
  }, []);

  const handleRegister = async () => {
    if (!name.trim() || !email.trim() || !password) {
      Alert.alert('', 'Veuillez remplir tous les champs');
      return;
    }
    if (password.length < 6) {
      Alert.alert('', 'Le mot de passe doit comporter au moins 6 caracteres');
      return;
    }
    setLoading(true);
    try {
      await register(email.trim(), password, name.trim(), lang);
      // NavigationGuard handles redirect to /onboarding
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
      // NavigationGuard handles redirect to /onboarding
    } catch (err: any) {
      Alert.alert(t('error'), 'Connexion Google annulee');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = name.trim().length > 0 && email.trim().length > 0 && password.length > 0;

  return (
    <View style={s.root}>
      <View style={s.gradientTop} />
      <View style={s.gradientGlow} />
      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
          <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Animated.View style={[s.logoWrap, { opacity: logoAnim, transform: [{ translateY: logoAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }] }]}>
              <View style={s.logoGlow} />
              <Image source={require('../../assets/icon.png')} style={s.logo} resizeMode="contain" />
              <Text style={s.appName}>SpotU</Text>
              <Text style={s.tagline}>{"Rejoins la communaute"}</Text>
            </Animated.View>

            <Animated.View style={[s.card, { opacity: formAnim, transform: [{ translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }] }]}>
              <Text style={s.title}>{"Cree ton compte"}</Text>
              <Text style={s.subtitle}>{"En quelques secondes"}</Text>

              <View style={{ marginTop: 20 }}>
                <FloatingInput label="Prenom et nom" value={name} onChangeText={setName} autoCapitalize="words" testID="name-input" icon="person-outline" />
                <FloatingInput label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="email-input" icon="mail-outline" />
                <FloatingInput label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry testID="password-input" icon="lock-closed-outline" />
              </View>

              <TouchableOpacity style={[s.primaryBtn, (!canSubmit || loading) && s.primaryBtnDisabled]} onPress={handleRegister} disabled={loading || !canSubmit} activeOpacity={0.85} testID="register-btn">
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
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#061818' },
  gradientTop: { position: 'absolute', top: 0, left: 0, right: 0, height: '45%', backgroundColor: '#0D3B3B', borderBottomLeftRadius: 40, borderBottomRightRadius: 40 },
  gradientGlow: { position: 'absolute', top: '8%', alignSelf: 'center', width: 200, height: 200, borderRadius: 100, backgroundColor: Colors.primary + '12' },
  safe: { flex: 1 },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', paddingBottom: 40 },
  logoWrap: { alignItems: 'center', marginBottom: 28, zIndex: 2 },
  logoGlow: { position: 'absolute', top: 10, width: 120, height: 120, borderRadius: 60, backgroundColor: Colors.primary + '15' },
  logo: { width: 100, height: 100 },
  appName: { fontSize: 28, fontWeight: '900', color: Colors.foreground, letterSpacing: 1.5, marginTop: 6 },
  tagline: { fontSize: 13, color: '#5A8A8A', fontWeight: '500', marginTop: 2, letterSpacing: 0.3 },
  card: { backgroundColor: '#0E2626', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#1A3A3A' },
  title: { fontSize: 24, fontWeight: '800', color: Colors.foreground, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: '#5A8A8A', fontWeight: '500', marginTop: 4 },
  primaryBtn: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginTop: 6 },
  primaryBtnDisabled: { opacity: 0.45 },
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
});
