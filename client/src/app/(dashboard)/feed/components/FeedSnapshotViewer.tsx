'use client';

import React, { useCallback, useMemo } from 'react';
import { Empty } from 'antd';
import { useTranslations } from 'next-intl';
import { WidgetPreview } from '@/app/(dashboard)/dashboards/widgets/WidgetPreview';
import { DashboardViewerGrid } from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerGrid';
import { shouldShowWidgetHeader } from '@/app/(dashboard)/dashboards/utils/widgetCardHelpers';
import type { FeedItem } from '@/services/socialFeedService';
import type { WidgetInstance } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
// Same stylesheet the dashboard canvas and shared/embed viewers load (see
// FeedDashboardViewer.tsx) — needed here too, since this snapshot path renders
// widgets through the .widget-card / .widget-card-body structure below.
import '@/app/(dashboard)/dashboards/DashboardStudio.css';
import {
  snapshotLayoutFromPayload,
  snapshotWidgetsFromPayload,
  type FeedSnapshotPayload,
} from '../utils/buildFeedSnapshotPayload';

/**
 * Renders one widget using the exact same `.widget-card` / `.widget-card-header` /
 * `.widget-card-body` structure as `DashboardViewerGrid` (the canvas's read-only
 * grid). Reusing that structure — not an ad-hoc Ant `Card` — is what lets
 * `WidgetPreview`'s flex-fill chart sizing (`.widget-content-root` /
 * `.widget-chart-shell`) work, and keeps snapshots visually identical to the canvas.
 * The wrapper gets an explicit pixel height (snapshots aren't on a react-grid-layout
 * track, so there's no row height to inherit `height: 100%` from).
 */
function SnapshotWidgetCard({
  widget,
  minHeight,
  compactPreview = false,
}: {
  widget: WidgetInstance;
  minHeight: number;
  compactPreview?: boolean;
}) {
  const showHeader = shouldShowWidgetHeader(widget);

  return (
    <div
      className={`widget-card widget-type-${widget.chartType} ${!showHeader ? 'header-hidden' : ''}`}
      style={{ height: minHeight }}
    >
      {showHeader && (
        <div className="widget-card-header widget-card-header-stack">
          <span className="widget-card-title">{widget.title}</span>
          {typeof widget.chartOptions?.subtitle === 'string' && widget.chartOptions.subtitle.trim() ? (
            <span className="widget-card-subtitle">{widget.chartOptions.subtitle}</span>
          ) : null}
        </div>
      )}
      <div className="widget-card-body no-drag">
        <WidgetPreview widget={widget} readOnly compactPreview={compactPreview} />
      </div>
    </div>
  );
}

type Props = {
  item: FeedItem;
  variant?: 'card' | 'detail';
  maxWidgets?: number;
};

/**
 * Read-only renderer for snapshot-mode feed posts (immutable captured payload).
 */
export function FeedSnapshotViewer({ item, variant = 'detail', maxWidgets }: Props) {
  const t = useTranslations('feed');
  const noopCrossFilter = useCallback(() => {}, []);

  const payload = (item.asset.snapshotPayload || null) as FeedSnapshotPayload | null;
  const allWidgets = useMemo(() => snapshotWidgetsFromPayload(payload), [payload]);
  const allLayout = useMemo(() => snapshotLayoutFromPayload(payload), [payload]);

  const orderedWidgets = useMemo(() => {
    const positionById = new Map(allLayout.map((layout) => [layout.i, layout]));

    return [...allWidgets].sort((left, right) => {
      const leftPosition = positionById.get(left.id);
      const rightPosition = positionById.get(right.id);

      if (!leftPosition && !rightPosition) return 0;
      if (!leftPosition) return 1;
      if (!rightPosition) return -1;

      return leftPosition.y - rightPosition.y || leftPosition.x - rightPosition.x;
    });
  }, [allLayout, allWidgets]);

  const widgets = useMemo(() => {
    if (variant !== 'card') return orderedWidgets;

    const featuredIds = payload?.visuals.presentation?.featuredWidgetIds || [];
    const widgetById = new Map(orderedWidgets.map((widget) => [widget.id, widget]));
    const featured = featuredIds
      .map((id) => widgetById.get(id))
      .filter((widget): widget is (typeof orderedWidgets)[number] => Boolean(widget));
    const featuredSet = new Set(featured.map((widget) => widget.id));
    const candidates = [...featured, ...orderedWidgets.filter((widget) => !featuredSet.has(widget.id))];
    return maxWidgets ? candidates.slice(0, maxWidgets) : candidates;
  }, [maxWidgets, orderedWidgets, payload?.visuals.presentation?.featuredWidgetIds, variant]);

  const layoutForWidgets = useMemo(
    () => allLayout.filter((position) => widgets.some((widget) => widget.id === position.i)),
    [allLayout, widgets]
  );
  const dashboardId = payload?.provenance?.dashboardId || item.assetId || item.id;

  if (!payload || !widgets.length) {
    return (
      <div className="feed-snapshot-viewer feed-snapshot-viewer--empty">
        <Empty description={t('snapshot_unavailable')} />
      </div>
    );
  }

  if (variant === 'card') {
    const widgetMinHeight = widgets.length === 1 ? 300 : 132;

    return (
      <div className="relative min-h-[420px] overflow-hidden rounded-xl border border-[var(--ant-color-border-secondary)] bg-gradient-to-br from-[var(--ant-color-primary-bg)] via-[var(--ant-color-bg-container)] to-[var(--ant-color-fill-quaternary)] p-1.5 shadow-inner">
        <div className={`grid min-h-0 grid-cols-2 gap-1.5 ${widgets.length === 1 ? 'grid-cols-1' : ''}`}>
          {widgets.map((widget) => (
            <SnapshotWidgetCard key={widget.id} widget={widget} minHeight={widgetMinHeight} compactPreview />
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'detail') {
    // 'preserve' uses the widgets' actual saved x/y/w/h, so the snapshot lands in
    // the same place and at the same size as the original dashboard design —
    // the same grid component and layout mode the live dashboard path uses.
    return (
      <DashboardViewerGrid
        widgets={widgets}
        layout={layoutForWidgets}
        dashboardId={dashboardId}
        runtimeFilters={[]}
        onCrossFilter={noopCrossFilter}
        canvasMinHeight="480px"
        layoutMode="preserve"
      />
    );
  }
}

export default FeedSnapshotViewer;
