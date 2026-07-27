'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts';
import { buildChartOptions } from './ChartOptionsBuilder';
import { ChartData, ChartConfig, isDark } from './WidgetRendererConfig';
import { addWatermarkToChart, shouldApplyWatermark } from '@/utils/watermark';
import { WatermarkOverlay } from '@/utils/watermark-overlay';
import { syncCrossFilterHighlight } from '../utils/crossFilterChart';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';

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
 *
 * Reference-line shake fix: options are fingerprinted so identical content does not
 * re-run setOption; updates disable animation so markLines do not re-tween.
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
  const hasPaintedRef = useRef(false);
  const lastOptionsKeyRef = useRef('');

  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const isDashboardWidget = !isDesigner;
  const skipWatermark =
    (config as { __source?: string; suppressWatermark?: boolean }).__source === 'ai_chat' ||
    (config as { suppressWatermark?: boolean }).suppressWatermark;
  const showWatermark = shouldApplyWatermark(planType) && !skipWatermark;
  const watermarkSubtle = isDashboardWidget;

  const optionsKey = useMemo(() => {
    try {
      return JSON.stringify({
        type,
        data,
        config,
        isDesigner,
        isDashboardWidget,
        showWatermark,
        planType,
        isDarkMode,
      });
    } catch {
      return `${type}-${Date.now()}`;
    }
  }, [type, data, config, isDesigner, isDashboardWidget, showWatermark, planType, isDarkMode]);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(isDark());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
    setIsDarkMode(isDark());
    return () => observer.disconnect();
  }, []);

  // Init + resize observer once (not on every options rebuild — that caused jitter).
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;

    if (!echartsInstance.current) {
      echartsInstance.current = echarts.init(el, null, { renderer: 'canvas' });
    }

    let raf = 0;
    const scheduleResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => echartsInstance.current?.resize());
    };
    const onWin = () => scheduleResize();
    window.addEventListener('resize', onWin);
    const resizeObserver = new ResizeObserver(() => scheduleResize());
    resizeObserver.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWin);
      resizeObserver.disconnect();
    };
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
      echartsInstance.current = echarts.init(chartRef.current, null, { renderer: 'canvas' });
    }

    if (lastOptionsKeyRef.current === optionsKey) return;
    lastOptionsKeyRef.current = optionsKey;

    let options = buildChartOptions(type, data, {
      ...config,
      isDesigner,
      isDashboardWidget,
    } as ChartConfig & { isDesigner?: boolean; isDashboardWidget?: boolean });
    if (showWatermark) {
      options = addWatermarkToChart(options, planType, { isDark: isDarkMode, useOverlay: true });
    }

    const firstPaint = !hasPaintedRef.current;
    hasPaintedRef.current = true;

    echartsInstance.current.dispatchAction({ type: 'hideTip' });
    // First paint may animate in; subsequent updates must not re-animate markLines.
    // lazyUpdate:false avoids tooltip getRawIndex crashes while zrender shapes are stale
    // (common when toggling overlays or opening View Full).
    echartsInstance.current.setOption(
      {
        ...options,
        animation: firstPaint,
        animationDurationUpdate: 0,
        stateAnimation: { duration: 0 },
      },
      { notMerge: true, lazyUpdate: false },
    );

    if (onChartReadyRef.current) {
      onChartReadyRef.current(echartsInstance.current);
    }
  }, [optionsKey, type, data, config, isDarkMode, isDesigner, isDashboardWidget, showWatermark, planType]);

  useEffect(() => {
    if (!echartsInstance.current || !crossFilterField) return;
    syncCrossFilterHighlight(echartsInstance.current, crossFilterField, runtimeFilters);
  }, [crossFilterField, runtimeFilters, data]);

  useEffect(() => {
    return () => {
      const inst = echartsInstance.current;
      if (inst) {
        try {
          inst.dispatchAction({ type: 'hideTip' });
        } catch {
          /* ignore */
        }
        inst.dispose();
      }
      echartsInstance.current = null;
      hasPaintedRef.current = false;
      lastOptionsKeyRef.current = '';
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

export const EChartWidget = EChartWidgetCe;
