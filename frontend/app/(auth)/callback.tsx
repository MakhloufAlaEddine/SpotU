import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
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

    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    console.log('[AuthCallback] hash:', hash);
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? match[1] : null;
    console.log('[AuthCallback] sessionId extrait:', sessionId ? sessionId.substring(0, 20) + '...' : 'NULL');

    if (sessionId) {
      processGoogleCallback(sessionId)
        .then(() => {
          console.log('[AuthCallback] succès → navigation vers map');
          router.replace('/(tabs)/map');
        })
        .catch((err: any) => {
          console.log('[AuthCallback] échec:', err?.message || err);
          router.replace('/(auth)/login');
        });
    } else {
      console.log('[AuthCallback] pas de sessionId → login');
      router.replace('/(auth)/login');
    }
  }, []);

  return (
    <View style={styles.container} testID="auth-callback">
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.text}>Connexion en cours…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  text: { marginTop: Spacing.md, fontSize: 15, color: Colors.muted },
});
