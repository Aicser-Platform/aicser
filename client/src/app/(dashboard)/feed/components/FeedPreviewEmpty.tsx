'use client';

import React from 'react';
import { Empty } from 'antd';

interface FeedPreviewEmptyProps {
  /** Primary message (already translated by the caller). */
  label: string;
  /** Optional secondary hint line. */
  hint?: string;
}

/**
 * Professional placeholder for feed card previews that have nothing to render.
 * antd `Empty` for the visual, Tailwind for layout — never a blank box.
 */
export const FeedPreviewEmpty: React.FC<FeedPreviewEmptyProps> = ({ label, hint }) => (
  <div className="w-full h-full min-h-[180px] flex items-center justify-center px-6 py-8">
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-sm font-medium text-[var(--ant-color-text-secondary)]">{label}</span>
          {hint ? <span className="text-xs text-[var(--ant-color-text-tertiary)]">{hint}</span> : null}
        </div>
      }
    />
  </div>
);

export default FeedPreviewEmpty;
