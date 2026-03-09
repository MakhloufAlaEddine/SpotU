/**
 * useBookingConfig — Hook pour lire les flags globaux de fonctionnalités de réservation.
 *
 * Valeurs par défaut MVP :
 *   enable_manual_approval_for_services = false  → réservation directe
 *   enable_pay_later_for_services       = false  → paiement immédiat
 *
 * Le résultat est mis en cache au niveau module pour éviter des appels répétés.
 */
import { useState, useEffect } from 'react';
import { api } from './api';

export interface BookingConfig {
  enable_manual_approval_for_services: boolean;
  enable_pay_later_for_services: boolean;
}

const MVP_DEFAULTS: BookingConfig = {
  enable_manual_approval_for_services: false,
  enable_pay_later_for_services: false,
};

// Cache module-level (valide pour toute la session)
let cachedConfig: BookingConfig | null = null;
let fetchPromise: Promise<BookingConfig> | null = null;

async function loadConfig(): Promise<BookingConfig> {
  if (cachedConfig) return cachedConfig;
  if (fetchPromise) return fetchPromise;

  fetchPromise = api
    .get<BookingConfig>('/config/booking')
    .then((data) => {
      cachedConfig = data;
      fetchPromise = null;
      return data;
    })
    .catch(() => {
      fetchPromise = null;
      return MVP_DEFAULTS;
    });

  return fetchPromise;
}

/** Invalide le cache (à appeler après un PUT /admin/app-config). */
export function invalidateBookingConfig(): void {
  cachedConfig = null;
  fetchPromise = null;
}

/** Hook React — retourne la config active (MVP_DEFAULTS pendant le chargement). */
export function useBookingConfig(): BookingConfig {
  const [config, setConfig] = useState<BookingConfig>(cachedConfig ?? MVP_DEFAULTS);

  useEffect(() => {
    if (!cachedConfig) {
      loadConfig().then(setConfig);
    }
  }, []);

  return config;
}
