import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { RefreshProvider } from '../context/RefreshContext';
import { LanguageProvider } from '../context/LanguageContext';
import { LocationProvider } from '../context/LocationContext';
import { StatusBar } from 'expo-status-bar';
import {
  registerForPushNotificationsAsync,
  saveTokenToServer,
  setupNotificationResponseHandler,
} from '../lib/push-notifications';

// Source unique de vérité pour la navigation auth
// Ce composant est le SEUL endroit où la redirection login <-> app est décidée
function NavigationGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const pushTokenRef = useRef<string | null>(null);

  // Enregistrement push notifications après connexion
  useEffect(() => {
    if (user && !pushTokenRef.current) {
      registerForPushNotificationsAsync().then((token) => {
        if (token) {
          pushTokenRef.current = token;
          saveTokenToServer(token);
        }
      });
    }
    // Listener de tap sur notification → navigation
    const cleanup = setupNotificationResponseHandler();
    return cleanup;
  }, [user]);

  useEffect(() => {
    // Sur WEB seulement : attendre que le stack de navigation soit initialisé
    // (évite les appels router.replace() avant que react-navigation soit prêt,
    //  ce qui arrivait lors des full page loads / deep links directs)
    // Sur NATIVE (Expo Go) : cette vérification n'est PAS nécessaire et
    // bloque la navigation après Google OAuth car l'état peut être undefined
    // temporairement après la fermeture du navigateur in-app.
    if (Platform.OS === 'web' && !navigationState?.key) return;
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    const atRoot = segments.length === 0;

    if (user && (inAuth || atRoot)) {
      // Connecté mais sur page auth ou racine → aller vers l'app
      router.replace('/(tabs)/map');
    } else if (!user && !inAuth) {
      // Non connecté et hors pages auth → aller vers login
      router.replace('/(auth)/login');
    }
  }, [navigationState?.key, user, loading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RefreshProvider>
      <LanguageProvider>
        <LocationProvider>
          <StatusBar style="light" />
          <NavigationGuard />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#000000' }
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(auth)" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="spot-you"
              options={{
                headerShown: false,
                presentation: 'card',
                animation: 'slide_from_right'
              }}
            />
            <Stack.Screen name="coach/[id]" />
            <Stack.Screen name="booking/[id]" />
            <Stack.Screen name="booking/success" />
            <Stack.Screen name="admin/index" />
            <Stack.Screen
              name="set-location"
              options={{
                headerShown: false,
                presentation: 'modal',
                animation: 'slide_from_bottom'
              }}
            />
            <Stack.Screen name="create-service" />
            <Stack.Screen name="spot-me" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="saved" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="events" options={{ headerShown: false, animation: 'slide_from_right' }} />
          </Stack>
        </LocationProvider>
      </LanguageProvider>
      </RefreshProvider>
    </AuthProvider>
  );
}
