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
import { CHART_CLICK_EVENT, type ChartClickDetail } from './inlineEditEvents';

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


/** Report clicks on axis titles and data points, so they can be edited in place. */
function reportChartClicks(instance: echarts.ECharts, host: HTMLElement) {
  instance.on('click', (params: any) => {
    const widgetId = host.closest('[data-widget-id]')?.getAttribute('data-widget-id');
    const e = params?.event?.event as MouseEvent | undefined;
    if (!widgetId || !e) return;
    const isAxisTitle =
      (params.componentType === 'xAxis' || params.componentType === 'yAxis') && params.targetType === 'axisName';
    const isPoint = params.componentType === 'series' && params.name != null;
    if (!isAxisTitle && !isPoint) return;
    window.dispatchEvent(
      new CustomEvent<ChartClickDetail>(CHART_CLICK_EVENT, {
        detail: {
          widgetId,
          kind: isAxisTitle ? 'axisTitle' : 'point',
          axis: params.componentType === 'yAxis' ? 'y' : 'x',
          // Pie slices carry the raw value in `raw`; bars and points are named by their category.
          category: isPoint
            ? String(params.data && typeof params.data === 'object' && params.data.raw != null ? params.data.raw : params.name)
            : undefined,
          clientX: e.clientX,
          clientY: e.clientY,
        },
      }),
    );
  });
}

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

  const [compact, setCompact] = React.useState(false);
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
        compact,
      });
    } catch {
      return `${type}-${Date.now()}`;
    }
  }, [type, data, config, isDesigner, isDashboardWidget, showWatermark, planType, isDarkMode, compact]);

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
      reportChartClicks(echartsInstance.current, el);
    }

    let raf = 0;
    const scheduleResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        echartsInstance.current?.resize();
        // Small cards drop the legend (tooltips still name every value), as Datawrapper does
        // on narrow screens — a legend squeezed into a KPI-sized card only pages "1/5".
        setCompact(el.clientWidth < 320 || el.clientHeight < 220);
      });
    };
    const onWin = () => scheduleResize();
    window.addEventListener('resize', onWin);
    // `beforeprint` fires reliably once print CSS has actually been applied;
    // a plain 'resize' event and this ResizeObserver both go quiet for a
    // print-triggered layout change (same root cause the executive report's
    // print export had — see ExecutiveReport's beforeprint-driven resize).
    // Registering it per-widget here, rather than only where a dedicated
    // Print button exists, means every chart resizes correctly on ANY path
    // that reaches native print — Ctrl+P included, and the shared/embedded
    // dashboard viewer, which has no Print button of its own at all.
    window.addEventListener('beforeprint', onWin);
    const resizeObserver = new ResizeObserver(() => scheduleResize());
    resizeObserver.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onWin);
      window.removeEventListener('beforeprint', onWin);
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
      reportChartClicks(echartsInstance.current, chartRef.current);
    }

    if (lastOptionsKeyRef.current === optionsKey) return;
    lastOptionsKeyRef.current = optionsKey;

    let options = buildChartOptions(type, data, {
      ...config,
      ...(compact && isDashboardWidget ? { showLegend: false, legendPosition: 'hide' } : {}),
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
  }, [optionsKey, type, data, config, isDarkMode, isDesigner, isDashboardWidget, showWatermark, planType, compact]);

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
