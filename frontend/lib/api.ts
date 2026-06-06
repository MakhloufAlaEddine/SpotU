import { storage } from './storage';
import { AppNetworkError, classifyHttpError, classifyFetchError } from './network-error';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
const REQUEST_TIMEOUT_MS = 10_000;

async function request<T = any>(
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const token = await storage.get('spotu_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let detail = 'Une erreur est survenue';
      try {
        const err = await res.json();
        if (Array.isArray(err.detail)) {
          // FastAPI 422 — detail est un tableau d'erreurs de validation
          detail = err.detail.map((e: any) => e.msg || JSON.stringify(e)).join(', ');
        } else if (typeof err.detail === 'string') {
          detail = err.detail;
        } else if (err.detail) {
          detail = JSON.stringify(err.detail);
        } else if (typeof err.error === 'string') {
          // Format maison : {"error": "...", "details": [...]}
          detail = err.error;
        } else if (err.message) {
          detail = err.message;
        }
      } catch {}
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
  delete: <T = any>(path: string, data?: unknown) => request<T>('DELETE', path, data),
};

