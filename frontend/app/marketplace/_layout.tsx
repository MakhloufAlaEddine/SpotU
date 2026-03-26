import { Stack } from 'expo-router';

export default function MarketplaceLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        gestureEnabled: true,
        gestureDirection: 'horizontal',
      }}
    >
      <Stack.Screen name="[spotYouId]" options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="product-detail" options={{ animation: 'slide_from_right' }} />
    </Stack>
  );
}
