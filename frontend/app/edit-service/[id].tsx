import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { releaseNavLock } from '../../lib/navGuard';

/**
 * Redirect vers create-service en mode édition.
 * Utilise useRouter() directement (pas useGuardedRouter) car c'est
 * un redirect interne — pas un tap utilisateur. On libère aussi le
 * navLock acquis par le tap précédent pour ne pas bloquer la navigation.
 */
export default function EditServiceRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    // Libérer le navLock acquis par le tap "Modifier service"
    releaseNavLock();
    if (id) {
      router.replace(`/create-service?serviceId=${id}` as any);
    } else {
      router.back();
    }
  }, [id]);

  return null;
}
