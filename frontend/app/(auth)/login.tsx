import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Pressable, Image,
  TextInput, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';
import { AuthErrorModal } from '../../components/AuthErrorModal';
import { messageForAuthScreen } from '../../lib/network-error';

const { width } = Dimensions.get('window');

function FloatingInput({
  label, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, testID, icon,
}: {
  label: string; value: string; onChangeText: (t: string) => void;
  secureTextEntry?: boolean; keyboardType?: any; autoCapitalize?: any;
  testID?: string; icon: string;
}) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const active = focused || value.length > 0;

  return (
    <View style={[fi.wrap, focused && fi.wrapFocused]} testID={`${testID}-wrap`}>
      <View style={fi.iconWrap}>
        <Ionicons name={icon as any} size={18} color={focused ? Colors.primary : '#5A6B6B'} />
      </View>
      <View style={fi.inputArea}>
        <Text style={[fi.label, active && fi.labelActive]}>
          {label}
        </Text>
        <TextInput
          testID={testID}
          style={fi.input}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          keyboardType={keyboardType ?? 'default'}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholderTextColor="transparent"
        />
      </View>
      {secureTextEntry && (
        <TouchableOpacity onPress={() => setHidden(!hidden)} style={fi.eye} testID={`${testID}-eye`}>
          <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color="#5A6B6B" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const fi = StyleSheet.create({
  wrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#0A2020',
    borderRadius: 16, borderWidth: 1.5, borderColor: '#1A3A3A',
    paddingHorizontal: 14, paddingVertical: 4,
    marginBottom: 14,
  },
  wrapFocused: { borderColor: Colors.primary + '80' },
  iconWrap: { width: 28, alignItems: 'center', marginRight: 10 },
  inputArea: { flex: 1, paddingVertical: 6 },
  label: { fontSize: 11, fontWeight: '500', color: '#5A6B6B', marginBottom: 0 },
  labelActive: { color: Colors.primary, fontSize: 10 },
  input: { fontSize: 15, color: Colors.foreground, paddingVertical: 2, height: 24 },
  eye: { padding: 6 },
});

export default function LoginScreen() {
  const router = useGuardedRouter();
  const { login, loginWithGoogle } = useAuth();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ title: string; message: string } | null>(null);

  // Entrance animations
  const logoAnim = useRef(new Animated.Value(0)).current;
  const formAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.stagger(200, [
      Animated.spring(logoAnim, { toValue: 1, useNativeDriver: true, tension: 50, friction: 8 }),
      Animated.spring(formAnim, { toValue: 1, useNativeDriver: true, tension: 40, friction: 9 }),
    ]).start();
  }, []);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err: unknown) {
      setErrorDialog({
        title: t('error'),
        message: messageForAuthScreen(err, 'Erreur de connexion'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
      if (Platform.OS !== 'web') {
        router.replace('/(tabs)/map');
      }
    } catch {
      setErrorDialog({ title: t('error'), message: 'Connexion Google annulée' });
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = email.trim().length > 0 && password.length > 0;

  return (
    <View style={s.root}>
      <AuthErrorModal
        visible={errorDialog !== null}
        title={errorDialog?.title ?? ''}
        message={errorDialog?.message ?? ''}
        onClose={() => setErrorDialog(null)}
      />
      {/* Subtle gradient overlay */}
      <View style={s.gradientTop} />
      <View style={s.gradientGlow} />

      <SafeAreaView style={s.safe}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.kav}
        >
          <ScrollView
            contentContainerStyle={s.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Logo */}
            <Animated.View style={[s.logoWrap, {
              opacity: logoAnim,
              transform: [{ translateY: logoAnim.interpolate({ inputRange: [0, 1], outputRange: [-30, 0] }) }],
            }]}>
              <View style={s.logoGlow} />
              <Image
                source={require('../../assets/icon.png')}
                style={s.logo}
                resizeMode="contain"
              />
              <Text style={s.appName}>SpotU</Text>
              <Text style={s.tagline}>{"Votre univers hyperlocal"}</Text>
            </Animated.View>

            {/* Form Card */}
            <Animated.View style={[s.card, {
              opacity: formAnim,
              transform: [{ translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
            }]}>
              <Text style={s.title}>{t('welcomeBack')}</Text>
              <Text style={s.subtitle}>{"Connectez-vous pour continuer"}</Text>

              <View style={s.inputsWrap}>
                <FloatingInput
                  label={t('email')}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  testID="email-input"
                  icon="mail-outline"
                />
                <FloatingInput
                  label={t('password')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  testID="password-input"
                  icon="lock-closed-outline"
                />
              </View>

              {/* Sign in button */}
              <TouchableOpacity
                onPress={handleLogin}
                disabled={loading || !canSubmit}
                activeOpacity={0.85}
                style={[s.primaryBtn, (!canSubmit || loading) && s.primaryBtnDisabled]}
                testID="login-btn"
              >
                {loading ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <>
                    <Text style={s.primaryBtnText}>{t('login')}</Text>
                    <Ionicons name="arrow-forward" size={18} color="#000" style={{ marginLeft: 6 }} />
                  </>
                )}
              </TouchableOpacity>

              {/* Divider */}
              <View style={s.divider}>
                <View style={s.dividerLine} />
                <Text style={s.dividerText}>{t('orContinueWith')}</Text>
                <View style={s.dividerLine} />
              </View>

              {/* Google button */}
              <TouchableOpacity
                onPress={handleGoogleLogin}
                activeOpacity={0.8}
                style={s.googleBtn}
                testID="google-login-btn"
              >
                <View style={s.googleIconWrap}>
                  <Ionicons name="logo-google" size={18} color="#fff" />
                </View>
                <Text style={s.googleText}>{t('googleSignIn')}</Text>
              </TouchableOpacity>

              {/* Register link */}
              <View style={s.footer}>
                <Text style={s.footerText}>{t('noAccount')} </Text>
                <Pressable onPress={() => router.push('/(auth)/register')} testID="go-register">
                  <Text style={s.footerLink}>{t('register')}</Text>
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
  gradientTop: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '45%',
    backgroundColor: '#0D3B3B',
    borderBottomLeftRadius: 40, borderBottomRightRadius: 40,
  },
  gradientGlow: {
    position: 'absolute', top: '8%', alignSelf: 'center',
    width: 200, height: 200, borderRadius: 100,
    backgroundColor: Colors.primary + '12',
  },
  safe: { flex: 1 },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', paddingBottom: 40 },

  // Logo
  logoWrap: { alignItems: 'center', marginBottom: 28, zIndex: 2 },
  logoGlow: {
    position: 'absolute', top: 10,
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: Colors.primary + '15',
  },
  logo: { width: 100, height: 100 },
  appName: {
    fontSize: 28, fontWeight: '900', color: Colors.foreground,
    letterSpacing: 1.5, marginTop: 6,
  },
  tagline: {
    fontSize: 13, color: '#5A8A8A', fontWeight: '500',
    marginTop: 2, letterSpacing: 0.3,
  },

  // Card
  card: {
    backgroundColor: '#0E2626',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#1A3A3A',
  },
  title: {
    fontSize: 24, fontWeight: '800', color: Colors.foreground,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13, color: '#5A8A8A', fontWeight: '500',
    marginTop: 4, marginBottom: 24,
  },
  inputsWrap: { marginBottom: 6 },

  // Primary button
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: {
    fontSize: 16, fontWeight: '700', color: '#000',
    letterSpacing: 0.3,
  },

  // Divider
  divider: {
    flexDirection: 'row', alignItems: 'center',
    marginVertical: 20, gap: 10,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1A3A3A' },
  dividerText: { fontSize: 12, color: '#5A6B6B', fontWeight: '500' },

  // Google button
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10,
    backgroundColor: '#0A1E1E',
    borderWidth: 1.5, borderColor: '#1A3A3A',
    borderRadius: 14,
    paddingVertical: 14,
  },
  googleIconWrap: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#1A3A3A',
    alignItems: 'center', justifyContent: 'center',
  },
  googleText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },

  // Footer
  footer: {
    flexDirection: 'row', justifyContent: 'center',
    marginTop: 22, paddingTop: 4,
  },
  footerText: { fontSize: 14, color: '#5A6B6B' },
  footerLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
});
