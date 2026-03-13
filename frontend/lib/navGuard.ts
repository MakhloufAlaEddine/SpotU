/**
 * navGuard.ts — Global synchronous navigation lock
 *
 * Prevents double-navigation caused by rapid multi-taps.
 * Uses a module-level ref (not React state) so the lock is
 * taken synchronously BEFORE the JS event loop yields.
 *
 * Usage:  guardedNavigate(() => router.push('/foo'))
 */

const LOCK_DURATION_MS = 600; // unlock after 600ms max

let _locked = false;
let _timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Execute `fn` only if navigation is not currently locked.
 * The lock is acquired synchronously at the very beginning of the call,
 * before `fn` is invoked, so even two taps arriving in the same
 * microtask queue cannot both pass.
 */
export function guardedNavigate(fn: () => void): void {
  if (_locked) return;          // second tap → silently ignored
  _locked = true;               // lock BEFORE calling fn

  // Clear any previous timer (defensive)
  if (_timer) clearTimeout(_timer);

  // Auto-unlock after LOCK_DURATION_MS
  _timer = setTimeout(() => {
    _locked = false;
    _timer = null;
  }, LOCK_DURATION_MS);

  fn();
}

/** Manually release the lock (e.g. on screen focus). */
export function releaseNavLock(): void {
  _locked = false;
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}

/** Check lock state (for testing). */
export function isNavLocked(): boolean {
  return _locked;
}
