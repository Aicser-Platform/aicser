'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty } from 'antd';
import { useTranslations } from 'next-intl';
import { DashboardViewerGrid } from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerGrid';
import { DashboardPageTabs } from '@/app/(dashboard)/dashboards/components/DashboardPageTabs';
import { filterVisibleWidgets, filterVisibleLayout } from '@/app/(dashboard)/dashboards/utils/dashboardViewerScope';
import type { FeedItem } from '@/services/socialFeedService';
import { resolveFeedPostSummary } from '@/components/Feed/feedPostDisplay';
import { isVideoMediaUrl, resolveBackendMediaUrl } from '@/utils/mediaUrl';
import '@/app/(dashboard)/dashboards/DashboardStudio.css';
import {
  snapshotLayoutFromPayload,
  snapshotWidgetsFromPayload,
  type FeedSnapshotPayload,
} from '../utils/buildFeedSnapshotPayload';
import { FEED_DASHBOARD_PREVIEW_MAX, isFeedPreviewableWidget, pickFeedPreviewWidgets } from '../utils/feedDashboardPreviewLayout';
import { FeedDashboardPreviewGrid } from './FeedDashboardPreviewGrid';

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
    const candidates = [...featured, ...orderedWidgets.filter((widget) => !featuredSet.has(widget.id))].filter(
      (widget) => isFeedPreviewableWidget(widget.chartType),
    );
    const limit = maxWidgets ?? FEED_DASHBOARD_PREVIEW_MAX;
    return pickFeedPreviewWidgets(candidates, limit);
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
    const excerpt = resolveFeedPostSummary(item) || item.asset.excerpt || item.description;
    const thumbnail = resolveBackendMediaUrl(item.asset.thumbnailUrl);
    if (excerpt || thumbnail) {
      return (
        <div className="feed-snapshot-viewer feed-snapshot-viewer--text-fallback overflow-hidden bg-[var(--ant-color-bg-container)]">
          {thumbnail ? (
            isVideoMediaUrl(thumbnail) ? (
              <video
                src={thumbnail}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="block w-full max-h-[420px] object-contain bg-[var(--ant-color-bg-container)]"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbnail} alt={item.title} className="block w-full max-h-[420px] object-contain object-top bg-[var(--ant-color-bg-container)]" />
            )
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
    const previewableCount = pickFeedPreviewWidgets(orderedWidgets, 999).length;
    return (
      <FeedDashboardPreviewGrid
        widgets={widgets}
        maxWidgets={maxWidgets ?? FEED_DASHBOARD_PREVIEW_MAX}
        totalWidgetCount={previewableCount}
      />
    );
  }

  if (variant === 'detail') {
    // Multi-page dashboards capture every page's widgets into one payload, each
    // page using its own x/y coordinate space — rendering them all on a single
    // grid at once makes widgets from different pages overlap. Scope to the
    // active page first, same as the live dashboard viewer does.
    const pageWidgets = filterVisibleWidgets(widgets, layoutForWidgets, activePageId, pages, defaultPageId);
    const pageLayout = filterVisibleLayout(layoutForWidgets, pageWidgets);

    // Studio publish captures every widget; feed-attach snapshots may be a
    // smaller ranked set. Size the canvas to this payload's own footprint so a
    // 1–2 widget snapshot is not stranded in a huge empty box.
    const maxRowExtent = pageLayout.length ? Math.max(...pageLayout.map((item) => item.y + item.h)) : 0;
    const contentHeightPx = maxRowExtent * (42 + 8);
    const detailCanvasMinHeight = `${Math.max(contentHeightPx + 16, 240)}px`;

    return (
      <div className="feed-snapshot-viewer feed-snapshot-viewer--detail w-full">
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
          hideInteractionHint
          eagerMount
        />
      </div>
    );
  }
}

export default FeedSnapshotViewer;
