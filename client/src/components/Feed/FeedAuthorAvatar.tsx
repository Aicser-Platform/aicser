'use client';

import React from 'react';
import { Avatar } from 'antd';
import { useFeedAuthorDisplay } from '@/components/Feed/useFeedAuthorDisplay';
import type { FeedAuthorIdentity } from '@/components/Feed/resolveFeedAuthorDisplay';

type FeedAuthorAvatarProps = {
  author?: FeedAuthorIdentity | null;
  size?: number;
  className?: string;
  /** Override initial letter (e.g. when label is "You"). */
  initial?: string;
};

/** Avatar that stays in sync with the live profile for the signed-in author. */
export function FeedAuthorAvatar({ author, size = 32, className, initial }: FeedAuthorAvatarProps) {
  const { avatarUrl, name } = useFeedAuthorDisplay(author);
  const letter = (initial || name || '?').charAt(0).toUpperCase();
  return (
    <Avatar size={size} src={avatarUrl} className={className}>
      {letter}
    </Avatar>
  );
}
