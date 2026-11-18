'use client';

import React from 'react';
import { Skeleton } from '@/components/aicser-ui/skeleton';

interface FeedCardSkeletonProps {
  compact?: boolean;
}

/** Placeholder for a post card while the feed loads (same shape as FeedGridCard). */
const FeedCardSkeleton: React.FC<FeedCardSkeletonProps> = () => (
  <div className="pointer-events-none flex w-full flex-col gap-4 rounded-xl border bg-card p-4" aria-hidden>
    <div className="flex items-center gap-3">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
    <Skeleton className="h-4 w-3/5" />
    <Skeleton className="aspect-[16/9] w-full rounded-lg" />
    <div className="flex gap-2">
      <Skeleton className="h-7 w-16" />
      <Skeleton className="h-7 w-12" />
      <Skeleton className="ml-auto h-7 w-16" />
    </div>
  </div>
);

export default FeedCardSkeleton;
