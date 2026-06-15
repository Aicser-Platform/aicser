'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { FeedAssetPreview, FeedItem, FeedPreviewType } from '@/services/socialFeedService';
import { chartService } from '../../dashboards/services/chartService';
import { WidgetPreview } from '../../dashboards/widgets/WidgetPreview';
import type { WidgetInstance } from '../../dashboards/stores/useDashboardStore';
import { FeedPostViewer } from './FeedPostViewer';
import { FeedDashboardChartGrid } from './FeedDashboardChartGrid';
import { FeedPreviewEmpty } from './FeedPreviewEmpty';

interface FeedPreviewVisualProps {
  item: FeedItem;
  maxPreviews?: number;
  showOverflowBadge?: boolean;
}

const PIE_COLORS = ['#1877f2', '#38bdf8', '#f59e0b', '#10b981'];
const DASHBOARD_PREVIEW_LIMIT = 6;
const INSIGHT_CHART_MIN_HEIGHT = 200;

type ChartPoint = {
  label: string;
  value: number;
};

const buildSeries = (input?: number[]): ChartPoint[] => {
  if (!Array.isArray(input) || input.length === 0) return [];
  return input.map((value, index) => ({
    label: `W${index + 1}`,
    value,
  }));
};

const normalizePreviews = (item: FeedItem): FeedAssetPreview[] => {
  if (item.asset.previews && item.asset.previews.length > 0) {
    return item.asset.previews;
  }

  const fallbackType: FeedPreviewType =
    item.asset.previewType || (item.assetType === 'dashboard' ? 'dashboard' : 'bar');
  return [{ type: fallbackType, data: item.asset.previewData }];
};

const tooltipStyle = {
  borderRadius: 10,
  border: '1px solid var(--ant-color-border)',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
  fontSize: 12,
  background: 'var(--ant-color-bg-elevated)',
  color: 'var(--ant-color-text)',
} as React.CSSProperties;
const tickStyle: React.SVGProps<SVGTextElement> = {
  fill: 'var(--ant-color-text-secondary)',
  fontSize: 11,
};

const renderPreview = (preview: FeedAssetPreview, itemId: string, index: number, compact: boolean) => {
  const series = buildSeries(preview.data);
  const chartClass = compact ? 'feed-card-chart feed-card-chart--mini' : 'feed-card-chart';
  const showTooltip = !compact;
  const showAxes = !compact;
  if (series.length === 0) {
    return (
      <div className={`${chartClass} flex items-center justify-center text-xs text-[var(--ant-color-text-tertiary)]`}>
        No preview data yet
      </div>
    );
  }

  if (preview.type === 'dashboard') {
    const latest = series[series.length - 1]?.value ?? 0;
    const first = series[0]?.value ?? latest;
    const change = latest - first;
    const changeLabel = `${change >= 0 ? '+' : ''}${change}`;
    const gradientId = `dashboardFill-${itemId}-${index}`;

    if (compact) {
      return (
        <div className="w-full h-8 overflow-hidden rounded-md bg-[var(--ant-color-bg-layout)] bg-opacity-30 flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--ant-color-primary)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--ant-color-primary)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <YAxis hide />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--ant-color-primary)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      );
    }

    return (
      <div className="w-full min-h-[140px] h-[180px] flex flex-col p-4 bg-[var(--ant-color-bg-container)] rounded-lg border border-[var(--ant-color-border-secondary)] shadow-sm relative overflow-hidden transition-shadow hover:shadow-md">
        <div className="flex justify-between items-start mb-2 z-10 w-full">
          <div>
            <div className="text-xs font-semibold text-[var(--ant-color-text-secondary)] uppercase tracking-wider mb-1">
              Weekly Performance
            </div>
            <div className="text-2xl font-bold text-[var(--ant-color-text)] leading-tight">{latest}</div>
          </div>
          <div
            className={
              change >= 0
                ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--ant-color-success-bg)] text-[var(--ant-color-success)]'
                : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--ant-color-bg-layout)] text-[var(--ant-color-text-secondary)]'
            }
          >
            {changeLabel}
          </div>
        </div>

        <div className="flex-1 w-full min-h-0 absolute bottom-0 left-0 right-0 h-2/3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--ant-color-primary)" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="var(--ant-color-primary)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--ant-color-border-secondary)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis hide />
              {showTooltip && <Tooltip cursor={false} contentStyle={tooltipStyle} />}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--ant-color-primary)"
                strokeWidth={2.5}
                fillOpacity={1}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }

  if (preview.type === 'pie') {
    const pieData = series.map((point) => ({ name: point.label, value: point.value }));
    return (
      <div className={chartClass}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            {showTooltip && <Tooltip contentStyle={tooltipStyle} />}
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={compact ? 20 : 32}
              outerRadius={compact ? 44 : 54}
              paddingAngle={2}
              stroke="#ffffff"
              strokeWidth={2}
            >
              {pieData.map((entry, idx) => (
                <Cell key={`cell-${entry.name}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (preview.type === 'line') {
    return (
      <div className={chartClass}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
            {!compact && (
              <CartesianGrid stroke="var(--ant-color-border-secondary)" strokeDasharray="3 3" vertical={false} />
            )}
            <XAxis dataKey="label" axisLine={false} tickLine={false} hide={!showAxes} tick={tickStyle} />
            <YAxis hide />
            {showTooltip && <Tooltip cursor={false} contentStyle={tooltipStyle} />}
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--ant-color-primary)"
              strokeWidth={compact ? 2 : 3}
              dot={false}
              activeDot={
                compact ? false : { r: 4, fill: 'var(--ant-color-primary)', stroke: '#ffffff', strokeWidth: 2 }
              }
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className={chartClass}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 8, right: 6, left: 0, bottom: 0 }}>
          {!compact && (
            <CartesianGrid stroke="var(--ant-color-border-secondary)" strokeDasharray="3 3" vertical={false} />
          )}
          <XAxis dataKey="label" axisLine={false} tickLine={false} hide={!showAxes} tick={tickStyle} />
          <YAxis hide />
          {showTooltip && <Tooltip cursor={{ fill: 'var(--ant-color-primary-bg)' }} contentStyle={tooltipStyle} />}
          <Bar dataKey="value" radius={[5, 5, 0, 0]} fill="var(--ant-color-primary)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

/**
 * ChartLivePreview — renders a single `chart` type feed item using live data.
 * Falls back to the Recharts sparkline if data cannot be fetched.
 */
const ChartLivePreview: React.FC<{ item: FeedItem }> = ({ item }) => {
  const [widget, setWidget] = useState<WidgetInstance | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const dashboardId = item.asset.dashboardId;
    const chartId = item.assetId;
    if (!dashboardId || !chartId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    Promise.all([
      chartService.getChart(dashboardId, chartId),
      chartService.executeChart(dashboardId, chartId).catch(() => null),
    ])
      .then(([chart, execution]) => {
        if (cancelled) return;
        const chartOptions = { ...(chart.chartOptions || {}) };
        setWidget({
          id: `feed-chart-${item.id}`,
          title: chart.title || item.title,
          chartType: chart.chartType as WidgetInstance['chartType'],
          chartData: execution?.data ?? undefined,
          chartOptions,
          chartQuery: chart.chartQuery,
          dataSourceId: chart.dataSourceId ?? null,
          isLoading: false,
          error: null,
        } as WidgetInstance);
      })
      .catch(() => {
        if (!cancelled) setWidget(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.assetId, item.asset.dashboardId, item.id, item.title]);

  if (loading) {
    return (
      <div className="w-full h-full min-h-[180px] flex items-center justify-center">
        <div className="w-full h-[180px] bg-[var(--ant-color-border-secondary)] animate-pulse rounded-lg" />
      </div>
    );
  }

  if (!widget) return <FeedPreviewEmpty label={item.asset.previewLabel || item.title} />;

  return (
    <div className="w-full h-full min-h-[200px] p-3">
      <WidgetPreview widget={widget} readOnly minHeight={INSIGHT_CHART_MIN_HEIGHT} />
    </div>
  );
};

const InsightChartPreview: React.FC<{ item: FeedItem }> = ({ item }) => {
  const widget = useMemo((): WidgetInstance | null => {
    const chartWidget = item.asset.chartWidget;
    if (!chartWidget?.chartType) return null;
    return {
      id: `feed-insight-${item.id}`,
      title: item.title,
      chartType: chartWidget.chartType as WidgetInstance['chartType'],
      chartData: chartWidget.chartData as WidgetInstance['chartData'],
      chartOptions: chartWidget.chartOptions,
      chartQuery: chartWidget.chartQuery,
    };
  }, [item]);

  if (widget) {
    return (
      <div className="w-full h-full min-h-[200px] p-4">
        <WidgetPreview widget={widget} readOnly minHeight={INSIGHT_CHART_MIN_HEIGHT} />
      </div>
    );
  }

  return null;
};

const DashboardSnapshotPreview: React.FC<FeedPreviewVisualProps> = ({
  item,
  maxPreviews,
  showOverflowBadge = false,
}) => {
  const router = useRouter();
  const t = useTranslations('feed');
  const previewLimit =
    typeof maxPreviews === 'number' ? Math.min(maxPreviews, DASHBOARD_PREVIEW_LIMIT) : DASHBOARD_PREVIEW_LIMIT;
  const capturedWidgetCount = (item.asset.snapshotPayload as { visuals?: { widgets?: unknown[] } } | undefined)?.visuals
    ?.widgets?.length;
  const [totalWidgets, setTotalWidgets] = useState<number | null>(
    capturedWidgetCount ?? item.asset.widgetCount ?? null
  );

  const handleViewDashboard = (event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.stopPropagation();
    if (!item.assetId) return;
    router.push(`/feed/${encodeURIComponent(item.id)}`);
  };

  const overflow = totalWidgets != null ? Math.max(0, totalWidgets - previewLimit) : 0;

  return (
    <div className="feed-dashboard-card-preview">
      <FeedPostViewer
        item={item}
        variant="card"
        maxWidgets={previewLimit}
        onReady={({ widgetCount }) => setTotalWidgets(widgetCount)}
      />
      {showOverflowBadge && overflow > 0 ? (
        <button
          type="button"
          className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium text-[var(--ant-color-text-secondary)] transition-colors hover:bg-[var(--ant-color-fill-tertiary)] hover:text-[var(--ant-color-primary)]"
          onClick={handleViewDashboard}
        >
          <span>{t('dashboard_overflow_charts', { count: overflow })}</span>
          <span aria-hidden>&middot;</span>
          <span>{t('view_full_dashboard')}</span>
        </button>
      ) : null}
    </div>
  );
};

const FeedPreviewVisual: React.FC<FeedPreviewVisualProps> = ({ item, maxPreviews, showOverflowBadge = false }) => {
  const previews = useMemo(() => normalizePreviews(item), [item]);

  if (item.assetType === 'dashboard') {
    if (item.renderMode === 'snapshot') {
      return <DashboardSnapshotPreview item={item} maxPreviews={maxPreviews} showOverflowBadge={showOverflowBadge} />;
    }

    // Legacy live posts do not carry captured chart data, so fetch a bounded preview.
    if (item.asset.dashboardId) {
      return <FeedDashboardChartGrid item={item} maxWidgets={typeof maxPreviews === 'number' ? maxPreviews : 4} />;
    }
    return <DashboardSnapshotPreview item={item} maxPreviews={maxPreviews} showOverflowBadge={showOverflowBadge} />;
  }

  // `chart` type — render live interactive chart via ECharts
  if (item.assetType === 'chart') {
    // If backend pre-serialised the chart widget, render it directly
    const hasChartWidget = Boolean(item.asset.chartWidget?.chartType);
    if (hasChartWidget) {
      return <InsightChartPreview item={item} />;
    }
    // Otherwise fetch live data (needs dashboardId in asset)
    if (item.asset.dashboardId || item.assetId) {
      return <ChartLivePreview item={item} />;
    }
    // Final fallback: sparkline
    if (previews.length > 0 && previews[0]?.data && previews[0].data.length > 0) {
      return (
        <div className="w-full h-full flex items-center justify-center p-4">
          {renderPreview(previews[0], item.id, 0, false)}
        </div>
      );
    }
    return (
      <div className="w-full h-full flex items-center justify-center p-8 text-sm text-[var(--ant-color-text-description)]">
        {item.asset.previewLabel || item.title}
      </div>
    );
  }

  if (item.assetType === 'insight') {
    const hasChartWidget = Boolean(item.asset.chartWidget?.chartType);
    if (hasChartWidget) {
      return <InsightChartPreview item={item} />;
    }
    if (previews.length > 0 && previews[0]?.data && previews[0].data.length > 0) {
      return (
        <div className="w-full h-full flex items-center justify-center p-4">
          {renderPreview(previews[0], item.id, 0, false)}
        </div>
      );
    }
    return (
      <div className="w-full h-full flex items-center justify-center p-8 text-sm text-[var(--ant-color-text-description)]">
        {item.asset.previewLabel || item.title}
      </div>
    );
  }

  if (previews.length > 1) {
    const cappedPreviews = typeof maxPreviews === 'number' ? previews.slice(0, maxPreviews) : previews;
    const overflow = Math.max(0, previews.length - cappedPreviews.length);
    const overflowLabel = `${cappedPreviews.length}+`;
    const gridCount = Math.min(cappedPreviews.length, 4);

    // Determine grid layout based on count
    let gridLayoutUrl = 'grid-cols-1';
    if (gridCount === 2) gridLayoutUrl = 'grid-cols-2';
    else if (gridCount > 2) gridLayoutUrl = 'grid-cols-2 grid-rows-2';

    return (
      <div className={`grid gap-2 w-full ${gridLayoutUrl}`}>
        {cappedPreviews.map((preview, index) => (
          <div
            key={`${preview.type}-${index}`}
            className="relative bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-lg overflow-hidden flex items-center justify-center min-h-[160px]"
          >
            {renderPreview(preview, item.id, index, true)}
            {showOverflowBadge && overflow > 0 && index === cappedPreviews.length - 1 && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-900/60 text-white font-bold text-xl backdrop-blur-sm">
                {overflowLabel}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      {renderPreview(previews[0], item.id, 0, false)}
    </div>
  );
};

export default FeedPreviewVisual;
