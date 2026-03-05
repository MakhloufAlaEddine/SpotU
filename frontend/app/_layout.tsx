import { Stack, useRouter, useSegments, useRootNavigationState } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { RefreshProvider } from '../context/RefreshContext';
import { LanguageProvider } from '../context/LanguageContext';
import { LocationProvider } from '../context/LocationContext';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  registerForPushNotificationsAsync,
  saveTokenToServer,
  setupNotificationResponseHandler,
} from '../lib/push-notifications';

// Empêche le splash natif de disparaître automatiquement
SplashScreen.preventAutoHideAsync();

// Source unique de vérité pour la navigation auth
function NavigationGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const pushTokenRef = useRef<string | null>(null);
  const [splashReady, setSplashReady] = useState(false);

  // Durée minimale du splash : 1.8s pour que l'utilisateur voie le logo
  useEffect(() => {
    const timer = setTimeout(() => setSplashReady(true), 1800);
    return () => clearTimeout(timer);
  }, []);

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
    const cleanup = setupNotificationResponseHandler();
    return cleanup;
  }, [user]);

  useEffect(() => {
    if (Platform.OS === 'web' && !navigationState?.key) return;
    if (loading || !splashReady) return;

    // Cacher le splash screen natif une fois l'auth vérifiée
    SplashScreen.hideAsync();

    const inAuth = segments[0] === '(auth)';
    const atRoot = segments.length === 0;

    if (user && (inAuth || atRoot)) {
      router.replace('/(tabs)/map');
    } else if (!user && !inAuth) {
      router.replace('/(auth)/login');
    }
  }, [navigationState?.key, user, loading, splashReady, segments]);

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
            <Stack.Screen name="booking/confirm" />
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
            <Stack.Screen name="planning" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="saved" options={{ headerShown: false, animation: 'slide_from_right' }} />
            <Stack.Screen name="events" options={{ headerShown: false, animation: 'slide_from_right' }} />
          </Stack>
        </LocationProvider>
      </LanguageProvider>
      </RefreshProvider>
    </AuthProvider>
  );
}
