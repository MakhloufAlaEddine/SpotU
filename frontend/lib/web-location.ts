import { Platform } from 'react-native';

/** Sur RN (Hermes), `window` peut exister sans `window.location`. */
export function getWebLocation(): Location | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  return window.location ?? null;
}
