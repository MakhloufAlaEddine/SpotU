/**
 * Tests for navGuard — the synchronous navigation lock
 */
import { guardedNavigate, releaseNavLock, isNavLocked } from '../lib/navGuard';

describe('navGuard', () => {
  beforeEach(() => {
    releaseNavLock(); // clean state
  });

  test('first call executes the function', () => {
    const fn = jest.fn();
    guardedNavigate(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('second call within lock window is blocked', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    guardedNavigate(fn1);
    guardedNavigate(fn2); // should be blocked
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(0);
  });

  test('triple rapid tap only executes once', () => {
    const fn = jest.fn();
    guardedNavigate(fn);
    guardedNavigate(fn);
    guardedNavigate(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('isNavLocked returns true while locked', () => {
    expect(isNavLocked()).toBe(false);
    guardedNavigate(() => {});
    expect(isNavLocked()).toBe(true);
  });

  test('releaseNavLock manually unlocks', () => {
    guardedNavigate(() => {});
    expect(isNavLocked()).toBe(true);
    releaseNavLock();
    expect(isNavLocked()).toBe(false);
  });

  test('after manual unlock, navigation works again', () => {
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    guardedNavigate(fn1);
    releaseNavLock();
    guardedNavigate(fn2);
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test('auto-unlock after timeout', () => {
    jest.useFakeTimers();
    const fn1 = jest.fn();
    const fn2 = jest.fn();
    guardedNavigate(fn1);
    // Still locked at 500ms
    jest.advanceTimersByTime(500);
    guardedNavigate(fn2);
    expect(fn2).toHaveBeenCalledTimes(0);
    // Unlocked at 600ms
    jest.advanceTimersByTime(200);
    guardedNavigate(fn2);
    expect(fn2).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('lock is synchronous — taken before fn executes', () => {
    const order: string[] = [];
    guardedNavigate(() => {
      order.push('fn1');
      // Simulate a synchronous re-entrant call (edge case)
      guardedNavigate(() => order.push('fn2'));
    });
    expect(order).toEqual(['fn1']); // fn2 is blocked
  });
});
