'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import type { ECharts } from 'echarts';
import { isDark } from './WidgetRendererConfig';
import { enhanceEchartsInteractivity } from './utils/enhanceEchartsInteractivity';

type Props = {
  option: Record<string, unknown>;
  onChartReady?: (chart: ECharts) => void;
  minHeight?: number;
};

/** Render a frozen ECharts option (e.g. from AI chat) without studio SQL rebuild. */
export function RawEChartWidget({ option, onChartReady, minHeight }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ECharts | null>(null);
  const onChartReadyRef = useRef(onChartReady);
  onChartReadyRef.current = onChartReady;

  const [isDarkMode, setIsDarkMode] = React.useState(false);

  useEffect(() => {
    const observer = new MutationObserver(() => setIsDarkMode(isDark()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    setIsDarkMode(isDark());
    return () => observer.disconnect();
  }, []);

  const enhancedOption = useMemo(
    () => enhanceEchartsInteractivity(option),
    [option, isDarkMode],
  );

  useEffect(() => {
    if (!chartRef.current || !enhancedOption) return;

    if (!instanceRef.current) {
      instanceRef.current = echarts.init(chartRef.current, null, { renderer: 'canvas' });
    }

    instanceRef.current.setOption(enhancedOption, { notMerge: true, lazyUpdate: false });
    onChartReadyRef.current?.(instanceRef.current);

    const scheduleResize = () => {
      requestAnimationFrame(() => instanceRef.current?.resize());
    };

    const handleResize = () => scheduleResize();
    window.addEventListener('resize', handleResize);
    const ro = new ResizeObserver(() => scheduleResize());
    ro.observe(chartRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      ro.disconnect();
    };
  }, [enhancedOption]);

  useEffect(
    () => () => {
      instanceRef.current?.dispose();
      instanceRef.current = null;
    },
    []
  );

  return (
    <div className="widget-chart-shell">
      <div
        ref={chartRef}
        className="widget-chart-canvas"
        style={minHeight != null ? { minHeight: `${minHeight}px` } : undefined}
      />
    </div>
  );
}
