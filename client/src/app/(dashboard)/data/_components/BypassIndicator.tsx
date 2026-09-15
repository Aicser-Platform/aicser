'use client';

import React from 'react';
import { Tag, Tooltip, Typography } from 'antd';
import { WarningOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { listDataSourceAccessGrants } from '@/api/dataSources';
import { dataSourceKeys } from '@/hooks/dataSourceKeys';
import { countBypassGrants } from '../sources/[id]/_components/RowAccessSelect';

const { Text } = Typography;

/**
 * Fleet-wide view of the same per-source bypass check BypassBanner shows on a
 * single data source's detail page: a grant with `query` access and no
 * rls_policy_id runs completely unfiltered. Only ever renders something when
 * there's a gap to flag - a governed source stays quiet.
 */
export const BypassIndicator: React.FC<{ dataSourceId: string }> = ({ dataSourceId }) => {
  const t = useTranslations('data_page');
  const { data: bypassCount, isLoading } = useQuery({
    queryKey: dataSourceKeys.accessGrants(dataSourceId),
    queryFn: () => listDataSourceAccessGrants(dataSourceId),
    select: (res) => countBypassGrants(res.grants),
    staleTime: 60_000,
  });

  if (isLoading) return null;
  if (!bypassCount) return <Text type="secondary">–</Text>;

  return (
    <Tooltip title={t('row_access_bypass_tooltip', { count: bypassCount })}>
      <Tag color="warning" icon={<WarningOutlined />} style={{ margin: 0, cursor: 'default' }}>
        {t('row_access_bypass_count', { count: bypassCount })}
      </Tag>
    </Tooltip>
  );
};

export default BypassIndicator;
