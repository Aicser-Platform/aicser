'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { echarts } from '@/components/charts/echartsHost';
import {
  getColorsFromPalette,
  isDark,
} from '@/app/(dashboard)/dashboards/widgets/WidgetRendererConfig';
import { resolveChartPaletteId } from '@/app/(dashboard)/dashboards/utils/chartPaletteCatalog';
import { VisualErrorBoundary } from './VisualErrorBoundary';
import type { VisualContext, VisualInstance, VisualPlugin } from './types';

const moduleCache = new Map<string, Promise<VisualPlugin>>();

export function clearVisualModuleCache(): void {
  moduleCache.clear();
}

export function registerVisualModuleForTest(url: string, plugin: VisualPlugin): void {
  moduleCache.set(url, Promise.resolve(plugin));
}

export function loadVisualModule(url: string): Promise<VisualPlugin> {
  let cached = moduleCache.get(url);
  if (!cached) {
    const importUrl =
      process.env.NODE_ENV === 'development'
        ? `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`
        : url;
    cached = import(/* webpackIgnore: true */ importUrl).then((mod) => {
      const resolved = mod?.default ?? mod;
      if (!resolved || typeof resolved.mount !== 'function') {
        throw new Error(`Plug-in bundle at ${url} does not export a valid VisualPlugin with mount()`);
      }
      return resolved as VisualPlugin;
    });
    moduleCache.set(url, cached);
  }
  return cached;
}

function normalizeTabularData(rawData: any): VisualContext['data'] {
  if (!rawData) {
    return { columns: [], rows: [], raw: rawData };
  }

  if (Array.isArray(rawData.columns) && Array.isArray(rawData.rows)) {
    const cols = rawData.columns.map((c: any) =>
      typeof c === 'string' ? { name: c, type: 'string' } : { name: String(c.name), type: String(c.type || 'string') },
    );
    return { columns: cols, rows: rawData.rows, raw: rawData };
  }

  if (Array.isArray(rawData)) {
    const first = rawData[0] || {};
    const cols = Object.keys(first).map((k) => ({
      name: k,
      type: typeof first[k] === 'number' ? 'number' : 'string',
    }));
    return { columns: cols, rows: rawData, raw: rawData };
  }

  // Convert Aicser dashboard ChartData shape { x, y, group_field, series } into tabular rows + preserve raw
  const xArr: any[] = Array.isArray(rawData.x) ? rawData.x : [];
  const groupArr: any[] = Array.isArray(rawData.group_field) ? rawData.group_field : [];
  const yArr: any[] =
    Array.isArray(rawData.y) && rawData.y.length > 0
      ? rawData.y
      : Array.isArray(rawData.series?.[0]?.data)
        ? rawData.series[0].data
        : [];

  if (xArr.length > 0) {
    const hasGroup = groupArr.length > 0;
    const columns = hasGroup
      ? [
          { name: 'source', type: 'string' },
          { name: 'target', type: 'string' },
          { name: 'value', type: 'number' },
        ]
      : [
          { name: 'category', type: 'string' },
          { name: 'value', type: 'number' },
        ];
    const rows = xArr.map((xVal, idx) =>
      hasGroup
        ? {
            source: xVal,
            target: groupArr[idx] ?? '',
            value: Number(yArr[idx] ?? 0),
          }
        : {
            category: xVal,
            value: Number(yArr[idx] ?? 0),
          },
    );
    return { columns, rows, raw: rawData };
  }

  return { columns: [], rows: [], raw: rawData };
}

export interface PluginVisualProps {
  chartType: string;
  bundleUrl: string;
  data: any;
  config?: Record<string, any>;
  minHeight?: number;
  onChartReady?: (chart: any) => void;
}

const PluginVisualInner: React.FC<PluginVisualProps> = ({
  chartType,
  bundleUrl,
  data,
  config = {},
  minHeight = 240,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<VisualInstance | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [darkMode, setDarkMode] = useState<boolean>(() =>
    typeof document !== 'undefined' ? isDark() : false,
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() => {
      setDarkMode(isDark());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    setDarkMode(isDark());
    return () => observer.disconnect();
  }, []);

  const palette = useMemo(() => {
    const paletteId = resolveChartPaletteId(
      config?.colorPalette,
      config?.dashboardDefaultPalette,
    );
    return getColorsFromPalette(paletteId);
  }, [config?.colorPalette, config?.dashboardDefaultPalette]);

  const normalizedData = useMemo(() => normalizeTabularData(data), [data]);

  const buildContext = (el: HTMLElement): VisualContext => {
    const isCurrentDark = typeof document !== 'undefined' ? isDark() : darkMode;
    return {
      container: el,
      width: el.clientWidth || 400,
      height: el.clientHeight || minHeight,
      data: normalizedData,
      options: config || {},
      theme: {
        mode: isCurrentDark ? 'dark' : 'light',
        palette,
      },
      t: (_key: string, defaultText?: string) => defaultText || _key,
      format: {
        number: (val: number, opts?: Intl.NumberFormatOptions) =>
          Number(val ?? 0).toLocaleString(undefined, opts),
        date: (val: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
          new Date(val).toLocaleDateString(undefined, opts),
      },
      echarts,
    };
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;

    setLoadError(null);
    loadVisualModule(bundleUrl)
      .then((plugin) => {
        if (cancelled || !containerRef.current) return;
        try {
          const ctx = buildContext(containerRef.current);
          instanceRef.current = plugin.mount(containerRef.current, ctx);
        } catch (err) {
          setLoadError(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err : new Error(String(err)));
        }
      });

    return () => {
      cancelled = true;
      if (instanceRef.current) {
        try {
          instanceRef.current.destroy();
        } catch {
          // ignore cleanup errors
        }
        instanceRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleUrl]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !instanceRef.current) return;
    try {
      instanceRef.current.update(buildContext(el));
    } catch (err) {
      setLoadError(err instanceof Error ? err : new Error(String(err)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedData, config, darkMode, palette]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (instanceRef.current && containerRef.current) {
        try {
          instanceRef.current.update(buildContext(containerRef.current));
        } catch {
          // ignore resize errors
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedData, config, darkMode, palette]);

  if (loadError) {
    throw loadError;
  }

  return (
    <div className="widget-chart-shell" data-testid={`plugin-visual-${chartType}`}>
      <div
        ref={containerRef}
        className="widget-chart-canvas"
        style={{ width: '100%', height: '100%', minHeight: `${minHeight}px` }}
      />
    </div>
  );
};

export const PluginVisual: React.FC<PluginVisualProps> = (props) => (
  <VisualErrorBoundary chartType={props.chartType}>
    <PluginVisualInner {...props} />
  </VisualErrorBoundary>
);

