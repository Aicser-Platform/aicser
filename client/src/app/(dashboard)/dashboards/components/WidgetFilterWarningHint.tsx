'use client';

import React from 'react';
import { WarningOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import type { WidgetInstance } from '../stores/useDashboardStore';

/**
 * Small, non-blocking indicator for widget.filterWarnings — e.g. a dashboard
 * filter silently replacing this widget's own saved filter on the same
 * field (see server's detect_filter_overrides). Mirrors
 * WidgetInteractionHint's icon+tooltip pattern; chartData is still valid and
 * rendered normally, so this is a hint, not an error state.
 */
export function WidgetFilterWarningHint({ widget }: { widget: WidgetInstance }) {
  const warnings = widget.filterWarnings;
  if (!warnings || warnings.length === 0) return null;

  const title = warnings.join('\n');
  return (
    <div className="widget-filter-warning-hint-wrap no-drag">
      <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{title}</span>} placement="left" mouseEnterDelay={0.2}>
        <Button
          type="text"
          size="small"
          icon={<WarningOutlined />}
          className="widget-filter-warning-hint-btn"
          aria-label={title}
        />
      </Tooltip>
    </div>
  );
}
