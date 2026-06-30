'use client';

import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { buildChartOptions } from './ChartOptionsBuilder';
import { ChartData, ChartConfig, isDark } from './WidgetRendererConfig';
import { addWatermarkToChart, shouldApplyWatermark } from '@/utils/watermark';
import { WatermarkOverlay } from '@/utils/watermark-overlay';
import { syncCrossFilterHighlight } from '../utils/crossFilterChart';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { useSubscription } from '@/ee/stores/useSubscriptionStore';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

interface EChartWidgetProps {
  type: string;
  data: ChartData;
  config?: Partial<ChartConfig>;
  onChartReady?: (chart: echarts.ECharts) => void;
  crossFilterField?: string;
  runtimeFilters?: RuntimeFilter[];
  minHeight?: number;
  isDesigner?: boolean;
}

type CoreProps = EChartWidgetProps & {
  planType: string;
};

/**
 * Renders an ECharts chart with automatic resizing.
 * Watermark matches /chat: DOM overlay + useOverlay (no ECharts graphic), plan-gated.
 */
function EChartWidgetCore({
  type,
  data,
  config = {},
  onChartReady,
  crossFilterField,
  runtimeFilters = [],
  minHeight,
  isDesigner = false,
  planType,
}: CoreProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const echartsInstance = useRef<echarts.ECharts | null>(null);
  const onChartReadyRef = useRef(onChartReady);
  onChartReadyRef.current = onChartReady;

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const isDashboardWidget = !isDesigner;
  const skipWatermark =
    (config as { __source?: string; suppressWatermark?: boolean }).__source === 'ai_chat' ||
    (config as { suppressWatermark?: boolean }).suppressWatermark;
  const showWatermark = shouldApplyWatermark(planType) && !skipWatermark;
  /** Chat + chart designer: full center mark; dashboard tiles: softer subtle mark */
  const watermarkSubtle = isDashboardWidget;

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
    const hasData =
      (data.x && data.x.length > 0) ||
      (data.series && data.series.length > 0) ||
      (data.y && data.y.length > 0) ||
      (type === 'gauge' && data.value != null);
    if (!hasData) return;

    if (!echartsInstance.current) {
      echartsInstance.current = echarts.init(chartRef.current, null, {
        renderer: 'canvas',
      });
    }

    let options = buildChartOptions(type, data, {
      ...config,
      isDesigner,
      isDashboardWidget,
    } as ChartConfig & { isDesigner?: boolean; isDashboardWidget?: boolean });
    if (showWatermark) {
      options = addWatermarkToChart(options, planType, { isDark: isDarkMode, useOverlay: true });
    }
    echartsInstance.current.setOption(options, { notMerge: true, lazyUpdate: false });

    if (onChartReadyRef.current) {
      onChartReadyRef.current(echartsInstance.current);
    }

    const scheduleResize = () => {
      requestAnimationFrame(() => echartsInstance.current?.resize());
    };

    const handleResize = () => scheduleResize();
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => scheduleResize());
    resizeObserver.observe(chartRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [type, data, config, isDarkMode, isDesigner, isDashboardWidget, showWatermark, planType]);

  useEffect(() => {
    if (!echartsInstance.current || !crossFilterField) return;
    syncCrossFilterHighlight(echartsInstance.current, crossFilterField, runtimeFilters);
  }, [crossFilterField, runtimeFilters, data]);

  useEffect(() => {
    return () => {
      echartsInstance.current?.dispose();
      echartsInstance.current = null;
    };
  }, []);

  return (
    <div className="widget-chart-shell">
      <div
        ref={chartRef}
        className="widget-chart-canvas"
        style={minHeight != null ? { minHeight: `${minHeight}px` } : undefined}
      />
      {showWatermark ? <WatermarkOverlay isDark={isDarkMode} subtle={watermarkSubtle} /> : null}
    </div>
  );
}

function EChartWidgetCe(props: EChartWidgetProps) {
  const { planType } = useSubscriptionStore();
  return <EChartWidgetCore {...props} planType={(planType || 'free').toLowerCase()} />;
}

function EChartWidgetEe(props: EChartWidgetProps) {
  const { planType } = useSubscription();
  return <EChartWidgetCore {...props} planType={(planType || 'free').toLowerCase()} />;
}

export const EChartWidget = isEnterpriseEdition ? EChartWidgetEe : EChartWidgetCe;
