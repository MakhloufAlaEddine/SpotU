import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { storage } from './storage';
import { AppNetworkError, classifyHttpError, classifyFetchError } from './network-error';

/** Hôte du packager (ex. 192.168.1.12) — même LAN que le téléphone pour le dev. */
function metroLanHost(): string | null {
  const uri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    (Constants as { manifest?: { debuggerHost?: string } }).manifest?.debuggerHost;
  if (!uri || typeof uri !== 'string') return null;
  const host = uri.split(':')[0]?.trim();
  if (!host || host === 'localhost' || host === '127.0.0.1') return null;
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  return host;
}

/**
 * Sur téléphone réel (iOS / Android), 127.0.0.1 = l’appareil, pas le Mac : on remplace par
 * l’IP LAN du Mac (celle de Metro) quand EXPO_PUBLIC_BACKEND_URL pointe vers loopback.
 * Le simulateur iOS garde souvent 127.0.0.1 vers le Mac ; remplacer par l’IP LAN reste valide.
 * Le web en local laisse localhost inchangé.
 */
function resolveBackendBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const noTrail = trimmed.replace(/\/$/, '');
  if (!__DEV__ || Platform.OS === 'web') return noTrail;
  if (!/(localhost|127\.0\.0\.1)/i.test(noTrail)) return noTrail;
  const lan = metroLanHost();
  if (!lan) return noTrail;
  return noTrail.replace(/127\.0\.0\.1/gi, lan).replace(/localhost/gi, lan);
}

const BASE_URL = resolveBackendBaseUrl(process.env.EXPO_PUBLIC_BACKEND_URL || '');
const REQUEST_TIMEOUT_MS = 10_000;

async function request<T = any>(
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  if (!BASE_URL) {
    throw new AppNetworkError(
      'unknown',
      'EXPO_PUBLIC_BACKEND_URL est vide. Créez frontend/.env (voir env.sample) : simulateur iOS → http://127.0.0.1:8001 ; émulateur Android → http://10.0.2.2:8001 ; appareil physique → http://<IP_LAN_de_votre_Mac>:8001. Puis redémarrez Metro.',
    );
  }

  const token = await storage.get('spotu_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL.replace(/\/$/, '')}/api${path}`, {
      method,
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const raw = await res.text();
      let detail = `Erreur HTTP ${res.status}${res.statusText ? ` (${res.statusText})` : ''}`;
      if (raw) {
        try {
          const err = JSON.parse(raw) as Record<string, unknown>;
          if (Array.isArray(err.detail)) {
            detail = err.detail
              .map((e: unknown) =>
                typeof e === 'string'
                  ? e
                  : e && typeof e === 'object' && 'msg' in e
                    ? String((e as { msg?: string }).msg)
                    : JSON.stringify(e),
              )
              .join(', ');
          } else if (typeof err.detail === 'string') {
            detail = err.detail;
          } else if (err.detail != null && typeof err.detail === 'object') {
            detail = JSON.stringify(err.detail);
          } else if (typeof err.error === 'string') {
            detail = err.error;
          } else if (typeof err.message === 'string') {
            detail = err.message;
          } else if (err && typeof err === 'object' && Object.keys(err).length > 0) {
            detail = JSON.stringify(err).slice(0, 800);
          }
        } catch {
          const stripped = raw
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          detail = stripped.slice(0, 500) || detail;
        }
      }
      throw classifyHttpError(res.status, detail);
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    // Re-lancer les AppNetworkError telles quelles (HTTP 4xx/5xx)
    if (err instanceof AppNetworkError) throw err;
    // Classifier les erreurs réseau natives (offline, timeout, etc.)
    throw classifyFetchError(err);
  }
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, data?: unknown) => request<T>('POST', path, data),
  put: <T = any>(path: string, data?: unknown) => request<T>('PUT', path, data),
  patch: <T = any>(path: string, data?: unknown) => request<T>('PATCH', path, data),
  delete: <T = any>(path: string) => request<T>('DELETE', path),
};

