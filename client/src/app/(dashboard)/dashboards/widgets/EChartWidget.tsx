'use client';

import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { buildChartOptions } from './ChartOptionsBuilder';
import { ChartData, ChartConfig, isDark } from './WidgetRendererConfig';
import { shouldApplyWatermark, WatermarkOverlay, addWatermarkToChart } from '@/utils/watermark';

interface EChartWidgetProps {
  type: string;
  data: ChartData;
  config?: Partial<ChartConfig>;
  onChartReady?: (chart: echarts.ECharts) => void;
  minHeight?: number;
  isDesigner?: boolean;
}

/**
 * Renders an ECharts chart with automatic resizing
 * Exposes chart instance for export (PNG / SVG)
 */
export const EChartWidget: React.FC<EChartWidgetProps> = ({ type, data, config = {}, onChartReady, minHeight = 200, isDesigner = false }) => {
  const chartRef = useRef<HTMLDivElement>(null);
  const echartsInstance = useRef<echarts.ECharts | null>(null);
 
  const [isDarkMode, setIsDarkMode] = React.useState(false);

  // Watch theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(isDark());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    setIsDarkMode(isDark());

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!chartRef.current || !data) return;
    const hasData = (data.x && data.x.length > 0) || (data.series && data.series.length > 0) || (data.y && data.y.length > 0);
    if (!hasData) return;

    // Create instance once
    if (!echartsInstance.current) {
      echartsInstance.current = echarts.init(chartRef.current, null, {
        renderer: 'svg', // IMPORTANT for SVG export
      });

      // Expose instance upward (DashboardCanvas will store it)
      onChartReady?.(echartsInstance.current);
    }

    // In designer mode, we boost label sizes for better visibility in the large canvas
    let options = buildChartOptions(type, data, { ...config, isDesigner } as any);
    const planType = 'free';
    // Use overlay mode so we render the DOM-based watermark for consistency with ChatMessage
    options = addWatermarkToChart(options, planType, { isDark: isDarkMode, useOverlay: true });
    echartsInstance.current.setOption(options, true);

    const handleResize = () => echartsInstance.current?.resize();
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(chartRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [type, data, config, isDarkMode, onChartReady]);

  // Dispose on unmount
  useEffect(() => {
    return () => {
      echartsInstance.current?.dispose();
      echartsInstance.current = null;
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
      <div ref={chartRef} style={{ width: '100%', height: '100%', minHeight: '200px', flex: 1 }} />
      {shouldApplyWatermark('free') && <WatermarkOverlay isDark={isDarkMode} />}
    </div>
  );
};
