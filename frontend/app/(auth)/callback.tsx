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
    const match = hash.match(/session_id=([^&]+)/);
    const sessionId = match ? match[1] : null;

    if (sessionId) {
      processGoogleCallback(sessionId)
        .then(() => router.replace('/(tabs)/map'))
        .catch(() => router.replace('/(auth)/login'));
    } else {
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
