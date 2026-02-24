import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, Alert, Image
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WInput } from '../../components/WInput';
import { WButton } from '../../components/WButton';
import { Colors, Spacing, Radius } from '../../constants/Colors';

export default function LoginScreen() {
  const router = useRouter();
  const { login, loginWithGoogle } = useAuth();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) return;
    setLoading(true);
    try {
      await login(email, password);
      router.replace('/(tabs)/map');
    } catch (err: any) {
      Alert.alert(t('error'), err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Logo */}
        <View style={styles.logoWrap} testID="logo-section">
          <View style={styles.logo}>
            <Text style={styles.logoText}>W</Text>
          </View>
          <Text style={styles.logoName}>WINEK</Text>
          <Text style={styles.tagline}>Connectez-vous localement</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t('welcomeBack')}</Text>

          <WInput
            label={t('email')}
            placeholder="vous@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            testID="login-email-input"
          />
          <WInput
            label={t('password')}
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            testID="login-password-input"
          />

          <WButton
            label={t('login')}
            onPress={handleLogin}
            loading={loading}
            style={styles.loginBtn}
            testID="login-submit-btn"
          />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>{t('orContinueWith')}</Text>
            <View style={styles.line} />
          </View>

          <TouchableOpacity
            testID="google-signin-btn"
            style={styles.googleBtn}
            onPress={loginWithGoogle}
            activeOpacity={0.8}
          >
            <Text style={styles.googleIcon}>G</Text>
            <Text style={styles.googleText}>{t('googleSignIn')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{t('noAccount')} </Text>
          <TouchableOpacity testID="go-register-btn" onPress={() => router.push('/(auth)/register')}>
            <Text style={styles.link}>{t('register')}</Text>
          </TouchableOpacity>
        </View>

        {/* Demo credentials */}
        <View style={styles.demo}>
          <Text style={styles.demoTitle}>Comptes de démonstration :</Text>
          <Text style={styles.demoText}>👤 user@winek.app / WinekUser2024!</Text>
          <Text style={styles.demoText}>🏋️ coach@winek.app / WinekCoach2024!</Text>
          <Text style={styles.demoText}>⚙️ admin@winek.app / WinekAdmin2024!</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: { flexGrow: 1, padding: Spacing.lg, paddingTop: 60 },
  logoWrap: { alignItems: 'center', marginBottom: Spacing.xl },
  logo: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    marginBottom: 12, shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.35, shadowRadius: 16, elevation: 10,
  },
  logoText: { fontSize: 36, fontWeight: '900', color: '#fff' },
  logoName: { fontSize: 28, fontWeight: '900', color: Colors.foreground, letterSpacing: 4 },
  tagline: { fontSize: 14, color: Colors.muted, marginTop: 4 },
  card: {
    backgroundColor: '#fff', borderRadius: Radius.xl,
    padding: Spacing.lg, shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06,
    shadowRadius: 16, elevation: 4,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.lg },
  loginBtn: { marginTop: Spacing.sm },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.md },
  line: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { marginHorizontal: Spacing.sm, fontSize: 12, color: Colors.muted },
  googleBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, padding: Spacing.sm + 4, borderRadius: Radius.full,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: '#fff',
  },
  googleIcon: { fontSize: 18, fontWeight: '900', color: '#4285F4' },
  googleText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  footerText: { color: Colors.muted },
  link: { color: Colors.primary, fontWeight: '700' },
  demo: { marginTop: Spacing.xl, padding: Spacing.md, backgroundColor: Colors.secondary, borderRadius: Radius.lg },
  demoTitle: { fontSize: 12, fontWeight: '700', color: Colors.muted, marginBottom: 6 },
  demoText: { fontSize: 12, color: Colors.muted, marginBottom: 2 },
});
