import { Stack } from 'expo-router';
import { Platform } from 'react-native';

export default function SpotYouLayout() {
  return (
    <Stack 
      screenOptions={{ 
        headerShown: false,
        header: () => null,
        contentStyle: Platform.OS === 'web' ? { marginTop: 0 } : undefined,
      }} 
    />
  );
}
