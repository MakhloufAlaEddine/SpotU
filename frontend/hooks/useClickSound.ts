/**
 * useClickSound
 * ─────────────
 * Charge le son de clic une seule fois par montage de composant
 * et expose playClickSound() + triggerHaptic().
 *
 * - Le son est déchargé automatiquement au démontage (pas de fuite mémoire).
 * - Si le son ou le haptic échoue, l'action principale n'est PAS bloquée.
 * - expo-av est chargé en **lazy** dans useEffect : un `import` en tête de fichier
 *   provoque « Cannot find native module 'ExponentAV' » sur certains Expo Go
 *   (SDK désaligné, New Architecture, etc.) et fait planter tout l’écran.
 */

import { useEffect, useRef, useCallback } from 'react';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const CLICK_SOUND = require('../assets/sounds/click.wav');

type SoundLike = {
  unloadAsync: () => Promise<void>;
  setPositionAsync: (positionMillis: number) => Promise<void>;
  playAsync: () => Promise<void>;
};

export function useClickSound() {
  const soundRef = useRef<SoundLike | null>(null);

  useEffect(() => {
    let mounted = true;
    let Audio: typeof import('expo-av').Audio | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Audio = require('expo-av').Audio;
    } catch {
      return () => {
        mounted = false;
      };
    }

    (async () => {
      try {
        await Audio!.setAudioModeAsync({
          playsInSilentModeIOS: false,
          allowsRecordingIOS: false,
        });
        const { sound } = await Audio!.Sound.createAsync(CLICK_SOUND, {
          volume: 0.5,
          shouldPlay: false,
        });
        if (mounted) soundRef.current = sound;
      } catch {
        // Son non disponible → dégradation silencieuse
      }
    })();

    return () => {
      mounted = false;
      soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, []);

  /** Joue le clic sonore + haptic léger. Ne bloque jamais l'appelant. */
  const playClickSound = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    if (soundRef.current) {
      try {
        await soundRef.current.setPositionAsync(0);
        await soundRef.current.playAsync();
      } catch {
        // Silencieux si la lecture échoue
      }
    }
  }, []);

  return { playClickSound };
}
