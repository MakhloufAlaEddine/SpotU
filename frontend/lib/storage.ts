import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  async set(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { localStorage.setItem(key, value); } catch {}
    } else {
      await AsyncStorage.setItem(key, value);
    }
  },

  async get(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      try { return localStorage.getItem(key); } catch { return null; }
    }
    return AsyncStorage.getItem(key);
  },

  async remove(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      try { localStorage.removeItem(key); } catch {}
    } else {
      await AsyncStorage.removeItem(key);
    }
  },
};
