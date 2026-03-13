import React, { useEffect, useRef } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
;
import { useAuth } from '../../context/AuthContext';
import { Colors, Spacing } from '../../constants/Colors';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

export default function AuthCallback() {
  const router = useGuardedRouter();
  const { processGoogleCallback } = useAuth();
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    let sessionId: string | null = null;

    if (typeof window !== 'undefined') {
      const hash = window.location.hash || '';
      const hashMatch = hash.match(/session_id=([^&]+)/);
      const search = window.location.search || '';
      const queryMatch = search.match(/[?&]session_id=([^&]+)/);

      const raw = hashMatch?.[1] || queryMatch?.[1] || null;
      if (raw) {
        try { sessionId = decodeURIComponent(raw); } catch { sessionId = raw; }
        try { sessionStorage.setItem('spotu_pending_session', sessionId); } catch {}
      } else {
        try { sessionId = sessionStorage.getItem('spotu_pending_session'); } catch {}
      }

      // Détection contexte natif (?native=1)
      // Quand la page est chargée depuis Expo Go via SFSafariViewController,
      // on ne traite PAS la session ici (web). À la place on redirige vers exp://
      // ce qui ferme automatiquement SFSafariViewController et ouvre Expo Go.
      const isNativeContext = search.includes('native=1');
      if (isNativeContext && sessionId) {
        try { sessionStorage.removeItem('spotu_pending_session'); } catch {}
        // Use the dynamic exp_callback URL passed from the native app
        const expCallbackMatch = search.match(/[?&]exp_callback=([^&]+)/);
        const expCallbackBase = expCallbackMatch ? decodeURIComponent(expCallbackMatch[1]) : null;
        if (expCallbackBase) {
          const expUrl = `${expCallbackBase}?session_id=${encodeURIComponent(sessionId)}`;
          window.location.href = expUrl;
        } else {
          // Fallback: use ngrok tunnel host
          const expHost = 'profile-smoke-test.ngrok.io';
          const expUrl = `exp://${expHost}/--/auth-callback?session_id=${encodeURIComponent(sessionId)}`;
          window.location.href = expUrl;
        }
        return;
      }
    }

    if (sessionId) {
      processGoogleCallback(sessionId)
        .then(() => {
          try { sessionStorage.removeItem('spotu_pending_session'); } catch {}
          // NavigationGuard dans _layout.tsx détecte user && inAuth et redirige automatiquement
        })
        .catch((err: any) => {
          console.log('[AuthCallback] error:', err?.message);
          try { sessionStorage.removeItem('spotu_pending_session'); } catch {}
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
