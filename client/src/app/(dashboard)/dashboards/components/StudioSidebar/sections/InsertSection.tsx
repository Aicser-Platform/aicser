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
import { useDashboardStore, isNonDataWidget, type WidgetType, type WidgetInstance, type LayoutItem } from '../../../stores/useDashboardStore';
import { findWidgetTemplate, generateWidgetId } from '../../../utils/buildDashboardWidget';
import { maxLayoutY } from '../../../utils/layoutSanitize';

const WIDGET_ITEMS: { type: WidgetType; label: string; icon: React.ReactNode }[] = [
  { type: 'bar', label: 'Chart', icon: <BarChartOutlined /> },
  { type: 'stat', label: 'Stat / KPI', icon: <NumberOutlined /> },
  { type: 'table', label: 'Table', icon: <TableOutlined /> },
  { type: 'text', label: 'Text', icon: <FontSizeOutlined /> },
  { type: 'slicer', label: 'Slicer', icon: <FilterOutlined /> },
  { type: 'embed', label: 'Embed', icon: <GlobalOutlined /> },
];

function buildChartOptionsForType(type: WidgetType, templateName: string): Record<string, unknown> {
  switch (type) {
    case 'text':
      return { content: '', fontSize: 14, fontWeight: 400, color: 'inherit', textAlign: 'left' };
    case 'slicer':
      return { slicerLabel: templateName };
    case 'divider':
      return { sectionTitle: '', uppercase: true };
    case 'image':
      return { imageUrl: '', objectFit: 'contain' };
    case 'gauge':
      return { gaugeMin: 0, gaugeMax: 100, showLegend: false };
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
    default:
      return undefined;
  }
}

export function InsertSection() {
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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 8,
        padding: 12,
      }}
    >
      {WIDGET_ITEMS.map(({ type, label, icon }) => (
        <button
          key={type}
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
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
