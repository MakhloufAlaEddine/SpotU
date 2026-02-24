import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="tag-point" options={{ headerShown: false, title: '' }} />
          <Stack.Screen name="(main)" options={{ headerShown: false }} />
          <Stack.Screen name="coach/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="booking/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="booking/success" options={{ headerShown: false }} />
          <Stack.Screen name="admin/index" options={{ headerShown: false }} />
        </Stack>
      </LanguageProvider>
    </AuthProvider>
  );
}
