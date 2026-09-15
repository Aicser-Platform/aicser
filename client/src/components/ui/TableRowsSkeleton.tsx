'use client';

import React from 'react';

export interface TableRowsSkeletonProps {
  /** Number of skeleton columns. */
  columns?: number;
  /** Number of skeleton body rows. */
  rows?: number;
  /** Render a header row above the body rows. */
  showHeader?: boolean;
}

const DEFAULT_WIDTHS = [22, 15, 30, 12, 20, 16, 24, 14];

/**
 * Row-shaped loading placeholder that mirrors an eventual data table's
 * layout (header + N rows of cells) instead of a bare centered spinner.
 * Same approach as FeedCardSkeleton: CSS-var-driven blocks + Tailwind's
 * `animate-pulse`, so it tracks the active theme automatically.
 */
export const TableRowsSkeleton: React.FC<TableRowsSkeletonProps> = ({
  columns = 6,
  rows = 8,
  showHeader = true,
}) => {
  const widths = Array.from({ length: Math.max(1, columns) }, (_, i) => DEFAULT_WIDTHS[i % DEFAULT_WIDTHS.length]);

  return (
    <div className="w-full animate-pulse" aria-hidden="true">
      {showHeader && (
        <div className="flex items-center gap-4 px-3 py-2 border-b border-[var(--ant-color-border)]">
          {widths.map((w, i) => (
            <div
              key={`h-${i}`}
              className="bg-[var(--ant-color-border-secondary)] rounded shrink-0"
              style={{ width: `${w}%`, height: 12 }}
            />
          ))}
        </div>
      )}
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={`r-${r}`}
          className="flex items-center gap-4 px-3 py-2.5 border-b border-[var(--ant-color-border-secondary)]"
        >
          {widths.map((w, i) => (
            <div
              key={`r-${r}-c-${i}`}
              className="bg-[var(--ant-color-border-secondary)]/70 rounded shrink-0"
              style={{ width: `${Math.max(8, w - ((r + i) % 3) * 4)}%`, height: 11 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default TableRowsSkeleton;
