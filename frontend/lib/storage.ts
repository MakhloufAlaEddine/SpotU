/**
 * Couche de stockage unifiée — SpotU
 * ====================================
 * [SEC-02] Migration du stockage du token JWT :
 *   - Native (iOS/Android) : expo-secure-store (chiffré dans le Secure Enclave / Keystore)
 *                            Remplace AsyncStorage (non chiffré, lisible par
 *                            toute app avec accès root ou backup non chiffré).
 *   - Web               : localStorage (fallback inchangé — pas de Secure Enclave côté web)
 *
 * L'API publique (get/set/remove) est identique à l'ancienne implémentation :
 * aucun autre fichier (api.ts, AuthContext.tsx, chat.ts) n'a besoin d'être modifié.
 */
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// [SEC-02] Accessibilité keychain : lisible dès le premier déverrouillage,
// sans exiger d'interaction biométrique à chaque appel (évite "User interaction is not allowed")
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

export const storage = {
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { localStorage.setItem(key, value); } catch {}
    } else {
      await SecureStore.setItemAsync(key, value, KEYCHAIN_OPTIONS);
    }
  },

  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    return SecureStore.getItemAsync(key, KEYCHAIN_OPTIONS);
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { localStorage.removeItem(key); } catch {}
    } else {
      await SecureStore.deleteItemAsync(key, KEYCHAIN_OPTIONS);
    }
  },
};
