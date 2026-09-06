import React from 'react';
import { Tooltip } from 'antd';
import type { ReactionType } from '@/services/socialFeedService';
import { reactionOptions } from './constants';

interface ReactionBreakdownTooltipProps {
  breakdown?: Partial<Record<ReactionType, number>>;
  children: React.ReactElement;
}

/** Wraps a reaction count with a hover breakdown by type (e.g. "❤️ 2 · 👍 1") -
 * comments already showed this; the post-level reaction button only ever
 * showed a flat total. No tooltip when there's nothing to break down. */
const ReactionBreakdownTooltip: React.FC<ReactionBreakdownTooltipProps> = ({ breakdown, children }) => {
  const entries = reactionOptions
    .map((option) => ({ option, count: breakdown?.[option.key] ?? 0 }))
    .filter((entry) => entry.count > 0);

  if (entries.length === 0) return children;

  return (
    <Tooltip
      title={
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {entries.map(({ option, count }) => (
            <span key={option.key} className="flex items-center gap-1 text-xs">
              <span className="text-sm leading-none">{option.icon}</span>
              <span>{count}</span>
            </span>
          ))}
        </div>
      }
    >
      {children}
    </Tooltip>
  );
};

export default ReactionBreakdownTooltip;
