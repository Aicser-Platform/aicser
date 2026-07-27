'use client';

import React from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Button, Tooltip } from 'antd';
import { useTranslations } from 'next-intl';
import { getDrillPath, getInteractionMode } from '../utils/drillDownHelpers';
import { hasDrillThrough } from '../utils/drillThroughHelpers';
import type { WidgetInstance } from '../stores/useDashboardStore';

/** KPI / chrome widgets never show drill interaction chrome. */
const HINT_EXCLUDED = new Set(['stat', 'gauge', 'text', 'divider', 'image', 'slicer', 'filter']);

export function WidgetInteractionHint({ widget }: { widget: WidgetInstance }) {
  const t = useTranslations('dashboards');
  if (HINT_EXCLUDED.has(widget.chartType)) return null;

  const drillPath = getDrillPath(widget);
  const mode = getInteractionMode(widget);
  const drillThrough = hasDrillThrough(widget);

  if (!drillPath.length && !drillThrough && mode === 'cross_filter') {
    return null;
  }

  if (drillPath.length || drillThrough) {
    const lines = [
      drillThrough ? t('hint_drill_through') : t('hint_drill_down'),
      t('hint_shift_cross_filter'),
    ];
    const title = lines.join('\n');
    return (
      <div className="widget-interaction-hint-wrap no-drag">
        <Tooltip
          title={<span style={{ whiteSpace: 'pre-line' }}>{title}</span>}
          placement="left"
          mouseEnterDelay={0.2}
        >
          <Button
            type="text"
            size="small"
            icon={<InfoCircleOutlined />}
            className="widget-interaction-hint-btn"
            aria-label={t('interaction_hint_aria')}
          />
        </Tooltip>
      </div>
    );
  }

  return null;
}
