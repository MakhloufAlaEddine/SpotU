import { storage } from './storage';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

async function request<T = any>(
  method: string,
  path: string,
  data?: unknown,
): Promise<T> {
  const token = await storage.get('winek_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

  if (!res.ok) {
    let detail = 'An error occurred';
    try {
      const err = await res.json();
      detail = err.detail || detail;
    } catch {}
    throw new Error(detail);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  get: <T = any>(path: string) => request<T>('GET', path),
  post: <T = any>(path: string, data?: unknown) => request<T>('POST', path, data),
  put: <T = any>(path: string, data?: unknown) => request<T>('PUT', path, data),
  delete: <T = any>(path: string) => request<T>('DELETE', path),
};
  patch: <T = any>(path: string, data?: unknown) => request<T>('PATCH', path, data),
  del: <T = any>(path: string) => request<T>('DELETE', path),
};
