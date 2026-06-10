'use client';

import React from 'react';
import { Spin } from 'antd';
import type { SpinProps } from 'antd';

export type AppLoadingIndicatorProps = {
  /** Shown below the spinner */
  tip?: React.ReactNode;
  size?: SpinProps['size'];
  /** full = viewport overlay; inline = centered in parent (pages, cards) */
  variant?: 'full' | 'inline';
  className?: string;
};

/**
 * Shared loading indicator for auth gates, full-page boot, and dashboard sections.
 */
export function AppLoadingIndicator({
  tip,
  size = 'large',
  variant = 'inline',
  className = '',
}: AppLoadingIndicatorProps) {
  const rootClass = [
    'app-loading-indicator',
    variant === 'full' ? 'app-loading-indicator--full' : 'app-loading-indicator--inline',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="status" aria-live="polite" aria-busy="true">
      <Spin size={size} />
      {tip ? <div className="app-loading-indicator__tip">{tip}</div> : null}
    </div>
  );
}
