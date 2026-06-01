'use client';

import React from 'react';
import { Alert, Progress, Tag } from 'antd';
import { LoadingOutlined, DashboardOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { DashboardBuildProgress } from '../hooks/useDashboardBuildProgress';

type Props = {
  progress: DashboardBuildProgress;
  isConnected?: boolean;
  transport?: 'sse' | 'poll' | null;
};

export function DashboardBuildLiveBanner({ progress, isConnected, transport }: Props) {
  const t = useTranslations('dashboards_page');
  const readyCount =
    progress.widgets_ready?.filter((w) => w.status !== 'failed').length ?? 0;
  const target = progress.target_widgets ?? progress.sections?.length ?? 0;
  const pct = Math.round(
    progress.percent ??
      (target > 0 ? Math.min(100, (readyCount / target) * 100) : 0),
  );

  return (
    <Alert
      type="info"
      showIcon
      icon={<DashboardOutlined />}
      className="mb-3"
      message={
        <span className="flex flex-wrap items-center gap-2">
          <strong>{t('build_live_title')}</strong>
          {progress.dashboard_name ? (
            <span className="text-xs opacity-80">{progress.dashboard_name}</span>
          ) : null}
          {isConnected ? (
            <Tag icon={<LoadingOutlined spin />} color="processing" className="m-0">
              {transport === 'poll' ? t('build_live_syncing') : t('build_live_connected')}
            </Tag>
          ) : null}
        </span>
      }
      description={
        <div className="mt-1 space-y-2">
          <div className="text-xs" style={{ color: 'var(--ant-color-text-secondary)' }}>
            {progress.message || t('build_live_subtitle')}
          </div>
          <Progress
            percent={pct}
            size="small"
            status={progress.status === 'failed' ? 'exception' : 'active'}
            format={() =>
              target > 0 ? `${readyCount}/${target}` : `${readyCount}`
            }
          />
        </div>
      }
    />
  );
}

export default DashboardBuildLiveBanner;
