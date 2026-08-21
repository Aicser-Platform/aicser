'use client';

import React, { useMemo } from 'react';
import { Empty } from 'antd';
import { useTranslations } from 'next-intl';
import type { DataSourceAccessGrant } from '@/api/dataSources';
import { isEnterpriseEdition } from '@/hooks/dataSourceKeys';
import { useDataSourceAccessGrants, useDataSourceCLSPolicies, useDataSourceRLSPolicies } from '@/hooks/useDataSources';
import { useGranteeDirectory } from '@/hooks/access/useGranteeOptions';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import BypassBanner from './BypassBanner';
import GrantShareBar from './GrantShareBar';
import GrantsTable from './GrantsTable';

export const DataSourcePermissionsTab: React.FC<{ dataSourceId: string; active: boolean }> = ({
  dataSourceId,
  active,
}) => {
  const t = useTranslations('data_source_detail');
  const currentOrganization = useOrganizationStore((state) => state.currentOrganization);
  const organizationId = currentOrganization?.id ? String(currentOrganization.id) : null;

  const { grants, isLoading, isFetching } = useDataSourceAccessGrants(dataSourceId, active);
  const { policies } = useDataSourceRLSPolicies(dataSourceId, active);
  const { policies: columnPolicies } = useDataSourceCLSPolicies(dataSourceId, active);
  const { optionsByType } = useGranteeDirectory({ organizationId, enabled: active });

  const labelByKey = useMemo(() => {
    const map = new Map<string, string>();
    Object.values(optionsByType).forEach((options) =>
      options.forEach((option) => map.set(`${option.type}:${option.value}`, option.label))
    );
    return map;
  }, [optionsByType]);

  const granteeLabel = (grant: DataSourceAccessGrant) =>
    labelByKey.get(`${grant.grantee_type}:${grant.grantee_id}`) ?? grant.grantee_id;

  if (!isEnterpriseEdition) {
    return <Empty description={t('data_source_access_ee_only')} image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <>
      <BypassBanner grants={grants} />
      <GrantShareBar
        dataSourceId={dataSourceId}
        organizationId={organizationId}
        policies={policies}
        columnPolicies={columnPolicies}
      />
      <GrantsTable
        dataSourceId={dataSourceId}
        grants={grants}
        policies={policies}
        columnPolicies={columnPolicies}
        loading={isLoading || isFetching}
        granteeLabel={granteeLabel}
      />
    </>
  );
};

export default DataSourcePermissionsTab;
