'use client';

import React from 'react';
import { Alert, Button } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { publicFeedPostUrl } from '@/app/(dashboard)/feed/utils/dashboardFeedBridge';
import type { DashboardRemixConfig } from '../utils/remixSnapshotHydration';

type Props = {
  remix: DashboardRemixConfig;
  dashboardTitle?: string;
};

/** Studio banner for dashboards forked from Discover via Remix. */
export function DashboardRemixBanner({ remix, dashboardTitle }: Props) {
  const t = useTranslations('dashboards');

  return (
    <Alert
      type="info"
      showIcon
      icon={<ExperimentOutlined />}
      className="dashboard-remix-banner"
      message={t('remix_banner_title')}
      description={
        <span>
          {t('remix_banner_desc', { name: dashboardTitle || t('default_title') })}{' '}
          {remix.snapshotVersion
            ? t('remix_banner_version', { version: remix.snapshotVersion })
            : null}{' '}
          <Link href={publicFeedPostUrl(remix.feedPostId!)}>{t('remix_banner_view_source')}</Link>
        </span>
      }
      action={
        remix.feedPostId ? (
          <Link href={publicFeedPostUrl(remix.feedPostId)}>
            <Button size="small">{t('remix_banner_view_source')}</Button>
          </Link>
        ) : null
      }
    />
  );
}

export default DashboardRemixBanner;
