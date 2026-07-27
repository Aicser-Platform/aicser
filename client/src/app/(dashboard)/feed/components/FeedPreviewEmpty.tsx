'use client';

import React from 'react';
import { Empty, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

interface FeedPreviewEmptyProps {
  /** Primary message (already translated by the caller). */
  label: string;
  /** Optional secondary hint line. */
  hint?: string;
  /** Smaller footprint for grid cards — avoids a tall, conspicuously blank box. */
  compact?: boolean;
  /** When set, shows a Retry button — use only for an actual fetch failure, not a
   *  legitimate "nothing to preview" state where retrying wouldn't change anything. */
  onRetry?: () => void;
}

/**
 * Professional placeholder for feed card previews that have nothing to render.
 * antd `Empty` for the visual, Tailwind for layout — never a blank box.
 */
export const FeedPreviewEmpty: React.FC<FeedPreviewEmptyProps> = ({ label, hint, compact = false, onRetry }) => (
  <div
    className={`w-full h-full flex items-center justify-center px-6 ${compact ? 'min-h-[100px] py-3 scale-90' : 'min-h-[180px] py-8'}`}
  >
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-sm font-medium text-[var(--ant-color-text-secondary)]">{label}</span>
          {hint ? <span className="text-xs text-[var(--ant-color-text-tertiary)]">{hint}</span> : null}
          {onRetry ? (
            <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      }
    />
  </div>
);

export default FeedPreviewEmpty;
