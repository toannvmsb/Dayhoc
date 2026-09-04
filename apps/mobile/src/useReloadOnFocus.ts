import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';

/**
 * Re-run `reload` every time the screen regains focus — EXCEPT the initial
 * mount (the query already fetched then).
 *
 * The `useFocusEffect` callback is `useCallback(fn, [])` — a permanently stable
 * reference, so the focus listener subscribes exactly once and can never churn
 * or loop on app resume (a churning callback was what froze the app after the
 * SDK 57 upgrade). The latest `reload` is read through a ref.
 */
export function useReloadOnFocus(reload: () => void): void {
  const first = useRef(true);
  const fn = useRef(reload);
  fn.current = reload;

  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      fn.current();
    }, []),
  );
}
