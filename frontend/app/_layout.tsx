import { Stack } from 'expo-router';
import { AuthProvider } from '../context/AuthContext';
import { LanguageProvider } from '../context/LanguageContext';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <AuthProvider>
      <LanguageProvider>
        <StatusBar style="light" />
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
          <Stack.Screen name="(main)" />
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
      </LanguageProvider>
    </AuthProvider>
  );
}
