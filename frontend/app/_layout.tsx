import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { LocationProvider } from '../context/LocationContext';
import { StatusBar } from 'expo-status-bar';

// Source unique de vérité pour la navigation auth
// Ce composant est le SEUL endroit où la redirection login <-> app est décidée
function NavigationGuard() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    console.log('[NavigationGuard] fired: loading=', loading, 'user=', user?.email ?? null, 'segments=', JSON.stringify(segments));
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    const atRoot = segments.length === 0;

    console.log('[NavigationGuard] inAuth=', inAuth, 'atRoot=', atRoot, '→ segments[0]=', segments[0]);

    if (user && (inAuth || atRoot)) {
      // Connecté mais sur page auth ou racine → aller vers l'app
      console.log('[NavigationGuard] → replace to /map');
      router.replace('/(tabs)/map');
    } else if (!user && !inAuth) {
      // Non connecté et hors pages auth → aller vers login
      console.log('[NavigationGuard] → replace to /login');
      router.replace('/(auth)/login');
    }
  }, [user, loading, segments]);

  return null;
}

export default function RootLayout() {
  return (
    <AuthProvider>
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
              name="tag-point"
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
          </Stack>
        </LocationProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}
