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

    // Lire le session_id depuis l'URL (hash OU query params) OU sessionStorage (backup)
    let sessionId: string | null = null;

    if (typeof window !== 'undefined') {
      // 1. Chercher dans le hash (#session_id=...)
      const hash = window.location.hash || '';
      const hashMatch = hash.match(/session_id=([^&]+)/);
      // 2. Chercher dans les query params (?session_id=...)
      const search = window.location.search || '';
      const queryMatch = search.match(/[?&]session_id=([^&]+)/);

      const raw = hashMatch?.[1] || queryMatch?.[1] || null;
      if (raw) {
        try { sessionId = decodeURIComponent(raw); } catch { sessionId = raw; }
        try { sessionStorage.setItem('winek_pending_session', sessionId); } catch {}
      } else {
        // Fallback sessionStorage si l'URL a déjà changé
        try { sessionId = sessionStorage.getItem('winek_pending_session'); } catch {}
      }
    }

    console.log('[AuthCallback] sessionId found:', !!sessionId);

    if (sessionId) {
      processGoogleCallback(sessionId)
        .then(() => {
          try { sessionStorage.removeItem('winek_pending_session'); } catch {}
          router.replace('/(tabs)/map');
        })
        .catch((err: any) => {
          console.log('[AuthCallback] error:', err?.message);
          try { sessionStorage.removeItem('winek_pending_session'); } catch {}
          // Rediriger vers login avec indicateur d'erreur
          router.replace('/(auth)/login');
        });
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
