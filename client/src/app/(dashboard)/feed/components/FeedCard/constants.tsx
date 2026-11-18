import React from 'react';
import { Heart, Laugh, Lightbulb, Star, ThumbsUp, Trophy } from 'lucide-react';
import type { FeedItem, ReactionType } from '@/services/socialFeedService';

export type ReactionOption = {
  key: ReactionType;
  label: string;
  icon: React.ReactNode;
};

export const reactionOptions: ReactionOption[] = [
  { key: 'like', label: 'Like', icon: <ThumbsUp className="size-4" fill="currentColor" strokeWidth={1.5} /> },
  { key: 'applause', label: 'Applause', icon: <Trophy className="size-4" fill="currentColor" strokeWidth={1.5} /> },
  { key: 'celebrate', label: 'Celebrate', icon: <Star className="size-4" fill="currentColor" strokeWidth={1.5} /> },
  { key: 'love', label: 'Love', icon: <Heart className="size-4" fill="currentColor" strokeWidth={1.5} /> },
  {
    key: 'insightful',
    label: 'Insightful',
    icon: <Lightbulb className="size-4" fill="currentColor" strokeWidth={1.5} />,
  },
  { key: 'funny', label: 'Funny', icon: <Laugh className="size-4" strokeWidth={2} /> },
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
