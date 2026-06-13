'use client';

/**
 * FeedDashboardChartGrid — renders the REAL charts of a published dashboard in the feed card.
 *
 * Uses the same proven path as the single-chart feed preview (ChartLivePreview):
 * chartService.listCharts → executeChart per widget → WidgetPreview (the renderer the
 * dashboard Studio uses). This shows the actual dashboard, not a synthetic cover.
 */

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import { chartService } from '../../dashboards/services/chartService';
import { WidgetPreview } from '../../dashboards/widgets/WidgetPreview';
import type { WidgetInstance } from '../../dashboards/stores/useDashboardStore';
import { FeedPreviewEmpty } from './FeedPreviewEmpty';

type Props = {
  item: FeedItem;
  maxWidgets?: number;
};

const DEFAULT_MAX = 4;
const TILE_MIN_HEIGHT = 150;

export function FeedDashboardChartGrid({ item, maxWidgets = DEFAULT_MAX }: Props) {
  const t = useTranslations('feed');
  const dashboardId = item.asset.dashboardId;
  const [widgets, setWidgets] = useState<WidgetInstance[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dashboardId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const charts = await chartService.listCharts(dashboardId);
        // Skip text/markdown widgets; keep visual charts that read well as thumbnails.
        const visual = (charts || []).filter((c) => c.chartType && c.chartType !== 'text');
        const top = visual.slice(0, maxWidgets);
        const built = await Promise.all(
          top.map(async (c) => {
            const execution = await chartService.executeChart(dashboardId, c.id).catch(() => null);
            return {
              id: `feed-dash-${item.id}-${c.id}`,
              title: c.title,
              chartType: c.chartType as WidgetInstance['chartType'],
              chartData: (execution as { data?: unknown } | null)?.data ?? undefined,
              chartOptions: c.chartOptions,
              chartQuery: c.chartQuery,
              dataSourceId: c.dataSourceId ?? null,
              isLoading: false,
              error: null,
            } as WidgetInstance;
          }),
        );
        if (!cancelled) setWidgets(built);
      } catch {
        if (!cancelled) setWidgets(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboardId, item.id, maxWidgets]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-2 w-full">
        {Array.from({ length: Math.min(maxWidgets, 4) }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg bg-[var(--ant-color-fill-secondary)] animate-pulse"
            style={{ height: TILE_MIN_HEIGHT }}
          />
        ))}
      </div>
    );
  }

  if (!widgets || widgets.length === 0) {
    return <FeedPreviewEmpty label={t('detail_no_charts')} hint={t('view_full_dashboard')} />;
  }

  // Single chart → full width; multiple → responsive 2-col grid.
  const cols = widgets.length === 1 ? 'grid-cols-1' : 'grid-cols-2';
  const totalWidgets = item.asset.widgetCount ?? widgets.length;
  const overflow = Math.max(0, totalWidgets - widgets.length);

  return (
    <div className="feed-dashboard-chart-grid">
      <div className={`grid ${cols} gap-2 w-full`}>
        {widgets.map((w) => (
          <div
            key={w.id}
            className="rounded-lg overflow-hidden border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]"
            style={{ minHeight: TILE_MIN_HEIGHT }}
          >
            <WidgetPreview widget={w} readOnly minHeight={TILE_MIN_HEIGHT} />
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <div className="mt-2 text-xs font-medium text-[var(--ant-color-text-secondary)]">
          +{overflow} more {overflow === 1 ? 'widget' : 'widgets'} · open to view the full dashboard
        </div>
      )}
    </div>
  );
}

export default FeedDashboardChartGrid;
