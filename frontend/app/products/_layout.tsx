import { Stack } from 'expo-router';

export default function ProductsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, gestureEnabled: true, gestureDirection: 'horizontal' }}>
      <Stack.Screen name="create"      options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="my-products" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
