'use client';

import React from 'react';
import { Spin } from 'antd';
import type { SpinProps } from 'antd';

export type AppLoadingIndicatorProps = {
  /** Shown below (full/inline) or beside (minimal) the mark */
  tip?: React.ReactNode;
  size?: SpinProps['size'];
  /**
   * full = viewport overlay (auth gate, page boot)
   * inline = centered in parent, min-height box (page/section loading)
   * minimal = compact, no wrapper box — drop-in for a bare small `<Spin>` inside
   *   buttons, table cells, or inline text
   */
  variant?: 'full' | 'inline' | 'minimal';
  className?: string;
};

const MARK_SIZE_CLASS = {
  small: 'app-loading-indicator__mark--small',
  default: 'app-loading-indicator__mark--default',
  large: 'app-loading-indicator__mark--large',
} as const;

/**
 * Shared, on-brand loading indicator for auth gates, full-page boot, dashboard
 * sections, and inline spinners. `full`/`inline` render the Aicser mark with a
 * spinning brand-color ring; `minimal` keeps AntD's own dot spinner (already
 * brand-colored via platform-loading.css) for contexts too small for the mark.
 */
export function AppLoadingIndicator({
  tip,
  size,
  variant = 'inline',
  className = '',
}: AppLoadingIndicatorProps) {
  if (variant === 'minimal') {
    return (
      <span
        className={['app-loading-indicator-minimal', className].filter(Boolean).join(' ')}
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Spin size={size ?? 'small'} />
        {tip ? <span className="app-loading-indicator-minimal__tip">{tip}</span> : null}
      </span>
    );
  }

  const resolvedSize = size ?? (variant === 'full' ? 'large' : 'default');
  const markClass = MARK_SIZE_CLASS[resolvedSize as keyof typeof MARK_SIZE_CLASS] ?? MARK_SIZE_CLASS.default;

  const rootClass = [
    'app-loading-indicator',
    variant === 'full' ? 'app-loading-indicator--full' : 'app-loading-indicator--inline',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="status" aria-live="polite" aria-busy="true">
      <div className={`app-loading-indicator__mark ${markClass}`}>
        <span className="app-loading-indicator__ring" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element -- decorative, must render before hydration/auth resolve */}
        <img src="/aiser-logo.png" alt="" className="app-loading-indicator__logo" aria-hidden="true" />
      </div>
      {tip ? <div className="app-loading-indicator__tip">{tip}</div> : null}
    </div>
  );
}

export default AppLoadingIndicator;
