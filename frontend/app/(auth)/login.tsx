import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, ActivityIndicator, Alert, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WButton } from '../../components/WButton';
import { WInput } from '../../components/WInput';
import { Colors, Spacing, Radius } from '../../constants/Colors';

export default function LoginScreen() {
  const router = useRouter();
  const { login, loginWithGoogle } = useAuth();
  const { t } = useLang();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace('/(tabs)/map');
    } catch (err: any) {
      Alert.alert(t('error'), err.message || 'Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.kav}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.logo}>WINEK</Text>
            <Text style={styles.tagline}>Trouvez. Connectez. Bougez.</Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <Text style={styles.title}>{t('welcomeBack')}</Text>

            <WInput
              label={t('email')}
              placeholder="votre@email.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              testID="email-input"
            />

            <WInput
              label={t('password')}
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="password-input"
            />

            <WButton
              label={t('login')}
              onPress={handleLogin}
              loading={loading}
              style={styles.btn}
              testID="login-btn"
            />

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('orContinueWith')}</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Google */}
            <TouchableOpacity
              style={styles.googleBtn}
              onPress={loginWithGoogle}
              activeOpacity={0.8}
              testID="google-login-btn"
            >
              <Text style={styles.googleIcon}>🔵</Text>
              <Text style={styles.googleText}>{t('googleSignIn')}</Text>
            </TouchableOpacity>

            {/* Register link */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('noAccount')} </Text>
              <Pressable onPress={() => router.push('/(auth)/register')} testID="go-register">
                <Text style={styles.footerLink}>{t('register')}</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  kav: { flex: 1 },
  scroll: { flexGrow: 1, padding: Spacing.lg, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: Spacing.xl },
  logo: {
    fontSize: 42,
    fontWeight: '900',
    color: Colors.primary,
    letterSpacing: -1,
  },
  tagline: { fontSize: 14, color: Colors.muted, marginTop: 4 },
  form: {
    backgroundColor: Colors.background,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.foreground,
    marginBottom: Spacing.lg,
  },
  btn: { marginTop: Spacing.sm },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: Spacing.md,
    gap: Spacing.sm,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.muted },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.full,
    paddingVertical: Spacing.sm + 4,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.background,
  },
  googleIcon: { fontSize: 18 },
  googleText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  footerText: { fontSize: 14, color: Colors.muted },
  footerLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
});
