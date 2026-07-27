'use client';

import React from 'react';
import { Steps, Typography } from 'antd';
import { CheckCircleOutlined } from '@ant-design/icons';
import { isContentWidgetType, isControlWidgetType } from './widgetPropertyProfile';
import { useTranslations } from 'next-intl';
import type { WidgetInstance } from '../stores/useDashboardStore';

type Props = {
  widget: WidgetInstance | null;
  onFocusSection?: (section: 'dataSource' | 'table' | 'fields' | 'style') => void;
};

export function PropertiesSetupSteps({ widget, onFocusSection }: Props) {
  const t = useTranslations('dashboards');

  if (!widget || isContentWidgetType(widget.chartType)) return null;

  const isSlicer = isControlWidgetType(widget.chartType);
  const hasSource = Boolean(widget.dataSourceId || (widget.chartQuery as { dataSourceId?: string })?.dataSourceId);
  const hasSavedQuery = Boolean((widget.chartQuery as { saved_query_id?: unknown })?.saved_query_id);
  const hasSampleSql = Boolean(
    typeof widget.chartOptions?.sample_sql === 'string' && widget.chartOptions.sample_sql.trim(),
  );
  const hasSqlDataset = hasSavedQuery || hasSampleSql;
  const hasTable = Boolean(widget.chartQuery?.tableName) || hasSqlDataset;
  const hasFields = Boolean(
    (widget.chartQuery as { field?: string })?.field ||
      widget.chartQuery?.x ||
      widget.chartQuery?.yMetrics?.length ||
      widget.chartQuery?.aggregate ||
      hasSqlDataset
  );
  const hasStyle = Boolean(widget.chartOptions && Object.keys(widget.chartOptions).length > 0);

  const current = isSlicer
    ? !hasSource
      ? 0
      : !hasFields
        ? 1
        : 2
    : !hasSource
      ? 0
      : !hasTable
        ? 1
        : !hasFields
          ? 2
          : hasStyle
            ? 4
            : 3;

  const items = isSlicer
    ? [
        { title: t('setup_step_source'), status: hasSource ? 'finish' : current === 0 ? 'process' : 'wait' },
        { title: t('slicer_filter_field'), status: hasFields ? 'finish' : current === 1 ? 'process' : 'wait' },
      ]
    : [
        { title: t('setup_step_source'), status: hasSource ? 'finish' : current === 0 ? 'process' : 'wait' },
        { title: t('setup_step_table'), status: hasTable ? 'finish' : current === 1 ? 'process' : 'wait' },
        { title: t('setup_step_fields'), status: hasFields ? 'finish' : current === 2 ? 'process' : 'wait' },
        { title: t('setup_step_style'), status: hasStyle ? 'finish' : current === 3 ? 'process' : 'wait' },
      ];

  return (
    <div style={{ marginBottom: 12 }}>
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 6 }}>
        <CheckCircleOutlined style={{ marginRight: 4 }} />
        {t('setup_progress_hint')}
      </Typography.Text>
      <Steps
        size="small"
        current={Math.min(current, isSlicer ? 1 : 3)}
        items={items.map((item, idx) => ({
          ...item,
          onClick: () => {
            if (isSlicer) {
              onFocusSection?.(idx === 0 ? 'dataSource' : 'fields');
              return;
            }
            const sections: Array<'dataSource' | 'table' | 'fields' | 'style'> = [
              'dataSource',
              'table',
              'fields',
              'style',
            ];
            onFocusSection?.(sections[idx]);
          },
          style: { cursor: onFocusSection ? 'pointer' : undefined },
        }))}
      />
    </div>
  );
}

export default PropertiesSetupSteps;
