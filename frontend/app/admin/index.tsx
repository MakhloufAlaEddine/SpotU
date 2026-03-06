import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../constants/Colors';

export default function AdminScreen() {
  const { user } = useAuth();
  const router = useRouter();

  if (user?.role !== 'admin') {
    router.back();
    return null;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.center}>
        <Text style={styles.title}>Dashboard Admin</Text>
        <Text style={styles.sub}>En construction</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title:  { fontSize: 22, fontWeight: '700', color: Colors.foreground },
  sub:    { fontSize: 14, color: Colors.muted },
});
