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

  // Charge la localisation sauvegardée au démarrage
  useEffect(() => {
    (async () => {
      try {
        const saved = await storage.get('winek_global_location');
        if (saved) {
          const parsed = JSON.parse(saved);
          setLocationState({ ...parsed, isGPS: false });
          setLoading(false);
          return;
        }
      } catch {}
      // Fallback GPS
      await tryGPS();
    })();
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
   * Met à jour la localisation dans le contexte ET dans le stockage persistant.
   * Appelé depuis SetLocationScreen — met à jour tous les écrans instantanément.
   */
  const setLocation = useCallback(async (loc: GlobalLocation) => {
    // Mise à jour immédiate de l'état React (réactif)
    setLocationState(loc);
    // Persistance pour la prochaine session
    try {
      await storage.set('winek_global_location', JSON.stringify(loc));
    } catch {}
  }, []);

  const refreshGPS = useCallback(async () => {
    setLoading(true);
    await tryGPS();
  }, []);

  return (
    <LocationContext.Provider value={{ location, loading, setLocation, refreshGPS }}>
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  return useContext(LocationContext);
}
