'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Empty, Spin } from 'antd';
import { TableWidget } from './TableWidget';
import { StatWidget } from './StatWidget';
import { TextWidget } from './TextWidget';
import type * as echarts from 'echarts';

const EChartWidget = dynamic(
  () => import('./EChartWidget').then((m) => m.EChartWidget),
  { ssr: false, loading: () => <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div> }
);

interface WidgetRendererProps {
  type: string;
  data?: any;
  config?: any;
  query?: any;
  isLoading?: boolean;
  error?: string | null;
  onChartReady?: (chart: echarts.ECharts) => void;
  onUpdateConfig?: (updates: any) => void;
  readOnly?: boolean;
  minHeight?: number;
  isDesigner?: boolean;
  isSelected?: boolean;
}

/**
 * Refactored WidgetRenderer
 * - Stateless
 * - Forwards chart instance upward
 */
export const WidgetRenderer: React.FC<WidgetRendererProps> = ({
  type,
  data,
  config = {},
  query = {},
  isLoading = false,
  error = null,
  onChartReady,
  onUpdateConfig,
  readOnly = false,
  minHeight,
  isDesigner = false,
  isSelected = false,
}) => {
  const isChartType = ['bar', 'line', 'area', 'pie', 'scatter', 'funnel', 'heatmap', 'donut'].includes(type);
  const loadingOverlayStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    zIndex: 10,
    pointerEvents: 'none',
  };

  // Error state
  if (error) {
    return (
      <div className="widget-center">
        <Empty description={`Error: ${error}`} />
      </div>
    );
  }

  // Text
  if (type === 'text') {
    return <TextWidget config={config} onUpdate={readOnly ? undefined : onUpdateConfig} readOnly={readOnly} isSelected={isSelected} />;
  }

  // Placeholder
  if (type === 'placeholder') {
    return (
      <div className="widget-center">
        <Empty description={config.text || 'Reserved Space'} />
      </div>
    );
  }

  // Data availability check
  const needsData = isChartType || type === 'table' || type === 'stat';
  const hasData =
    data &&
    ((Array.isArray(data.x) && data.x.length > 0) ||
      (Array.isArray(data.y) && data.y.length > 0) ||
      (Array.isArray(data.series) &&
        data.series.length > 0 &&
        data.series.some((s: any) => Array.isArray(s.data) && s.data.length > 0)) ||
      (type === 'stat' && data.value !== undefined && data.value !== null));

  // Initial loading state (no data yet)
  if (isLoading && needsData && !hasData) {
    return (
      <div style={loadingOverlayStyle}>
        <Spin tip="Loading data..." />
      </div>
    );
  }

  // Show 'No data available' only if not loading and no data
  if (needsData && !hasData) {
    return (
      <div className="widget-center">
        <Empty description="No data available. Configure the widget in properties." />
      </div>
    );
  }

  // Update overlay for partial loading (refreshing)
  const activeOverlayStyle: React.CSSProperties = {
    ...loadingOverlayStyle,
    background: 'rgba(255, 255, 255, 0.5)',
    pointerEvents: 'auto', // Prevent interaction during refresh
  };

  const renderContent = () => {
    // Table
    if (type === 'table') {
      return <TableWidget data={data} config={config} query={query} />;
    }

    // Stat / Metric
    if (type === 'stat') {
      return <StatWidget data={data} config={config} />;
    }

    // Chart
    if (isChartType && data) {
      return <EChartWidget type={type} data={data} config={config} onChartReady={onChartReady} minHeight={minHeight} isDesigner={isDesigner} />;
    }

    // Unknown
    return (
      <div className="widget-center">
        <Empty description={`Unknown widget type: ${type}`} />
      </div>
    );
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {renderContent()}
      {isLoading && (
        <div style={activeOverlayStyle}>
          <Spin tip="Updating..." size="small" />
        </div>
      )}
    </div>
  );

  // Unknown
  return (
    <div className="widget-center">
      <Empty description={`Unknown widget type: ${type}`} />
    </div>
  );
};
