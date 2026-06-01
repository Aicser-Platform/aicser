'use client';

import React from 'react';
import { Alert, Button, Space } from 'antd';
import { CompassOutlined, SyncOutlined } from '@ant-design/icons';
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

/** Studio banner when a dashboard is linked to a feed publication. */
export function DashboardFeedStudioBanner({
  feedPostId,
  dashboardTitle,
  snapshotVersion,
  snapshotOutdated = false,
  onUpdateSnapshot,
  updatingSnapshot = false,
}: Props) {
  const t = useTranslations('feed');

  return (
    <Alert
      type={snapshotOutdated ? 'warning' : 'info'}
      showIcon
      icon={<CompassOutlined />}
      className="dashboard-feed-studio-banner"
      message={
        snapshotOutdated ? t('studio_feed_snapshot_outdated_title') : t('studio_feed_linked_title')
      }
      description={
        <span>
          {snapshotOutdated
            ? t('studio_feed_snapshot_outdated_desc')
            : t('studio_feed_linked_desc', { name: dashboardTitle || t('live_dashboard_preview') })}{' '}
          {snapshotVersion ? t('studio_feed_snapshot_version', { version: snapshotVersion }) : null}{' '}
          <Link href={feedPostUrl(feedPostId)}>{t('studio_feed_view_post')}</Link>
        </span>
      }
      action={
        <Space size={8}>
          {onUpdateSnapshot ? (
            <Button
              size="small"
              icon={<SyncOutlined />}
              loading={updatingSnapshot}
              onClick={onUpdateSnapshot}
            >
              {t('update_feed_snapshot')}
            </Button>
          ) : null}
          <Link href={feedPostUrl(feedPostId)}>
            <Button size="small" type="primary">
              {t('view_in_feed')}
            </Button>
          </Link>
        </Space>
      }
    />
  );
}

export default DashboardFeedStudioBanner;
