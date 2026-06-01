'use client';

import React, { useMemo } from 'react';
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
  const isSnapshot = useMemo(
    () => item.renderMode === 'snapshot' && Boolean(item.asset.snapshotPayload),
    [item.renderMode, item.asset.snapshotPayload],
  );

  if (isSnapshot) {
    return <FeedSnapshotViewer item={item} variant={variant} maxWidgets={maxWidgets} />;
  }

  if (item.assetType === 'dashboard') {
    return (
      <FeedDashboardViewer
        dashboardId={item.assetId}
        variant={variant}
        maxWidgets={maxWidgets}
        onReady={onReady}
      />
    );
  }

  return <FeedSnapshotViewer item={item} variant={variant} maxWidgets={maxWidgets} />;
}

export default FeedPostViewer;
