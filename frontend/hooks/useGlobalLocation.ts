import { useState, useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { storage } from '../lib/storage';

export interface GlobalLocation {
  lat: number;
  lng: number;
  address: string;
  isGPS: boolean;
}

const DEFAULT: GlobalLocation = { lat: 48.8566, lng: 2.3522, address: 'Paris, France', isGPS: false };

export function useGlobalLocation() {
  const [location, setLocation] = useState<GlobalLocation>(DEFAULT);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      // Priorité 1: localisation sauvegardée par l'utilisateur
      const saved = await storage.get('winek_global_location');
      if (saved) {
        const parsed = JSON.parse(saved);
        setLocation({ ...parsed, isGPS: false });
        setLoading(false);
        return;
      }

      // Priorité 2: GPS
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        let address = 'Ma position';
        try {
          const [geo] = await Location.reverseGeocodeAsync({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
          if (geo) {
            address = [geo.city, geo.postalCode].filter(Boolean).join(' ');
          }
        } catch {}
        setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude, address, isGPS: true });
        setLoading(false);
        return;
      }
    } catch {}

    // Fallback: Paris
    setLocation(DEFAULT);
    setLoading(false);
  }, []);

  // Re-lit la localisation à chaque fois que l'écran est mis en avant
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  return { location, loading, refresh };
}
