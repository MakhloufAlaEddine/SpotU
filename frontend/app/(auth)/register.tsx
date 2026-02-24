import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { useLang } from '../../context/LanguageContext';
import { WInput } from '../../components/WInput';
import { WButton } from '../../components/WButton';
import { Colors, Spacing, Radius } from '../../constants/Colors';
import { Lang } from '../../lib/i18n';

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = useLang();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [lang, setLangChoice] = useState<Lang>('fr');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!name || !email || !password) return Alert.alert(t('error'), 'Tous les champs sont requis');
    if (password.length < 6) return Alert.alert(t('error'), 'Mot de passe trop court (6 min)');
    setLoading(true);
    try {
      await register(email, password, name, lang);
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
        <View style={styles.header}>
          <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.back}>
            <Text style={styles.backText}>← {t('back')}</Text>
          </TouchableOpacity>
          <View style={styles.logo}>
            <Text style={styles.logoText}>W</Text>
          </View>
          <Text style={styles.logoName}>WINEK</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.title}>{t('createAccount')}</Text>

          <WInput label={t('fullName')} placeholder="Thomas Dupont" value={name} onChangeText={setName} testID="register-name-input" />
          <WInput label={t('email')} placeholder="vous@email.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" testID="register-email-input" />
          <WInput label={t('password')} placeholder="Minimum 6 caractères" value={password} onChangeText={setPassword} secureTextEntry testID="register-password-input" />

          <View style={styles.langRow}>
            <Text style={styles.langLabel}>{t('language')}</Text>
            <View style={styles.langPills}>
              {(['fr', 'en'] as Lang[]).map((l) => (
                <TouchableOpacity
                  key={l}
                  testID={`lang-${l}-btn`}
                  style={[styles.langPill, lang === l && styles.langPillActive]}
                  onPress={() => setLangChoice(l)}
                >
                  <Text style={[styles.langPillText, lang === l && styles.langPillTextActive]}>
                    {l === 'fr' ? '🇫🇷 Français' : '🇬🇧 English'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <WButton label={t('register')} onPress={handleRegister} loading={loading} style={styles.btn} testID="register-submit-btn" />
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>{t('hasAccount')} </Text>
          <TouchableOpacity testID="go-login-btn" onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.link}>{t('login')}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  container: { flexGrow: 1, padding: Spacing.lg, paddingTop: 50 },
  header: { alignItems: 'center', marginBottom: Spacing.lg },
  back: { alignSelf: 'flex-start', marginBottom: Spacing.md },
  backText: { color: Colors.primary, fontSize: 15, fontWeight: '600' },
  logo: { width: 60, height: 60, borderRadius: 16, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  logoText: { fontSize: 28, fontWeight: '900', color: '#fff' },
  logoName: { fontSize: 22, fontWeight: '900', color: Colors.foreground, letterSpacing: 4 },
  card: { backgroundColor: '#fff', borderRadius: Radius.xl, padding: Spacing.lg, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 16, elevation: 4 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.foreground, marginBottom: Spacing.lg },
  langRow: { marginBottom: Spacing.md },
  langLabel: { fontSize: 13, fontWeight: '600', color: Colors.foreground, marginBottom: 8 },
  langPills: { flexDirection: 'row', gap: 10 },
  langPill: { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center' },
  langPillActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  langPillText: { fontSize: 13, fontWeight: '600', color: Colors.muted },
  langPillTextActive: { color: Colors.primary },
  btn: { marginTop: Spacing.sm },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: Spacing.lg },
  footerText: { color: Colors.muted },
  link: { color: Colors.primary, fontWeight: '700' },
});
