import React from 'react';
import { BulbFilled, HeartFilled, LikeFilled, SmileFilled, StarFilled, TrophyFilled } from '@ant-design/icons';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';

export type ReactionOption = {
  key: ReactionType;
  label: string;
  icon: React.ReactNode;
};

export const reactionOptions: ReactionOption[] = [
  { key: 'like', label: 'Like', icon: <LikeFilled /> },
  { key: 'applause', label: 'Applause', icon: <TrophyFilled /> },
  { key: 'celebrate', label: 'Celebrate', icon: <StarFilled /> },
  { key: 'love', label: 'Love', icon: <HeartFilled /> },
  { key: 'insightful', label: 'Insightful', icon: <BulbFilled /> },
  { key: 'funny', label: 'Funny', icon: <SmileFilled /> },
];

export const COMMENT_CHAR_LIMIT = 500;

export const visibilityColors: Record<FeedItem['visibility'], string> = {
  private: 'default',
  project: 'blue',
  organization: 'geekblue',
  public: 'green',
  following: 'cyan',
};

export const approvalColors: Record<FeedItem['approvalStatus'], string> = {
  draft: 'default',
  pending: 'gold',
  approved: 'green',
  rejected: 'red',
};
