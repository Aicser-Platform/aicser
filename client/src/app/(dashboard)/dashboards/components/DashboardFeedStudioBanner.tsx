'use client';

import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { CompassOutlined, SyncOutlined, CloseOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { feedPostUrl } from '@/app/(dashboard)/feed/utils/dashboardFeedBridge';

type Props = {
  feedPostId: string;
  dashboardTitle?: string;
  snapshotVersion?: number;
  snapshotOutdated?: boolean;
  onUpdateSnapshot?: () => void;
  updatingSnapshot?: boolean;
};

/** Studio banner when a dashboard is linked to a feed publication. Collapses to a pill on dismiss; re-expands when the outdated version actually changes. */
export function DashboardFeedStudioBanner({
  feedPostId,
  dashboardTitle,
  snapshotVersion,
  snapshotOutdated = false,
  onUpdateSnapshot,
  updatingSnapshot = false,
}: Props) {
  const t = useTranslations('feed');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [snapshotVersion, snapshotOutdated]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex items-center gap-2 rounded-md border border-border-light bg-bg-container px-3 py-1.5 text-xs text-text-secondary hover:text-text hover:border-border transition-colors"
      >
        <CompassOutlined className={snapshotOutdated ? 'text-amber-500' : 'text-text-tertiary'} />
        {snapshotOutdated ? t('studio_feed_snapshot_outdated_title') : t('studio_feed_linked_title')}
      </button>
    );
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${
        snapshotOutdated
          ? 'border-amber-500/30 bg-amber-500/10'
          : 'border-border-light bg-bg-container'
      }`}
    >
      <CompassOutlined className={`text-sm shrink-0 ${snapshotOutdated ? 'text-amber-500' : 'text-text-tertiary'}`} />
      <span className="text-xs text-text-secondary truncate flex-1 min-w-0">
        {snapshotOutdated ? t('studio_feed_snapshot_outdated_title') : t('studio_feed_linked_title')}
        {snapshotVersion ? <span className="text-text-tertiary"> · v{snapshotVersion}</span> : null}
        {' · '}
        <Link href={feedPostUrl(feedPostId)} className="text-brand hover:text-brand-hover">
          {t('studio_feed_view_post')}
        </Link>
      </span>
      <div className="flex items-center gap-1 shrink-0">
        {onUpdateSnapshot ? (
          <Button size="small" icon={<SyncOutlined />} loading={updatingSnapshot} onClick={onUpdateSnapshot}>
            {t('update_feed_snapshot')}
          </Button>
        ) : null}
        <Link href={feedPostUrl(feedPostId)}>
          <Button size="small" type="primary">
            {t('view_in_feed')}
          </Button>
        </Link>
        <Button
          size="small"
          type="text"
          icon={<CloseOutlined />}
          aria-label="Dismiss"
          onClick={() => setCollapsed(true)}
        />
      </div>
    </div>
  );
}

export default DashboardFeedStudioBanner;
