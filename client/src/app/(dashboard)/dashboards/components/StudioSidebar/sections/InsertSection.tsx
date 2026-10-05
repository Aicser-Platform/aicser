'use client';

import React from 'react';
import {
  BarChartOutlined,
  LineChartOutlined,
  AreaChartOutlined,
  PieChartOutlined,
  DotChartOutlined,
  FireOutlined,
  DashboardOutlined,
  NumberOutlined,
  TableOutlined,
  FontSizeOutlined,
  BorderHorizontalOutlined,
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

interface PaletteCategory {
  titleKey: string;
  items: { type: WidgetType; labelKey: string; icon: React.ReactNode }[];
}

const CATEGORIES: PaletteCategory[] = [
  {
    titleKey: 'insert_category_visuals',
    items: [
      { type: 'bar', labelKey: 'insert_chart', icon: <BarChartOutlined /> },
      { type: 'line', labelKey: 'insert_line', icon: <LineChartOutlined /> },
      { type: 'area', labelKey: 'insert_area', icon: <AreaChartOutlined /> },
      { type: 'pie', labelKey: 'insert_pie', icon: <PieChartOutlined /> },
      { type: 'donut', labelKey: 'insert_donut', icon: <PieChartOutlined /> },
      { type: 'scatter', labelKey: 'insert_scatter', icon: <DotChartOutlined /> },
      { type: 'heatmap', labelKey: 'desc_heatmap', icon: <FireOutlined /> },
      { type: 'gauge', labelKey: 'insert_gauge', icon: <DashboardOutlined /> },
    ],
  },
  {
    titleKey: 'insert_category_kpi',
    items: [
      { type: 'stat', labelKey: 'insert_kpi', icon: <NumberOutlined /> },
      { type: 'table', labelKey: 'insert_table', icon: <TableOutlined /> },
    ],
  },
  {
    titleKey: 'insert_category_grouping',
    items: [
      { type: 'divider', labelKey: 'insert_divider', icon: <BorderHorizontalOutlined /> },
      { type: 'text', labelKey: 'insert_text', icon: <FontSizeOutlined /> },
      { type: 'embed', labelKey: 'insert_embed', icon: <GlobalOutlined /> },
    ],
  },
  {
    titleKey: 'insert_category_filters',
    items: [
      { type: 'slicer', labelKey: 'insert_filter_control', icon: <FilterOutlined /> },
    ],
  },
];

function buildChartOptionsForType(type: WidgetType, templateName: string): Record<string, unknown> {
  switch (type) {
    case 'text':
      return { content: '', fontSize: 14, fontWeight: 400, color: 'inherit', textAlign: 'left' };
    case 'slicer':
    case 'filter':
      return { slicerLabel: templateName };
    case 'divider':
      return { sectionTitle: 'Section Overview', uppercase: true };
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
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.45 }}>
        {t('insert_hint')}
      </Text>

      {CATEGORIES.map((cat) => (
        <div key={cat.titleKey} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--ant-color-text-tertiary)',
            }}
          >
            {t(cat.titleKey as never) ?? cat.titleKey}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
            }}
          >
            {cat.items.map(({ type, labelKey, icon }) => (
              <button
                key={type}
                type="button"
                onClick={() => handleAdd(type)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '10px 6px',
                  border: '1px solid var(--ant-color-border-secondary)',
                  borderRadius: 6,
                  background: 'var(--ant-color-bg-container)',
                  cursor: 'pointer',
                  fontSize: 11,
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
                    'var(--ant-color-border-secondary)';
                  (e.currentTarget as HTMLButtonElement).style.background =
                    'var(--ant-color-bg-container)';
                }}
              >
                <span style={{ fontSize: 18, color: 'var(--ant-color-primary)' }}>{icon}</span>
                <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {t(labelKey as never) ?? labelKey}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <Text type="secondary" style={{ fontSize: 11, lineHeight: 1.4 }}>
        {t('insert_filter_tip')}
      </Text>
    </div>
  );
}

export default InsertSection;
