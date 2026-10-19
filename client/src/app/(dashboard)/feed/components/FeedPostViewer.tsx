'use client';

import React from 'react';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import type { FeedItem } from '@/services/socialFeedService';
import { FeedDashboardViewer } from './FeedDashboardViewer';
import { FeedSnapshotViewer } from './FeedSnapshotViewer';

type Props = {
  item: FeedItem;
  variant?: 'card' | 'detail';
  maxWidgets?: number;
  onReady?: (info: { widgetCount: number }) => void;
  /** Detail only: grow a short design to a stage, or to the screen in full screen. */
  fit?: 'stage' | 'screen';
};

/** Routes feed posts to snapshot or legacy live viewer. */
export function FeedPostViewer({ item, variant = 'detail', maxWidgets, onReady, fit = 'stage' }: Props) {
  // Snapshot posts are immutable. Never fetch the source dashboard while rendering one.
  if (item.renderMode === 'snapshot') {
    return <FeedSnapshotViewer item={item} variant={variant} maxWidgets={maxWidgets} fit={fit} />;
  }

  if (item.assetType === 'dashboard' && item.assetId) {
    return (
      <FeedDashboardViewer dashboardId={item.assetId} variant={variant} maxWidgets={maxWidgets} onReady={onReady} fit={fit} />
    );
  }

  return <FeedSnapshotViewer item={item} variant={variant} maxWidgets={maxWidgets} fit={fit} />;
}

export default FeedPostViewer;
