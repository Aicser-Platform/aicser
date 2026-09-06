'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty } from 'antd';
import { useTranslations } from 'next-intl';
import { WidgetPreview } from '@/app/(dashboard)/dashboards/widgets/WidgetPreview';
import { DashboardViewerGrid } from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerGrid';
import { DashboardPageTabs } from '@/app/(dashboard)/dashboards/components/DashboardPageTabs';
import { shouldShowWidgetHeader } from '@/app/(dashboard)/dashboards/utils/widgetCardHelpers';
import { filterVisibleWidgets, filterVisibleLayout } from '@/app/(dashboard)/dashboards/utils/dashboardViewerScope';
import type { FeedItem } from '@/services/socialFeedService';
import type { WidgetInstance } from '@/app/(dashboard)/dashboards/stores/useDashboardStore';
import { resolveBackendMediaUrl } from '@/utils/mediaUrl';
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
  const pages = useMemo(() => payload?.visuals.pages || [], [payload]);
  const defaultPageId = pages[0]?.id ?? null;
  const [activePageId, setActivePageId] = useState<string | null>(defaultPageId);

  // Pages are captured per-snapshot, so a different feed item (or a re-captured
  // snapshot with a different first page) should reset the active tab instead
  // of keeping whatever was selected for the previous payload.
  useEffect(() => {
    setActivePageId(defaultPageId);
  }, [defaultPageId]);

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
    // No dashboard-widget snapshot exists for this post — true for every non-
    // dashboard/chart share today (executive reports among them), since their
    // content isn't widget-shaped. Falling back to a bare "unavailable" empty
    // state discarded title/excerpt/thumbnail data that publishing already
    // captured correctly — this renders that instead of nothing.
    const excerpt = item.asset.excerpt || item.description;
    const thumbnail = resolveBackendMediaUrl(item.asset.thumbnailUrl);
    if (excerpt || thumbnail) {
      return (
        <div className="feed-snapshot-viewer feed-snapshot-viewer--text-fallback rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] overflow-hidden">
          {thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbnail} alt={item.title} className="block w-full max-h-[420px] object-cover object-top" />
          ) : null}
          {excerpt ? (
            <p className="m-0 p-5 text-sm leading-relaxed text-[var(--ant-color-text-secondary)] whitespace-pre-line">
              {excerpt}
            </p>
          ) : null}
        </div>
      );
    }
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
    // Multi-page dashboards capture every page's widgets into one payload, each
    // page using its own x/y coordinate space — rendering them all on a single
    // grid at once makes widgets from different pages overlap. Scope to the
    // active page first, same as the live dashboard viewer does.
    const pageWidgets = filterVisibleWidgets(widgets, layoutForWidgets, activePageId, pages, defaultPageId);
    const pageLayout = filterVisibleLayout(layoutForWidgets, pageWidgets);

    // A snapshot only ever captures a FEATURED subset of the source dashboard's
    // widgets (buildDashboardSnapshotPayload caps at 6, ranked by relevance),
    // not necessarily all of them — a flat canvas floor sized for "a normal
    // full dashboard" left a couple of small, compact featured widgets
    // floating in a mostly-empty box well past 480px tall. Deriving the floor
    // from this snapshot's own actual widget footprint (max row extent × the
    // grid's real row-height+margin, from DashboardViewerGrid's rowHeight=42/
    // margin=[8,8]) means a 1-2-widget snapshot gets a canvas sized to what it
    // actually shows, while a richer one still grows the same way it always did.
    const maxRowExtent = pageLayout.length ? Math.max(...pageLayout.map((item) => item.y + item.h)) : 0;
    const contentHeightPx = maxRowExtent * (42 + 8);
    const detailCanvasMinHeight = `${Math.max(200, contentHeightPx + 32)}px`;

    // 'preserve' uses the widgets' actual saved x/y/w/h, so the snapshot lands in
    // the same place and at the same size as the original dashboard design —
    // the same grid component and layout mode the live dashboard path uses.
    return (
      <div className="feed-snapshot-viewer feed-snapshot-viewer--detail">
        {pages.length > 1 ? (
          <div className="mb-2">
            <DashboardPageTabs pages={pages} activePageId={activePageId} onSelect={setActivePageId} readOnly showEmptyPlaceholder={false} />
          </div>
        ) : null}
        <DashboardViewerGrid
          widgets={pageWidgets}
          layout={pageLayout}
          dashboardId={dashboardId}
          runtimeFilters={[]}
          onCrossFilter={noopCrossFilter}
          canvasMinHeight={detailCanvasMinHeight}
          layoutMode="preserve"
        />
      </div>
    );
  }
}

export default FeedSnapshotViewer;
