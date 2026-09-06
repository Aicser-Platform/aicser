import React from 'react';

/**
 * Two menu items that both end up "in the feed" (Publish / Share to Feed vs.
 * Attach to a new post) read as near-duplicates of each other from their
 * label alone - a one-line label doesn't say why you'd pick one over the
 * other. Pairing each with its own short "what this actually does" line
 * directly in the dropdown item (not a tooltip someone has to hover to find)
 * is a more effective disambiguation. Shared by DashboardShareMenu and
 * ChartDesignerToolbar's share menus rather than duplicated in each.
 */
export function menuItemWithDescription(label: string, description: string) {
  return (
    <div className="flex flex-col leading-tight py-0.5">
      <span>{label}</span>
      <span className="text-xs" style={{ color: 'var(--ant-color-text-tertiary)' }}>
        {description}
      </span>
    </div>
  );
}
