import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="tag-point/[id]" options={{ headerShown: true, title: 'TagPoint', headerTintColor: '#1DBF73' }} />
          <Stack.Screen name="coach/[id]" options={{ headerShown: true, title: 'Coach', headerTintColor: '#1DBF73' }} />
          <Stack.Screen name="booking/[id]" options={{ headerShown: true, title: 'Réservation', headerTintColor: '#1DBF73' }} />
          <Stack.Screen name="booking/success" options={{ headerShown: false }} />
          <Stack.Screen name="admin/index" options={{ headerShown: true, title: 'Admin', headerTintColor: '#1DBF73' }} />
        </Stack>
      </LanguageProvider>
    </AuthProvider>
  );
}
