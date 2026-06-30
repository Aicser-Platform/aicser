'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Empty, Spin } from 'antd';
import { TableWidget } from './TableWidget';
import { StatWidget } from './StatWidget';
import { TextWidget } from './TextWidget';
import { SlicerWidget } from './SlicerWidget';
import { EmbedWidget } from './EmbedWidget';
import { getCrossFilterValues } from '../utils/filterOperators';
import type * as echarts from 'echarts';
import { extractEchartsSnapshotOption } from '@/components/charts/resolveChatChart';
import { getColorsFromPalette } from './WidgetRendererConfig';
import { hasRenderableChartData } from '@/components/charts/chartDesignerBridge';
import { resolveChartPaletteId } from '../utils/chartPaletteCatalog';
import { enhanceEchartsInteractivity } from './utils/enhanceEchartsInteractivity';
import { getFriendlyWidgetError } from '../utils/widgetErrorDisplay';

const GeoMapWidget = dynamic(
  () => import('./GeoMapWidget').then((m) => m.GeoMapWidget),
  { ssr: false, loading: () => <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div> }
);

const EChartWidget = dynamic(
  () => import('./EChartWidget').then((m) => m.EChartWidget),
  { ssr: false, loading: () => <div style={{ minHeight: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spin /></div> }
);

const RawEChartWidget = dynamic(
  () => import('./RawEChartWidget').then((m) => m.RawEChartWidget),
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
  /** Canvas slicers stay interactive in view / presentation even when the canvas is read-only. */
  const effectiveReadOnly = type === 'slicer' && onFilter ? false : readOnly;
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
  const effectiveData = prefetchedData ?? data;

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
            <Spin tip="Updating..." size="small" />
          </div>
        )}
      </div>
    );
  }

  const isChartType = ['bar', 'line', 'area', 'pie', 'scatter', 'funnel', 'heatmap', 'donut', 'gauge', 'treemap', 'waterfall', 'bullet'].includes(type);
  const isGeo = type === 'geo';
  const activeOverlayClass = 'widget-loading-overlay';

  // Error state
  if (error) {
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

  // Slicer / filter control
  if (type === 'slicer') {
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
            }}
          >
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

  // Image Widget
  if (type === 'image') {
    const src = config.imageUrl || config.src;
    if (!src) {
      return (
        <div className="widget-center" style={{ flexDirection: 'column', gap: 8 }}>
          <Empty description="No image URL set" imageStyle={{ height: 40 }} />
          <span style={{ fontSize: 12, color: 'var(--studio-text-muted)' }}>Set URL in properties →</span>
        </div>
      );
    }
    return (
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', alignItems: config.align || 'center', justifyContent: config.justify || 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={config.altText || ''}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: config.objectFit || 'contain',
            borderRadius: config.borderRadius || 0,
          }}
        />
      </div>
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
            <Spin tip="Updating…" size="small" />
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
      ((type === 'stat' || type === 'gauge') && effectiveData.value !== undefined && effectiveData.value !== null));

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
    pointerEvents: 'auto',
  };

  const renderContent = () => {
    // Table
    if (type === 'table') {
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
      return <StatWidget data={effectiveData} config={config} />;
    }

    // Chart
    if (isChartType && effectiveData) {
      return (
        <EChartWidget
          type={type}
          data={effectiveData}
          config={config}
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
          <Spin tip="Updating..." size="small" />
        </div>
      )}
    </div>
  );
};
