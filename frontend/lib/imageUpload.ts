/**
 * imageUpload.ts — utilitaire partagé pour l'upload d'images vers R2
 * Utilisé par : create.tsx (SpotYou), products/create.tsx, etc.
 */
import { Platform } from 'react-native';

export async function uploadImage(
  uri: string,
  token: string,
  category: 'spotyou' | 'products' | 'services' | 'profiles' | 'chats' = 'other',
): Promise<string | null> {
  try {
    const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
    const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', gif: 'image/gif',
      webp: 'image/webp', heic: 'image/heic', heif: 'image/heic',
    };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    if (Platform.OS === 'web') {
      let blob: Blob;
      try {
        const blobRes = await fetch(uri);
        blob = await blobRes.blob();
      } catch {
        return null;
      }
      const file = new File([blob], `photo.${ext}`, { type: blob.type || mimeType });
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${BASE_URL}/api/upload-image?category=${category}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) return null;
      return (await res.json()).url || null;
    }

    // Native iOS/Android
    const formData = new FormData();
    formData.append('file', { uri, name: `photo.${ext}`, type: mimeType } as any);
    const res = await fetch(`${BASE_URL}/api/upload-image?category=${category}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) return null;
    return (await res.json()).url || null;
  } catch {
    return null;
  }
}
