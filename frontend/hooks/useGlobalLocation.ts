/**
 * Hook de compatibilité — délègue au LocationContext.
 * Tous les écrans qui utilisent useGlobalLocation() obtiennent
 * automatiquement les mises à jour en temps réel via le contexte React.
 */
import { useLocation } from '../context/LocationContext';

export type { GlobalLocation } from '../context/LocationContext';

export function useGlobalLocation() {
  return useLocation();
}
