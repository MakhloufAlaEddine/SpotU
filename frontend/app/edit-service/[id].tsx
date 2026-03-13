import { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useGuardedRouter } from '../../hooks/useGuardedRouter';

/**
 * Redirect to the shared create-service screen with serviceId param.
 * The create-service screen handles both create and edit modes.
 */
export default function EditServiceRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useGuardedRouter();

  useEffect(() => {
    if (id) {
      router.replace(`/create-service?serviceId=${id}` as any);
    } else {
      router.back();
    }
  }, [id]);

  return null;
}
