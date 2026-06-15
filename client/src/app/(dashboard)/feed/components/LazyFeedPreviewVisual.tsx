'use client';

import React, { useEffect, useRef, useState } from 'react';
import type { FeedItem } from '@/services/socialFeedService';
import FeedPreviewVisual from './FeedPreviewVisual';

type LazyFeedPreviewVisualProps = {
  item: FeedItem;
  maxPreviews?: number;
  showOverflowBadge?: boolean;
};

const LazyFeedPreviewVisual: React.FC<LazyFeedPreviewVisualProps> = ({
  item,
  maxPreviews,
  showOverflowBadge = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (shouldRender) return;
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldRender(true);
        observer.disconnect();
      },
      { rootMargin: '500px 0px' }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [shouldRender]);

  return (
    <div ref={containerRef} className="min-h-[420px] w-full">
      {shouldRender ? (
        <FeedPreviewVisual item={item} maxPreviews={maxPreviews} showOverflowBadge={showOverflowBadge} />
      ) : (
        <div className="h-[420px] w-full animate-pulse rounded-xl bg-[var(--ant-color-fill-quaternary)]" />
      )}
    </div>
  );
};

export default LazyFeedPreviewVisual;
