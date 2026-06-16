'use client';

import React from 'react';
import type { FeedItem } from '@/services/socialFeedService';
import { FeedDashboardViewer } from './FeedDashboardViewer';
import { FeedSnapshotViewer } from './FeedSnapshotViewer';

type Props = {
  item: FeedItem;
  variant?: 'card' | 'detail';
  maxWidgets?: number;
  onReady?: (info: { widgetCount: number }) => void;
};

/** Routes feed posts to snapshot or legacy live viewer. */
export function FeedPostViewer({ item, variant = 'detail', maxWidgets, onReady }: Props) {
  // Snapshot posts are immutable. Never fetch the source dashboard while rendering one.
  if (item.renderMode === 'snapshot') {
    return <FeedSnapshotViewer item={item} variant={variant} maxWidgets={maxWidgets} />;
  }

  if (item.assetType === 'dashboard' && item.assetId) {
    return (
      <FeedDashboardViewer dashboardId={item.assetId} variant={variant} maxWidgets={maxWidgets} onReady={onReady} />
    );
  }

  return <FeedSnapshotViewer item={item} variant={variant} maxWidgets={maxWidgets} />;
}

export default FeedPostViewer;
