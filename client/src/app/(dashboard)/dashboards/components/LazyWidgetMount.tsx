'use client';

import React, { useEffect, useRef, useState } from 'react';

type Props = {
  children: React.ReactNode;
  /** Start mounting this far before the tile enters the viewport. */
  rootMargin?: string;
};

/**
 * Defers mounting `children` (the actual chart) until the wrapping tile is
 * within/near the viewport, via IntersectionObserver. The wrapper always
 * fills its parent's size — set by react-grid-layout on the grid item above
 * it — so there is no layout shift when the real chart mounts in its place.
 */
export function LazyWidgetMount({ children, rootMargin = '400px 0px' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isVisible) return;
    const node = containerRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isVisible, rootMargin]);

  return (
    <div ref={containerRef} className="lazy-widget-mount">
      {isVisible ? children : <div className="widget-lazy-placeholder" aria-hidden="true" />}
    </div>
  );
}

export default LazyWidgetMount;
