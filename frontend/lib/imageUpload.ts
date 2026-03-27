/**
 * imageUpload.ts — utilitaire partagé pour l'upload d'images vers R2
 * Utilisé par : create.tsx (SpotYou), products/create.tsx, etc.
 */
import { Platform } from 'react-native';

const MAX_UPLOAD_BYTES = 4.5 * 1024 * 1024; // 4.5 Mo (marge de sécurité par rapport à la limite backend de 5 Mo)

/**
 * Compression canvas côté web — redimensionne à max 2000px + compresse en JPEG.
 * Garantit que le blob envoyé au backend ne dépasse pas la limite de 5 Mo.
 */
async function compressBlobWeb(blob: Blob, maxDim = 2000, quality = 0.75): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxDim || h > maxDim) {
        if (w > h) { h = Math.round((maxDim / w) * h); w = maxDim; }
        else        { w = Math.round((maxDim / h) * w); h = maxDim; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob((compressed) => resolve(compressed || blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

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
      // Compression canvas si > 4.5 Mo (filet de sécurité web — le canvas gère HEIC converti)
      if (blob.size > MAX_UPLOAD_BYTES) {
        blob = await compressBlobWeb(blob);
        // Si toujours trop gros, comprimer davantage
        if (blob.size > MAX_UPLOAD_BYTES) {
          blob = await compressBlobWeb(blob, 1500, 0.6);
        }
      }
      const file = new File([blob], `photo.jpg`, { type: 'image/jpeg' });
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
