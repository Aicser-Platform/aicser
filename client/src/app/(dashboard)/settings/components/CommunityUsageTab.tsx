'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Card, Progress, Skeleton, Space, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { fetchApi } from '@/utils/api';
import type { TabComponentProps } from '@/app/(dashboard)/settings/page';
import { useDataSources } from '@/hooks/useDataSources';

const { Text, Title } = Typography;

type CeUsageResponse = {
  success?: boolean;
  usage?: {
    edition?: string;
    ai_usage_policy?: string;
    data_sources_count?: { used: number; limit: number; unlimited: boolean };
    projects_count?: { used: number; limit: number; unlimited: boolean };
  };
};

/** CE footprint + BYOK policy (no managed AI credits). */
export const CommunityUsageTab: React.FC<TabComponentProps> = () => {
  const t = useTranslations('usage_analytics');
  const { dataSources } = useDataSources(null, { allProjects: true });
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<CeUsageResponse['usage'] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchApi('/api/billing/usage')
      .then((res: CeUsageResponse) => {
        if (alive) setUsage(res?.usage ?? null);
      })
      .catch(() => {
        if (alive) setUsage(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const dsUsed = usage?.data_sources_count?.used ?? dataSources?.length ?? 0;
  const dsLimit = usage?.data_sources_count?.limit ?? 2;
  const dsUnlimited = usage?.data_sources_count?.unlimited ?? false;

  return (
    <Card variant="borderless" style={{ background: 'var(--color-fill-quaternary)', borderRadius: 8 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={t('surface_ce_self_host_title')}
        description={t('ce_byok_desc')}
      />
      {loading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <Space orientation="vertical" size="large" style={{ width: '100%' }}>
          <div>
            <Title level={5} style={{ marginTop: 0 }}>{t('ce_footprint_title')}</Title>
            <Text type="secondary">{t('ce_footprint_desc')}</Text>
          </div>
          <div>
            <Text type="secondary">{t('metric_data_sources')}</Text>
            <Progress
              percent={dsUnlimited || dsLimit < 0 ? 0 : Math.min(100, Math.round((dsUsed / dsLimit) * 100))}
              format={() => (dsUnlimited ? `${dsUsed} / ∞` : `${dsUsed} / ${dsLimit}`)}
            />
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('ce_llm_hint')}{' '}
            <Link href="/settings?tab=security">{t('ce_api_keys_link')}</Link>
          </Text>
        </Space>
      )}
    </Card>
  );
};

export default CommunityUsageTab;
