'use client';

import React, { useMemo } from 'react';
import { Card, Empty } from 'antd';
import { useTranslations } from 'next-intl';
import { WidgetPreview } from '@/app/(dashboard)/dashboards/widgets/WidgetPreview';
import { shouldShowWidgetHeader } from '@/app/(dashboard)/dashboards/utils/widgetCardHelpers';
import type { FeedItem } from '@/services/socialFeedService';
import {
  snapshotLayoutFromPayload,
  snapshotWidgetsFromPayload,
  type FeedSnapshotPayload,
} from '../utils/buildFeedSnapshotPayload';

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
          {widgets.map((widget) => {
            const showHeader = shouldShowWidgetHeader(widget);

            return (
              <Card
                key={widget.id}
                size="small"
                title={showHeader ? widget.title : undefined}
                className="min-w-0 overflow-hidden rounded-lg border-[var(--ant-color-border-secondary)] bg-[color-mix(in_srgb,var(--ant-color-bg-container)_94%,transparent)] shadow-sm transition-shadow group-hover/media:shadow-md"
                classNames={{
                  header: 'min-h-7 px-2 py-0',
                  title: 'truncate py-1 text-xs font-semibold leading-5',
                  body: 'min-w-0 p-0.5',
                }}
              >
                <div className="w-full min-w-0 overflow-hidden rounded-md">
                  <WidgetPreview widget={widget} readOnly compactPreview minHeight={widgetMinHeight} />
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  if (variant === 'detail') {
    const widgetMinHeight = widgets.length === 1 ? 360 : 260;

    return (
      <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] items-stretch gap-4">
        {widgets.map((widget) => {
          const showHeader = shouldShowWidgetHeader(widget);

          return (
            <Card
              key={widget.id}
              size="small"
              title={showHeader ? widget.title : undefined}
              className="h-full min-w-0 overflow-hidden border-[var(--ant-color-border-secondary)] shadow-none"
              classNames={{
                header: 'min-h-11 px-4',
                body: 'min-w-0 p-3',
              }}
            >
              <div className="w-full min-w-0 overflow-hidden rounded-md">
                <WidgetPreview widget={widget} readOnly minHeight={widgetMinHeight} />
              </div>
            </Card>
          );
        })}
      </div>
    );
  }
}

export default FeedSnapshotViewer;
