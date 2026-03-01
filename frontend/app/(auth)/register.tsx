import React, { useState } from 'react';
import {
  View, Text, StyleSheet, KeyboardAvoidingView, Platform,
  ScrollView, Alert, Pressable, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WButton } from '../../components/WButton';
import { WInput } from '../../components/WInput';
import { Colors, Spacing, Radius } from '../../constants/Colors';

export default function RegisterScreen() {
  const router = useRouter();
  const { register, loginWithGoogle } = useAuth();
  const { t, setLanguage, lang } = useLang();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  // La navigation post-inscription est entièrement gérée par NavigationGuard dans _layout.tsx
  const handleRegister = async () => {
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
    } catch (err: any) {
      Alert.alert(t('error'), err.message || 'Erreur lors de l\'inscription');
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
          <View style={styles.header}>
            <Text style={styles.logo}>SpotU</Text>
            <Text style={styles.tagline}>Rejoignez la communauté</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.title}>{t('createAccount')}</Text>

            {/* Language selector */}
            <View style={styles.langRow}>
              <Text style={styles.langLabel}>Langue / Language</Text>
              <View style={styles.langOptions}>
                {(['fr', 'en'] as const).map((l) => (
                  <TouchableOpacity
                    key={l}
                    style={[styles.langBtn, lang === l && styles.langBtnActive]}
                    onPress={() => setLanguage(l)}
                    testID={`lang-${l}`}
                  >
                    <Text style={[styles.langBtnText, lang === l && styles.langBtnTextActive]}>
                      {l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <WInput
              label={t('fullName')}
              placeholder="Thomas Dupont"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              testID="name-input"
            />

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
              placeholder="Min. 6 caractères"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="password-input"
            />

            <WButton
              label={t('register')}
              onPress={handleRegister}
              loading={loading}
              style={styles.btn}
              testID="register-btn"
            />

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('orContinueWith')}</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={styles.googleBtn}
              onPress={loginWithGoogle}
              activeOpacity={0.8}
              testID="google-register-btn"
            >
              <Text style={styles.googleIcon}>🔵</Text>
              <Text style={styles.googleText}>{t('googleSignIn')}</Text>
            </TouchableOpacity>

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('hasAccount')} </Text>
              <Pressable onPress={() => router.push('/(auth)/login')} testID="go-login">
                <Text style={styles.footerLink}>{t('login')}</Text>
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
  logo: { fontSize: 42, fontWeight: '900', color: Colors.primary, letterSpacing: -1 },
  tagline: { fontSize: 14, color: Colors.muted, marginTop: 4 },
  form: { backgroundColor: Colors.background, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border },
  title: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.lg },
  langRow: { marginBottom: Spacing.md },
  langLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, marginBottom: 8 },
  langOptions: { flexDirection: 'row', gap: Spacing.sm },
  langBtn: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  langBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  langBtnText: { fontSize: 13, fontWeight: '600', color: Colors.foreground },
  langBtnTextActive: { color: Colors.primary },
  btn: { marginTop: Spacing.sm },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.md, gap: Spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: 12, color: Colors.muted },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.full, paddingVertical: Spacing.sm + 4, paddingHorizontal: Spacing.lg },
  googleIcon: { fontSize: 18 },
  googleText: { fontSize: 15, fontWeight: '600', color: Colors.foreground },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  footerText: { fontSize: 14, color: Colors.muted },
  footerLink: { fontSize: 14, color: Colors.primary, fontWeight: '700' },
});
