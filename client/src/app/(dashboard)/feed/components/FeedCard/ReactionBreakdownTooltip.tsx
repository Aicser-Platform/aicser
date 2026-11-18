import React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/aicser-ui/tooltip';
import type { ReactionType } from '@/services/socialFeedService';
import { reactionOptions } from './constants';

interface ReactionBreakdownTooltipProps {
  breakdown?: Partial<Record<ReactionType, number>>;
  children: React.ReactElement;
}

/** Wraps a reaction count with a hover breakdown by type (e.g. "❤ 2 · 👍 1"). No tooltip when there's nothing
 * to break down. */
const ReactionBreakdownTooltip: React.FC<ReactionBreakdownTooltipProps> = ({ breakdown, children }) => {
  const entries = reactionOptions
    .map((option) => ({ option, count: breakdown?.[option.key] ?? 0 }))
    .filter((entry) => entry.count > 0);

  if (entries.length === 0) return children;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {entries.map(({ option, count }) => (
            <span key={option.key} className="flex items-center gap-1 text-xs [&_svg]:size-3">
              {option.icon}
              <span>{count}</span>
            </span>
          ))}
        </span>
      </TooltipContent>
    </Tooltip>
  );
};

export default ReactionBreakdownTooltip;
