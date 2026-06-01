'use client';

import React, { useMemo } from 'react';
import { Empty } from 'antd';
import { useTranslations } from 'next-intl';
import { DashboardViewerGrid } from '@/app/(dashboard)/dashboards/components/viewer/DashboardViewerGrid';
import { WidgetPreview } from '@/app/(dashboard)/dashboards/widgets/WidgetPreview';
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

  const widgets =
    variant === 'card' && maxWidgets ? allWidgets.slice(0, maxWidgets) : allWidgets;
  const layout =
    variant === 'card' && maxWidgets
      ? allLayout.filter((l) => widgets.some((w) => w.id === l.i))
      : allLayout;

  if (!payload || !widgets.length) {
    return (
      <div className="feed-snapshot-viewer feed-snapshot-viewer--empty">
        <Empty description={t('snapshot_unavailable')} />
      </div>
    );
  }

  if (widgets.length === 1 && variant === 'card') {
    return (
      <div className={`feed-snapshot-viewer feed-snapshot-viewer--${variant}`}>
        <WidgetPreview widget={widgets[0]} readOnly minHeight={variant === 'card' ? 200 : 320} />
      </div>
    );
  }

  return (
    <div className={`feed-snapshot-viewer feed-snapshot-viewer--${variant}`}>
      <DashboardViewerGrid
        widgets={widgets}
        layout={layout.length ? layout : widgets.map((w, i) => ({ i: w.id, x: 0, y: i * 8, w: 12, h: 8 }))}
        dashboardId={item.assetId}
        runtimeFilters={[]}
        canvasMinHeight={variant === 'card' ? '280px' : '480px'}
      />
    </div>
  );
}

export default FeedSnapshotViewer;
