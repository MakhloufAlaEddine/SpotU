/**
 * Gestion des push notifications Expo (iOS + Android).
 * - Demande la permission
 * - Récupère le token Expo
 * - Enregistre le token sur le serveur
 * - Configure les listeners de navigation
 */
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import { api } from './api';
import { guardedNavigate } from './navGuard';

// Configuration globale du comportement des notifications reçues en avant-plan
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Demande la permission et récupère le token Expo Push.
 * Retourne null si la permission est refusée ou si ce n'est pas un device physique.
 */
export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('[Push] Notifications non disponibles sur simulateur');
    return null;
  }

  // Canal Android (obligatoire pour Android 8+)
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'SpotU',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF6B35',
      sound: 'default',
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[Push] Permission refusée');
    return null;
  }

  try {
    // Récupère le projectId depuis la config EAS si disponible
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();

    return tokenData.data;
  } catch (e) {
    console.warn('[Push] Impossible de récupérer le token:', e);
    return null;
  }
}

/**
 * Enregistre le token sur le backend.
 */
export async function saveTokenToServer(token: string): Promise<void> {
  try {
    await api.post('/users/push-token', { token, platform: 'expo' });
    console.log('[Push] Token enregistré:', token.slice(0, 30) + '...');
  } catch (e) {
    console.warn('[Push] Erreur enregistrement token:', e);
  }
}

/**
 * Supprime le token du serveur (lors de la déconnexion).
 */
export async function removeTokenFromServer(token: string): Promise<void> {
  try {
    await api.delete('/users/push-token', { token });
  } catch {}
}

/**
 * Configure le listener de tap sur notification → navigation.
 * Retourne la fonction de cleanup.
 */
export function setupNotificationResponseHandler(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as any;
    if (!data?.type) return;

    switch (data.type) {
      case 'chat_message':
        if (data.conversationId) {
          guardedNavigate(() => router.push(`/chat/${data.conversationId}`));
        }
        break;
      case 'new_booking':
      case 'booking_status':
        guardedNavigate(() => router.push('/bookings'));
        break;
      // ── Produits ────────────────────────────────────────────────────────────
      case 'product_rejected':
        if (data.product_id) {
          guardedNavigate(() =>
            router.push(`/products/create?productId=${data.product_id}&mode=edit` as any)
          );
        } else {
          guardedNavigate(() => router.push('/products/my-products' as any));
        }
        break;
      case 'product_approved':
        guardedNavigate(() => router.push('/products/my-products' as any));
        break;
      case 'admin_product_pending':
      case 'admin_product_reminder':
        guardedNavigate(() => router.push('/admin?tab=products' as any));
        break;
    }
  });

  return () => subscription.remove();
}
