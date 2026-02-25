import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { storage } from '../lib/storage';

export interface GlobalLocation {
  lat: number;
  lng: number;
  address: string;
  isGPS: boolean;
}

const DEFAULT: GlobalLocation = {
  lat: 48.8566,
  lng: 2.3522,
  address: 'Paris, France',
  isGPS: false,
};

interface LocationContextValue {
  location: GlobalLocation;
  loading: boolean;
  setLocation: (loc: GlobalLocation) => Promise<void>;
  refreshGPS: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue>({
  location: DEFAULT,
  loading: true,
  setLocation: async () => {},
  refreshGPS: async () => {},
});

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<GlobalLocation>(DEFAULT);
  const [loading, setLoading] = useState(true);
  // Vrai si l'utilisateur a manuellement choisi une localisation dans la session
  const [userOverride, setUserOverride] = useState(false);

  // Au démarrage : toujours utiliser le GPS (pas de persistance entre sessions)
  useEffect(() => {
    tryGPS();
  }, []);

  const tryGPS = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
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
        const gpsLoc: GlobalLocation = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          address,
          isGPS: true,
        };
        setLocationState(gpsLoc);
        setLoading(false);
        return;
      }
    } catch {}
    setLocationState(DEFAULT);
    setLoading(false);
  };

  /**
   * Met à jour la localisation dans le contexte (en mémoire uniquement).
   * La sélection est conservée pour toute la session, mais pas persistée.
   */
  const setLocation = useCallback(async (loc: GlobalLocation) => {
    setLocationState(loc);
    setUserOverride(true);
  }, []);

  /**
   * Rafraîchit le GPS — ignoré si l'utilisateur a déjà choisi une localisation manuellement.
   */
  const refreshGPS = useCallback(async () => {
    if (userOverride) return;
    setLoading(true);
    await tryGPS();
  }, [userOverride]);

  return (
    <LocationContext.Provider value={{ location, loading, setLocation, refreshGPS }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}
