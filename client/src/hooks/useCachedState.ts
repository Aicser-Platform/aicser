'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { queryClient } from '@/components/Providers/Providers';

const cacheKey = (key: string) => ['page-cache', key];

/** True when this page has been loaded before in this session. */
export function hasCachedState(key: string): boolean {
  return queryClient.getQueryData(cacheKey(key)) !== undefined;
}

/**
 * useState that remembers its value between visits, so a list page shows what it had straight away
 * and refreshes behind it instead of opening on a spinner. Lives in the app's query cache, so it is
 * cleared with it on sign-out. A new `key` (another project) switches to that key's value.
 */
export function useCachedState<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const read = (k: string) => (queryClient.getQueryData<T>(cacheKey(k)) ?? initial) as T;
  const [value, setValue] = useState<T>(() => read(key));
  const latest = useRef(key);

  useEffect(() => {
    if (latest.current === key) return;
    latest.current = key;
    setValue(read(key));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is the empty value, not an input
  }, [key]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        queryClient.setQueryData(cacheKey(key), resolved);
        return resolved;
      });
    },
    [key],
  );
  return [value, set];
}
