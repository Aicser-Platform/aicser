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
import type { WidgetInstance } from '../../dashboards/stores/useDashboardStore';
import { FeedPreviewEmpty } from './FeedPreviewEmpty';
import { FeedDashboardPreviewGrid } from './FeedDashboardPreviewGrid';
import { FEED_DASHBOARD_PREVIEW_MAX } from '../utils/feedDashboardPreviewLayout';

type Props = {
  item: FeedItem;
  maxWidgets?: number;
};

const DEFAULT_MAX = FEED_DASHBOARD_PREVIEW_MAX;

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
    const skeletonCount = Math.min(Math.max(maxWidgets, 1), DEFAULT_MAX);
    return (
      <div className={`grid gap-2 w-full ${skeletonCount === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg bg-[var(--ant-color-fill-secondary)] animate-pulse"
            style={{ height: skeletonCount === 1 ? 220 : 160 }}
          />
        ))}
      </div>
    );
  }

  if (!widgets || widgets.length === 0) {
    return <FeedPreviewEmpty label={t('detail_no_charts')} hint={t('open_to_see_more')} />;
  }

  const totalWidgets = item.asset.widgetCount ?? widgets.length;

  return (
    <FeedDashboardPreviewGrid
      widgets={widgets}
      maxWidgets={maxWidgets}
      totalWidgetCount={totalWidgets}
    />
  );
}

export default FeedDashboardChartGrid;
