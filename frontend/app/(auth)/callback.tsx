import { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing } from '../../constants/Colors';

export default function AuthCallback() {
  const router = useRouter();
  const { processGoogleCallback } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    const process = async () => {
      try {
        // Extract session_id from URL fragment or query params
        let sessionId: string | null = null;

        if (typeof window !== 'undefined') {
          const hash = window.location.hash;
          const search = window.location.search;
          const allParams = (hash.replace('#', '') + '&' + search.replace('?', ''));
          const params = new URLSearchParams(allParams);
          sessionId = params.get('session_id');
        }

        if (!sessionId) {
          router.replace('/(auth)/login');
          return;
        }

        await processGoogleCallback(sessionId);
        router.replace('/(tabs)/map');
      } catch (err) {
        console.error('Auth callback error:', err);
        router.replace('/(auth)/login');
      }
    };

    process();
  }, []);

  return (
    <View style={styles.container} testID="auth-callback-screen">
      <View style={styles.logo}>
        <Text style={styles.logoText}>W</Text>
      </View>
      <Text style={styles.title}>WINEK</Text>
      <ActivityIndicator size="large" color={Colors.primary} style={styles.spinner} />
      <Text style={styles.text}>Connexion en cours…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  logo: { width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  logoText: { fontSize: 36, fontWeight: '900', color: '#fff' },
  title: { fontSize: 24, fontWeight: '900', color: Colors.foreground, letterSpacing: 4, marginBottom: Spacing.xl },
  spinner: { marginBottom: Spacing.md },
  text: { fontSize: 15, color: Colors.muted },
});
