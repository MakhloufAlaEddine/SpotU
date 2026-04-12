/**
 * useClickSound
 * ─────────────
 * Charge le son de clic une seule fois par montage de composant
 * et expose playClickSound() + triggerHaptic().
 *
 * - Le lecteur est géré par expo-audio (useAudioPlayer) et libéré au démontage.
 * - Si le son ou le haptic échoue, l'action principale n'est PAS bloquée.
 * - Utilise expo-audio pour le son et expo-haptics pour le retour tactile léger.
 */

import { useEffect, useCallback } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const CLICK_SOUND = require('../assets/sounds/click.wav');

export function useClickSound() {
  const player = useAudioPlayer(CLICK_SOUND);

  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({
          playsInSilentMode: false,
          allowsRecording: false,
          interruptionMode: 'mixWithOthers',
        });
        player.volume = 0.5;
      } catch {
        // Son non disponible → dégradation silencieuse
      }
    })();
  }, [player]);

  const playClickSound = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    try {
      await player.seekTo(0);
      player.play();
    } catch {
      // Silencieux si la lecture échoue
    }
  }, [player]);

  return { playClickSound };
}
