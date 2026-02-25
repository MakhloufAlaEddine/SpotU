import { View, ActivityIndicator } from 'react-native';
import { Colors } from '../constants/Colors';

// Le NavigationGuard dans _layout.tsx gère toute la logique de redirection.
// Cet écran sert uniquement de splash pendant le chargement initial.
export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
      testID="loading-screen"
    >
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}
