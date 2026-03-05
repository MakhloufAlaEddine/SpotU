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

export const storage = {
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { localStorage.setItem(key, value); } catch {}
    } else {
      // [SEC-02] Stockage chiffré via Secure Enclave (iOS) ou Android Keystore
      await SecureStore.setItemAsync(key, value);
    }
  },

  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    // [SEC-02] Lecture depuis le stockage chiffré
    return SecureStore.getItemAsync(key);
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { localStorage.removeItem(key); } catch {}
    } else {
      // [SEC-02] Suppression depuis le stockage chiffré
      await SecureStore.deleteItemAsync(key);
    }
  },
};
