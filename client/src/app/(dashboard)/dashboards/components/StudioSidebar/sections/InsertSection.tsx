'use client';

import React from 'react';
import {
  BarChartOutlined,
  NumberOutlined,
  TableOutlined,
  FontSizeOutlined,
  FilterOutlined,
  GlobalOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import { useTranslations } from 'next-intl';
import {
  useDashboardStore,
  isNonDataWidget,
  type WidgetType,
  type WidgetInstance,
  type LayoutItem,
} from '../../../stores/useDashboardStore';
import { findWidgetTemplate, generateWidgetId } from '../../../utils/buildDashboardWidget';
import { maxLayoutY } from '../../../utils/layoutSanitize';

const { Text } = Typography;

/** Primary insert palette — one filter control (not Slicer + Filter duplicates). */
const WIDGET_ITEMS: { type: WidgetType; labelKey: string; icon: React.ReactNode }[] = [
  { type: 'bar', labelKey: 'insert_chart', icon: <BarChartOutlined /> },
  { type: 'stat', labelKey: 'insert_kpi', icon: <NumberOutlined /> },
  { type: 'table', labelKey: 'insert_table', icon: <TableOutlined /> },
  { type: 'text', labelKey: 'insert_text', icon: <FontSizeOutlined /> },
  { type: 'slicer', labelKey: 'insert_filter_control', icon: <FilterOutlined /> },
  { type: 'embed', labelKey: 'insert_embed', icon: <GlobalOutlined /> },
];

function buildChartOptionsForType(type: WidgetType, templateName: string): Record<string, unknown> {
  switch (type) {
    case 'text':
      return { content: '', fontSize: 14, fontWeight: 400, color: 'inherit', textAlign: 'left' };
    case 'slicer':
    case 'filter':
      return { slicerLabel: templateName };
    case 'divider':
      return { sectionTitle: '', uppercase: true };
    case 'image':
      return { imageUrl: '', objectFit: 'contain' };
    case 'gauge':
      return { gaugeMin: 0, gaugeMax: 100, showLegend: false };
    case 'stat':
      return { format: 'number', fontSize: 32, layout: 'default', showSparkline: false };
    case 'pie':
    case 'donut':
      return { showLegend: true, showDataLabel: false, innerRadius: type === 'donut' ? 40 : 0 };
    default:
      return { showLegend: true, showDataLabel: false, showGridline: true, showAxis: true };
  }
}

function buildChartQueryForType(type: WidgetType): WidgetInstance['chartQuery'] | undefined {
  switch (type) {
    case 'text':
    case 'divider':
    case 'image':
    case 'embed':
      return {};
    case 'slicer':
      return { mode: 'single' as const };
    case 'filter':
      return { mode: 'multi' as const };
    case 'stat':
      return { yMetric: 'count', yMetrics: [], sortBy: 'x' };
    default:
      return undefined;
  }
}

export function InsertSection() {
  const t = useTranslations('dashboards');
  const layout = useDashboardStore((s) => s.layout);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const createChartAndFetchData = useDashboardStore((s) => s.createChartAndFetchData);

  const handleAdd = (type: WidgetType) => {
    const template = findWidgetTemplate(type);
    if (!template) return;

    const instanceId = generateWidgetId();
    const chartOptions = buildChartOptionsForType(type, template.name);
    const chartQuery = buildChartQueryForType(type);

    const widget: WidgetInstance = {
      id: instanceId,
      dataSourceId: undefined,
      chartType: type,
      title: type === 'text' || type === 'divider' ? '' : template.name,
      chartOptions,
      ...(chartQuery !== undefined ? { chartQuery } : {}),
    };

    const layoutItem: LayoutItem = {
      i: instanceId,
      x: 0,
      y: maxLayoutY(layout),
      w: template.defaultSize.w,
      h: template.defaultSize.h,
    };

    addWidget(widget, layoutItem);

    if (isNonDataWidget(type)) {
      void createChartAndFetchData(widget);
    }
  };

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.45 }}>
        {t('insert_hint')}
      </Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}
      >
        {WIDGET_ITEMS.map(({ type, labelKey, icon }) => (
          <button
            key={type}
            type="button"
            onClick={() => handleAdd(type)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              padding: '12px 8px',
              border: '1px solid var(--ant-color-border)',
              borderRadius: 8,
              background: 'var(--ant-color-bg-container)',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--ant-color-text)',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'var(--ant-color-primary)';
              (e.currentTarget as HTMLButtonElement).style.background =
                'var(--ant-color-primary-bg)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.borderColor =
                'var(--ant-color-border)';
              (e.currentTarget as HTMLButtonElement).style.background =
                'var(--ant-color-bg-container)';
            }}
          >
            <span style={{ fontSize: 20, color: 'var(--ant-color-primary)' }}>{icon}</span>
            <span>{t(labelKey)}</span>
          </button>
        ))}
      </div>
      <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.4 }}>
        {t('insert_filter_tip')}
      </Text>
    </div>
  );
}
