/**
 * useClickSound
 * ─────────────
 * Charge le son de clic une seule fois par montage de composant
 * et expose playClickSound() + triggerHaptic().
 *
 * - Le son est déchargé automatiquement au démontage (pas de fuite mémoire).
 * - Si le son ou le haptic échoue, l'action principale n'est PAS bloquée.
 * - Utilise expo-av pour le son (<120 ms) et expo-haptics pour le retour
 *   tactile léger.
 */

import { useEffect, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const CLICK_SOUND = require('../assets/sounds/click.wav');

export function useClickSound() {
  const soundRef = useRef<Audio.Sound | null>(null);

  // Chargement unique au montage
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: false,   // respecte le mode silencieux iOS
          allowsRecordingIOS: false,
        });
        const { sound } = await Audio.Sound.createAsync(CLICK_SOUND, {
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
    // Haptic en premier (synchrone natif, rapide)
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    // Son : rembobiner au début puis lancer
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
