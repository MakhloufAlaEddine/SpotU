/**
 * useGuardedRouter — Drop-in replacement for useRouter()
 *
 * Returns the same router object but with `push`, `replace` and
 * `navigate` wrapped in the global synchronous navigation lock.
 * `back`, `canGoBack`, `setParams`, `dismiss` pass through unchanged.
 *
 * Import:
 *   import { useGuardedRouter } from '../hooks/useGuardedRouter';
 *   const router = useGuardedRouter();
 */

import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { guardedNavigate } from '../lib/navGuard';

export function useGuardedRouter() {
  const router = useRouter();

  return useMemo(() => ({
    ...router,
    push: (...args: Parameters<typeof router.push>) =>
      guardedNavigate(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) =>
      guardedNavigate(() => router.replace(...args)),
    navigate: (...args: Parameters<typeof router.navigate>) =>
      guardedNavigate(() => router.navigate(...args)),
  }), [router]);
}
