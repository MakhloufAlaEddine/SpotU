/**
 * lib/network-error.ts — Classification des erreurs réseau
 *
 * Distingue clairement :
 *  - offline   : réseau indisponible (TypeError: Network request failed / Failed to fetch)
 *  - timeout   : requête annulée après 10 s (AbortError)
 *  - server_error : 5xx
 *  - auth_error   : 401 — NE PAS masquer avec le cache
 *  - forbidden    : 403 — NE PAS masquer avec le cache
 *  - client_error : 4xx autre
 *  - unknown   : tout le reste
 */

export type NetworkErrorType =
  | 'offline'
  | 'timeout'
  | 'server_error'
  | 'auth_error'
  | 'forbidden'
  | 'client_error'
  | 'unknown';

export class AppNetworkError extends Error {
  readonly type: NetworkErrorType;
  readonly statusCode?: number;

  constructor(type: NetworkErrorType, message: string, statusCode?: number) {
    super(message);
    this.name = 'AppNetworkError';
    this.type = type;
    this.statusCode = statusCode;
  }
}

/** Erreurs où le fallback cache est acceptable */
export function shouldFallbackToCache(err: unknown): boolean {
  if (!(err instanceof AppNetworkError)) return true;
  // Ne jamais masquer les erreurs d'authentification/autorisation avec du cache
  return err.type !== 'auth_error' && err.type !== 'forbidden';
}

export function isOfflineOrTimeout(err: unknown): boolean {
  if (err instanceof AppNetworkError) return err.type === 'offline' || err.type === 'timeout';
  return false;
}

/** Erreur 5xx ou indisponibilité serveur (ex. maintenance, base indisponible). */
export function isServerError(err: unknown): boolean {
  return err instanceof AppNetworkError && err.type === 'server_error';
}

/** Crée l'AppNetworkError appropriée à partir d'un code HTTP. */
export function classifyHttpError(status: number, detail?: string): AppNetworkError {
  if (status === 401) return new AppNetworkError('auth_error', detail || 'Non authentifié', status);
  if (status === 403) return new AppNetworkError('forbidden', detail || 'Accès refusé', status);
  if (status >= 500)  return new AppNetworkError('server_error', detail || 'Erreur serveur', status);
  return new AppNetworkError('client_error', detail || 'Requête invalide', status);
}

/** Transforme une erreur native fetch/JS en AppNetworkError. */
export function classifyFetchError(err: unknown): AppNetworkError {
  if (err instanceof AppNetworkError) return err;

  const msg = (err as Error)?.message || '';
  const name = (err as Error)?.name || '';

  if (name === 'AbortError' || msg.includes('aborted')) {
    return new AppNetworkError('timeout', 'La requête a expiré, vérifiez votre connexion');
  }
  if (
    msg.includes('Network request failed') ||
    msg.includes('Failed to fetch') ||
    msg.includes('Network Error') ||
    msg.includes('ERR_NETWORK') ||
    msg.includes('net::ERR')
  ) {
    return new AppNetworkError('offline', 'Connexion indisponible');
  }
  return new AppNetworkError('unknown', msg || 'Erreur inconnue');
}

/** Message utilisateur lisible selon le type d'erreur. */
export function userFacingMessage(err: AppNetworkError): string {
  switch (err.type) {
    case 'offline':       return 'Pas de connexion réseau. Vérifiez votre Wi-Fi ou données mobiles.';
    case 'timeout':       return 'La connexion est trop lente. Réessayez dans un moment.';
    case 'server_error':  return 'Le serveur rencontre un problème. Réessayez plus tard.';
    case 'auth_error':    return 'Session expirée. Reconnectez-vous.';
    case 'forbidden':     return 'Vous n\'avez pas accès à cette ressource.';
    case 'client_error':  return err.message || 'Une erreur est survenue.';
    default:              return 'Une erreur inattendue est survenue.';
  }
}
