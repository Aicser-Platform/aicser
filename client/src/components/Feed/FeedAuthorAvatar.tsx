'use client';

import React from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/aicser-ui/avatar';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';
import type { FeedAuthorIdentity } from '@/components/Feed/resolveFeedAuthorDisplay';
import { cn } from '@/lib/ui/utils';

type FeedAuthorAvatarProps = {
  author?: FeedAuthorIdentity | null;
  size?: number;
  className?: string;
  /** Override initial letter (e.g. when label is "You"). */
  initial?: string;
};

/** Avatar that stays in sync with the live profile for the signed-in author (Aicser UI: inside an `.aicser-ui` scope). */
export function FeedAuthorAvatar({ author, size = 32, className, initial }: FeedAuthorAvatarProps) {
  const { avatarUrl, name } = useFeedAuthorDisplay(author);
  const letter = (initial || name || '?').charAt(0).toUpperCase();
  return (
    <Avatar className={cn('shrink-0', className)} style={{ width: size, height: size }}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
      <AvatarFallback
        className="bg-secondary font-medium text-secondary-foreground"
        style={{ fontSize: Math.max(10, size * 0.4) }}
      >
        {letter}
      </AvatarFallback>
    </Avatar>
  );
}
