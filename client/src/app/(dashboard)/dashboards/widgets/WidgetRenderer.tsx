'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Empty } from 'antd';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';
import { TableWidget } from './TableWidget';
import { RawRowsTableWidget } from './RawRowsTableWidget';
import { StatWidget } from './StatWidget';
import { TextWidget } from './TextWidget';
import { SlicerWidget } from './SlicerWidget';
import { EmbedWidget } from './EmbedWidget';
import { ImageWidget } from './ImageWidget';
import { DashboardIcon } from '../icons';
import { getCrossFilterValues } from '../utils/filterOperators';
import type * as echarts from 'echarts';
import { extractEchartsSnapshotOption } from '@/components/charts/resolveChatChart';
import { getColorsFromPalette, type ChartValueFormat } from './WidgetRendererConfig';
import { hasRenderableChartData } from '@/components/charts/chartDesignerBridge';
import { resolveChartPaletteId } from '../utils/chartPaletteCatalog';
import { enhanceEchartsInteractivity } from './utils/enhanceEchartsInteractivity';
import { getFriendlyWidgetError } from '../utils/widgetErrorDisplay';
import { DASHBOARD_CHART_TYPES } from '../utils/filterConfigMerge';

const widgetChunkLoading = () => (
  <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <AppLoadingIndicator variant="minimal" />
  </div>
);

const GeoMapWidget = dynamic(
  () => import('./GeoMapWidget').then((m) => m.GeoMapWidget),
  { ssr: false, loading: widgetChunkLoading }
);

const EChartWidget = dynamic(
  () => import('./EChartWidget').then((m) => m.EChartWidget),
  { ssr: false, loading: widgetChunkLoading }
);

const RawEChartWidget = dynamic(
  () => import('./RawEChartWidget').then((m) => m.RawEChartWidget),
  { ssr: false, loading: widgetChunkLoading }
);

interface QueryMetric {
  field?: string;
  aggregation?: string;
  label?: string;
  valueFormat?: ChartValueFormat;
  computed?: {
    format?: ChartValueFormat;
  };
}

const metricDisplayName = (metric: QueryMetric) => {
  if (metric.label) return metric.label;
  if (metric.field) return metric.field;
  if (metric.aggregation) return metric.aggregation;
  return undefined;
};

const queryMetricArray = (value: unknown): QueryMetric[] => (
  Array.isArray(value)
    ? value.filter((item): item is QueryMetric => typeof item === 'object' && item !== null)
    : []
);

const buildMetricFormats = (query: Record<string, unknown>): Record<string, ChartValueFormat> => {
  const metrics: QueryMetric[] = [
    ...queryMetricArray(query?.yMetrics),
    ...queryMetricArray(query?.yMetricsSecondary),
  ];
  return metrics.reduce<Record<string, ChartValueFormat>>((acc, metric) => {
    const format = metric.valueFormat || metric.computed?.format;
    if (!format || format === 'auto') return acc;

    const names = [
      metricDisplayName(metric),
      metric.field,
      metric.label,
      metric.field && metric.aggregation ? `${metric.aggregation[0]?.toUpperCase()}${metric.aggregation.slice(1)} of ${metric.field}` : undefined,
    ];
    names.forEach((name) => {
      if (name) acc[name] = format;
    });
    return acc;
  }, {});
};

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
  dashboardId?: string;
  onFilter?: (field: string, value: unknown) => void;
  runtimeFilters?: import('../stores/useDashboardStore').RuntimeFilter[];
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
  dashboardId,
  onFilter,
  runtimeFilters = [],
}) => {
  /** Canvas slicers/filters stay interactive in view / presentation even when the canvas is read-only. */
  const effectiveReadOnly = (type === 'slicer' || type === 'filter') && onFilter ? false : readOnly;
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

  const echartsSnapshot = extractEchartsSnapshotOption(config);
  const prefetchedData = config?.__prefetchedChartData;
  // Prefer live chartData after Apply/refresh — prefetch is only a cold-start fallback.
  const effectiveData = hasRenderableChartData(data)
    ? data
    : (prefetchedData ?? data);
  const metricFormats = React.useMemo(
    () => buildMetricFormats(query as Record<string, unknown>),
    [query]
  );
  const chartConfig = React.useMemo(
    () => Object.keys(metricFormats).length
      ? { ...config, metricFormats: { ...(config?.metricFormats || {}), ...metricFormats } }
      : config,
    [config, metricFormats]
  );

  // Frozen AI chat chart — render stored ECharts JSON directly (no SQL rebuild).
  // Prefer snapshot when live/prefetched data is missing or empty (failed SQL refresh).
  if (echartsSnapshot && !hasRenderableChartData(effectiveData)) {
    const paletteId = resolveChartPaletteId(config?.colorPalette, config?.dashboardDefaultPalette);
    const paletteColors = getColorsFromPalette(paletteId);
    const snapshotOption = enhanceEchartsInteractivity(
      {
        ...echartsSnapshot,
        color: Array.isArray(echartsSnapshot.color) && echartsSnapshot.color.length
          ? echartsSnapshot.color
          : paletteColors,
      },
      { suppressCardTitle: true },
    );

    return (
      <div className="widget-content-root">
        <RawEChartWidget option={snapshotOption} onChartReady={onChartReady} minHeight={minHeight} />
        {isLoading && (
          <div className="widget-loading-overlay" style={{ ...loadingOverlayStyle, pointerEvents: 'auto' }}>
            <AppLoadingIndicator variant="minimal" tip="Updating..." />
          </div>
        )}
      </div>
    );
  }

  const isChartType = (DASHBOARD_CHART_TYPES as readonly string[]).includes(type) && type !== 'table' && type !== 'stat' && type !== 'geo';
  const isGeo = type === 'geo';
  const activeOverlayClass = 'widget-loading-overlay';

  // Error state — still prefer durable prefetch (Visualize / Chat pin) over a failed live fetch
  if (error && !hasRenderableChartData(prefetchedData)) {
    const friendlyError = getFriendlyWidgetError(error);
    return (
      <div className="widget-center" title={friendlyError.technicalDetail}>
        <Empty
          description={
            <span>
              <strong>{friendlyError.title}</strong>
              <br />
              {friendlyError.detail}
            </span>
          }
        />
      </div>
    );
  }

  // Text
  if (type === 'text') {
    return <TextWidget config={config} onUpdate={readOnly ? undefined : onUpdateConfig} readOnly={readOnly} isSelected={isSelected} />;
  }

  // Slicer / filter control — both render as SlicerWidget and write to the
  // shared (cross-page) runtimeFilters; 'filter' just defaults to a wider,
  // multi-select dashboard-wide control.
  if (type === 'slicer' || type === 'filter') {
    // SlicerWidget reads query.dataSourceId to fetch filter options.
    // handleDataSourceChange writes to widget.dataSourceId (root level) but not to
    // chartQuery.dataSourceId until the user hits Apply Changes.
    // WidgetPreview already injects widget.dataSourceId into query, but fall back to
    // config.__widgetDataSourceId for any call sites that bypass WidgetPreview.
    const slicerQuery = (query as Record<string, unknown>).dataSourceId
      ? query
      : { ...query, dataSourceId: (config as Record<string, unknown>).__widgetDataSourceId };
    return (
      <SlicerWidget
        query={slicerQuery}
        config={config}
        readOnly={effectiveReadOnly}
        dashboardId={dashboardId}
        runtimeFilters={runtimeFilters}
        onFilter={onFilter}
      />
    );
  }

  // Section Divider — line only unless a section title is configured
  if (type === 'divider') {
    const hideLine = config.hideLine === true;
    const title = typeof config.sectionTitle === 'string' ? config.sectionTitle.trim() : '';

    if (!title && hideLine) {
      return <div className="widget-section-divider" aria-hidden style={{ height: '100%' }} />;
    }

    if (title) {
      return (
        <div className="widget-section-divider widget-section-divider--titled">
          <span
            className="widget-section-divider-title"
            style={{
              fontSize: config.titleSize || 13,
              fontWeight: 600,
              color: config.titleColor || 'var(--studio-text-secondary)',
              textTransform: config.uppercase ? 'uppercase' : 'none',
              letterSpacing: config.uppercase ? '0.06em' : undefined,
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            {(config.icon || config.iconName) ? (
              <span className="widget-section-divider-icon" style={{ color: config.titleColor || undefined }}>
                <DashboardIcon icon={config.icon} legacyIconName={config.iconName} size={Math.max(12, (config.titleSize || 13) - 1)} />
              </span>
            ) : null}
            {title}
          </span>
          {!hideLine ? <hr className="widget-section-divider-line" /> : null}
        </div>
      );
    }

    if (hideLine) {
      return <div className="widget-section-divider" aria-hidden style={{ height: '100%' }} />;
    }

    return (
      <div className="widget-section-divider widget-section-divider--line-only">
        <hr className="widget-section-divider-line" />
      </div>
    );
  }

  // Embed / iframe widget
  if (type === 'embed') {
    return <EmbedWidget config={config} readOnly={readOnly} />;
  }

  // Image Widget — upload or URL (inline setup mirrors embed properties)
  if (type === 'image') {
    return (
      <ImageWidget
        config={config}
        onUpdate={readOnly ? undefined : onUpdateConfig}
        readOnly={readOnly}
        isSelected={isSelected}
      />
    );
  }

  // Placeholder
  if (type === 'placeholder') {
    return (
      <div className="widget-center">
        <Empty description={config.text || 'Reserved Space'} />
      </div>
    );
  }

  // Geo map — has its own loading/empty states internally
  if (isGeo) {
    return (
      <div className="widget-content-root">
        <GeoMapWidget
          data={effectiveData}
          config={config}
          onChartReady={onChartReady}
          minHeight={minHeight}
        />
        {isLoading && (
          <div className="widget-loading-overlay" style={{ ...loadingOverlayStyle, pointerEvents: 'auto' }}>
            <AppLoadingIndicator variant="minimal" tip="Updating…" />
          </div>
        )}
      </div>
    );
  }

  // Data availability check
  const needsData = isChartType || type === 'table' || type === 'stat';
  const hasData =
    effectiveData &&
    ((Array.isArray(effectiveData.x) && effectiveData.x.length > 0) ||
      (Array.isArray(effectiveData.y) && effectiveData.y.length > 0) ||
      (Array.isArray(effectiveData.series) &&
        effectiveData.series.length > 0 &&
        effectiveData.series.some((s: any) => Array.isArray(s.data) && s.data.length > 0)) ||
      (Array.isArray((effectiveData as { heatmap?: unknown[] }).heatmap) &&
        (effectiveData as { heatmap: unknown[] }).heatmap.length > 0) ||
      ((type === 'stat' || type === 'gauge') && effectiveData.value !== undefined && effectiveData.value !== null) ||
      // Chat-originated "table" charts carry a raw row array (not the {x,y,series}
      // aggregation shape) — see hasRenderableChartData, which already special-cases this.
      (Array.isArray(effectiveData) && effectiveData.length > 0));

  // Initial loading state (no data yet)
  if (isLoading && needsData && !hasData) {
    return (
      <div style={loadingOverlayStyle}>
        <AppLoadingIndicator variant="minimal" tip="Loading data..." />
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
    pointerEvents: 'auto',
  };

  const renderContent = () => {
    // Table
    if (type === 'table') {
      // Chat-originated tables carry a raw row array, not TableWidget's {x,y,series}
      // dimension/metric aggregation shape — those are structurally different data
      // (arbitrary flat columns vs. a pivoted x/series breakdown), so render them
      // with RawRowsTableWidget instead of feeding TableWidget a shape it can't use.
      if (Array.isArray(effectiveData)) {
        return (
          <RawRowsTableWidget
            rows={effectiveData as Record<string, unknown>[]}
            config={config}
            crossFilterField={query?.x}
            activeCrossFilterValues={
              query?.x ? getCrossFilterValues(runtimeFilters, query.x) : []
            }
            onCrossFilter={onFilter && query?.x ? (value) => onFilter(query.x!, value) : undefined}
          />
        );
      }
      return (
        <TableWidget
          data={effectiveData}
          config={config}
          query={query}
          crossFilterField={query?.x}
          activeCrossFilterValues={
            query?.x ? getCrossFilterValues(runtimeFilters, query.x) : []
          }
          onCrossFilter={onFilter && query?.x ? (value) => onFilter(query.x!, value) : undefined}
        />
      );
    }

    // Stat / Metric
    if (type === 'stat') {
      const crossField = query?.x;
      return (
        <StatWidget
          data={effectiveData}
          config={config}
          filterValue={
            crossField && effectiveData && Array.isArray((effectiveData as { x?: unknown[] }).x)
              ? (effectiveData as { x: unknown[] }).x[(effectiveData as { x: unknown[] }).x.length - 1]
              : undefined
          }
          onFilter={
            onFilter && crossField
              ? (value) => onFilter(crossField, value)
              : undefined
          }
        />
      );
    }

    // Chart
    if (isChartType && effectiveData) {
      return (
        <EChartWidget
          type={type}
          data={effectiveData}
          config={chartConfig}
          onChartReady={onChartReady}
          crossFilterField={query?.x}
          runtimeFilters={runtimeFilters}
          minHeight={minHeight}
          isDesigner={isDesigner}
        />
      );
    }

    // Unknown
    return (
      <div className="widget-center">
        <Empty description={`Unknown widget type: ${type}`} />
      </div>
    );
  };

  return (
    <div className="widget-content-root">
      {renderContent()}
      {isLoading && (
        <div className={activeOverlayClass} style={activeOverlayStyle}>
          <AppLoadingIndicator variant="minimal" tip="Updating..." />
        </div>
      )}
    </div>
  );
};
