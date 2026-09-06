'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * True once the returned ref's element has appeared in the viewport at
 * least once, and stays true afterward - a one-shot "has it been seen" gate,
 * not a toggling visibility tracker (so mounting the gated content doesn't
 * unmount/remount and re-fetch every time it scrolls past the edge).
 *
 * For deferring expensive, DB-querying embeds (live dashboard/chart
 * previews) until they're actually about to be shown, instead of every card
 * on a feed page firing its fetch simultaneously on load - the same
 * lazy-embed pattern LinkedIn/Twitter/Facebook use for rich content in a
 * feed. `rootMargin` starts the fetch slightly before the element is
 * actually on-screen so it's ready by the time the user scrolls to it.
 */
export function useLazyVisible<T extends HTMLElement>(rootMargin = '300px') {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, rootMargin]);

  return { ref, visible };
}

export default useLazyVisible;
