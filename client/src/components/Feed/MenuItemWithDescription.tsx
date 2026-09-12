import React from 'react';

/**
 * Share-menu labels that benefit from a one-line "what this does" under the
 * title (e.g. Share to feed). Shared by DashboardShareMenu and
 * ChartDesignerToolbar rather than duplicated in each.
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
