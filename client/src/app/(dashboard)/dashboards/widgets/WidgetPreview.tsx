'use client';

import { WidgetInstance } from '../stores/useDashboardStore';
import { WidgetRenderer } from './WidgetRenderer';
import { Typography } from 'antd';
import * as echarts from 'echarts';

const { Text } = Typography;

export const WidgetPreview: React.FC<{
  widget: WidgetInstance;
  onChartReady?: (instance: echarts.ECharts) => void;
  onUpdateConfig?: (updates: any) => void;
  readOnly?: boolean;
  minHeight?: number;
  isDesigner?: boolean;
  isSelected?: boolean;
}> = ({ 
  widget, 
  onChartReady, 
  onUpdateConfig, 
  readOnly = false, 
  minHeight, 
  isDesigner = false, 
  isSelected = false 
}) => {
  if (['line', 'area', 'pie', 'bar', 'table', 'scatter', 'funnel', 'heatmap', 'stat', 'text', 'donut'].includes(widget.chartType)) {
    return (
      <WidgetRenderer
        type={widget.chartType}
        data={widget.chartData}
        config={widget.chartOptions}
        query={widget.chartQuery}
        isLoading={widget.isLoading}
        error={widget.error}
        onChartReady={onChartReady}
        onUpdateConfig={onUpdateConfig}
        readOnly={readOnly}
        minHeight={minHeight}
        isDesigner={isDesigner}
        isSelected={isSelected}
      />
    );
  }

  return (
    <div className="widget-placeholder">
      <Text strong>Charts paused</Text>
      <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
        We are holding chart rendering to validate layout and state flow first.
      </Text>
    </div>
  );
};
