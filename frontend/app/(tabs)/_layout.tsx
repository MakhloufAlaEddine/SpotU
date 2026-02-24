import { Tabs } from 'expo-router';
import { Colors } from '../../constants/Colors';
import { Text, View, StyleSheet } from 'react-native';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <View style={[styles.icon, focused && styles.iconActive]}>
      <Text style={styles.emoji}>{emoji}</Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: Colors.border,
          borderTopWidth: 1,
          height: 70,
          paddingBottom: 10,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="map" options={{ title: 'Carte', tabBarIcon: ({ focused }) => <TabIcon emoji="🗺️" focused={focused} /> }} />
      <Tabs.Screen name="search" options={{ title: 'Recherche', tabBarIcon: ({ focused }) => <TabIcon emoji="🔍" focused={focused} /> }} />
      <Tabs.Screen name="create" options={{ title: 'Créer', tabBarIcon: ({ focused }) => <TabIcon emoji="➕" focused={focused} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Réservations', tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: { padding: 4, borderRadius: 10 },
  iconActive: { backgroundColor: '#E8F9F1' },
  emoji: { fontSize: 20 },
});
