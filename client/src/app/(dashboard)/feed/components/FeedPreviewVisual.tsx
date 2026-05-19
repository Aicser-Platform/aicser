'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { BulbOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
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

interface FeedPreviewVisualProps {
  item: FeedItem;
  maxPreviews?: number;
  showOverflowBadge?: boolean;
}

const PIE_COLORS = ['#1877f2', '#38bdf8', '#f59e0b', '#10b981'];
const DASHBOARD_PREVIEW_LIMIT = 4;
const DASHBOARD_PREVIEW_MIN_HEIGHT = 160;
const DASHBOARD_PREVIEW_CHART_CONFIG = {
  legendFontSize: 14,
  legendFontWeight: 400,
  axisLabelFontSize: 12,
  axisLabelColor: 'var(--ant-color-text-secondary)',
  gridLineOpacity: 0.15,
  lineWidth: 3,
  symbolSize: 6,
};

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
    return <div className={`${chartClass} feed-card-chart--empty`}>No preview data yet</div>;
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
                  <stop offset="5%" stopColor="var(--feed-accent)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--feed-accent)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <YAxis hide />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--feed-accent)"
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
                  <stop offset="5%" stopColor="var(--feed-accent)" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="var(--feed-accent)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--feed-border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={tickStyle} />
              <YAxis hide />
              {showTooltip && <Tooltip cursor={false} contentStyle={tooltipStyle} />}
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--feed-accent)"
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
            {!compact && <CartesianGrid stroke="var(--feed-border)" strokeDasharray="3 3" vertical={false} />}
            <XAxis dataKey="label" axisLine={false} tickLine={false} hide={!showAxes} tick={tickStyle} />
            <YAxis hide />
            {showTooltip && <Tooltip cursor={false} contentStyle={tooltipStyle} />}
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--feed-accent)"
              strokeWidth={compact ? 2 : 3}
              dot={false}
              activeDot={compact ? false : { r: 4, fill: 'var(--feed-accent)', stroke: '#ffffff', strokeWidth: 2 }}
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
          {!compact && <CartesianGrid stroke="var(--feed-border)" strokeDasharray="3 3" vertical={false} />}
          <XAxis dataKey="label" axisLine={false} tickLine={false} hide={!showAxes} tick={tickStyle} />
          <YAxis hide />
          {showTooltip && <Tooltip cursor={{ fill: 'rgba(17, 197, 217, 0.08)' }} contentStyle={tooltipStyle} />}
          <Bar dataKey="value" radius={[5, 5, 0, 0]} fill="var(--feed-accent)" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

const DashboardLivePreview: React.FC<FeedPreviewVisualProps> = ({ item, maxPreviews, showOverflowBadge = false }) => {
  const router = useRouter();
  const previewLimit =
    typeof maxPreviews === 'number' ? Math.min(maxPreviews, DASHBOARD_PREVIEW_LIMIT) : DASHBOARD_PREVIEW_LIMIT;
  const [widgets, setWidgets] = useState<WidgetInstance[]>([]);
  const [totalCharts, setTotalCharts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (item.assetType !== 'dashboard' || !item.assetId) return;

    let active = true;
    setLoading(true);
    setError(null);

    chartService
      .listCharts(item.assetId)
      .then(async (charts: any[]) => {
        // Reverse so the most recently added chart appears first in the feed preview
        const reversed = [...charts].reverse();
        const limited = reversed.slice(0, previewLimit);
        const widgetList = await Promise.all(
          limited.map(async (chart) => {
            const widgetId = `feed-${item.assetId}-${chart.id}`;
            let chartData = undefined;
            let chartError: string | null = null;
            const chartOptions = { ...(chart.chartOptions || {}), ...DASHBOARD_PREVIEW_CHART_CONFIG };

            if (chart.chartType === 'table') {
              chartOptions.showPagination = false;
              chartOptions.bordered = false;
              chartOptions.size = 'small';
            }

            if (chart.chartType !== 'text') {
              try {
                const response = await chartService.executeChart(item.assetId, chart.id);
                chartData = response.data;
              } catch (err) {
                chartError = err instanceof Error ? err.message : 'Failed to load chart data';
              }
            }

            return {
              id: widgetId,
              chartId: chart.id,
              dataSourceId: chart.dataSourceId ?? null,
              title: chart.title || 'Untitled Chart',
              chartType: chart.chartType,
              chartQuery: chart.chartQuery,
              chartOptions,
              chartData,
              isLoading: false,
              error: chartError,
            } as WidgetInstance;
          })
        );

        if (!active) return;
        setWidgets(widgetList);
        setTotalCharts(reversed.length);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard preview');
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [item.assetId, item.assetType, previewLimit, refreshToken]);

  useEffect(() => {
    const triggerRefresh = () => setRefreshToken((prev) => prev + 1);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') triggerRefresh();
    };

    window.addEventListener('focus', triggerRefresh);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('focus', triggerRefresh);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const gridCount = Math.min(Math.max(widgets.length, 1), DASHBOARD_PREVIEW_LIMIT);

  const handleViewDashboard = (event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.stopPropagation();
    if (!item.assetId) return;
    router.push('/dashboards');
  };

  if (loading && widgets.length === 0) {
    const skeletonCount = previewLimit;
    const skeletonGridClass = skeletonCount >= 2 ? `grid grid-cols-2 gap-3 w-full` : `grid grid-cols-1 w-full gap-2`;
    return (
      <div className={skeletonGridClass}>
        {Array.from({ length: skeletonCount }).map((_, index) => (
          <div
            key={`dashboard-skeleton-${index}`}
            className="relative bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-xl overflow-hidden shadow-sm aspect-video"
          >
            <div className="w-full h-full bg-[var(--ant-color-border-secondary)] animate-pulse rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  if (error || widgets.length === 0) {
    return (
      <div className="grid grid-cols-1 w-full gap-2">
        <div className="flex items-center justify-center p-4 border border-dashed border-[var(--ant-color-border)] rounded-lg text-[var(--ant-color-text-description)] text-xs">
          {error ? 'Unable to load dashboard preview' : 'No charts available'}
        </div>
      </div>
    );
  }

  const overflow = Math.max(0, totalCharts - widgets.length);

  return (
    <div
      className={`grid gap-2 w-full ${gridCount >= 2 ? 'grid-cols-2' : 'grid-cols-1'} ${gridCount > 2 ? 'grid-rows-2' : ''}`}
    >
      {widgets.map((widget, index) => (
        <div
          key={widget.id}
          className="relative bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border-secondary)] rounded-lg overflow-hidden shadow-sm aspect-[4/3]"
        >
          <div className="absolute inset-0 p-2">
            <div className="w-full h-full">
              <WidgetPreview widget={widget} readOnly minHeight={DASHBOARD_PREVIEW_MIN_HEIGHT} />
            </div>
          </div>
          {showOverflowBadge && overflow > 0 && index === widgets.length - 1 && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900/60 backdrop-blur-sm text-white cursor-pointer z-10 hover:bg-gray-900/70 transition-colors"
              role="button"
              tabIndex={0}
              onClick={handleViewDashboard}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  handleViewDashboard(event);
                }
              }}
            >
              <span className="font-semibold mb-1">View full dashboard</span>
              <span className="text-sm opacity-80">{`${overflow} more charts`}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const FeedPreviewVisual: React.FC<FeedPreviewVisualProps> = ({ item, maxPreviews, showOverflowBadge = false }) => {
  const previews = useMemo(() => normalizePreviews(item), [item]);

  if (item.assetType === 'dashboard') {
    return <DashboardLivePreview item={item} maxPreviews={maxPreviews} showOverflowBadge={showOverflowBadge} />;
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

  // Single chart - wrap with insights strip
  const summaryText =
    item.asset.summary?.trim() || item.description?.trim() || 'Open this post to explore the full analysis.';
  const tagsText = (item.tags ?? [])
    .slice(0, 4)
    .map((tag) => `#${tag}`)
    .join(' ');
  return (
    <div className="flex flex-col gap-3 w-full">
      {renderPreview(previews[0], item.id, 0, false)}
      <div className="bg-[var(--ant-color-primary-bg)]/50 rounded-lg p-4 border border-[var(--ant-color-primary-border)] flex gap-3 mt-2">
        <div className="shrink-0 mt-0.5">
          <BulbOutlined className="text-[var(--ant-color-primary)] text-lg" />
        </div>
        <div className="flex flex-col gap-2 w-full">
          <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2">
            <span className="text-xs font-semibold text-[var(--ant-color-primary)] bg-[var(--ant-color-primary-bg)] px-2 py-0.5 rounded shadow-sm shrink-0 w-max">
              Summary
            </span>
            <span className="text-sm text-[var(--ant-color-text)] leading-relaxed">{summaryText}</span>
          </div>
          {tagsText && (
            <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 mt-1">
              <span className="text-xs font-semibold text-[var(--ant-color-info)] bg-[var(--ant-color-info-bg)] px-2 py-0.5 rounded shadow-sm shrink-0 w-max">
                Tags
              </span>
              <span className="text-sm text-[var(--ant-color-info)] font-medium">{tagsText}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FeedPreviewVisual;
