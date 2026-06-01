'use client';

import React from 'react';
import { Tag } from 'antd';
import { useTranslations } from 'next-intl';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';
import { getWidgetSetupIssues } from '../utils/widgetSetupStatus';

type Props = {
  widget: WidgetInstance | null;
  chartTypeLabel?: string;
};

export function WidgetInspectorHeader({ widget, chartTypeLabel }: Props) {
  const t = useTranslations('properties_panel');
  const td = useTranslations('dashboards_page');
  const issues = getWidgetSetupIssues(widget);

  if (!widget) return null;

  return (
    <header className="widget-inspector-header">
      <p className="widget-inspector-header-title">
        {widget.title?.trim() || chartTypeLabel || widget.chartType}
      </p>
      {issues.length > 0 ? (
        <ul className="widget-inspector-issues">
          {issues.map((issue) => (
            <li key={issue.key}>{td(issue.messageKey as 'setup_missing_source')}</li>
          ))}
        </ul>
      ) : (
        <Tag color="success" bordered={false} style={{ fontSize: 11 }}>
          {t('setup_complete')}
        </Tag>
      )}
    </header>
  );
}

export default WidgetInspectorHeader;
