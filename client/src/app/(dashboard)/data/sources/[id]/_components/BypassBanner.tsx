'use client';

import React from 'react';
import { Alert, Button } from 'antd';
import { useTranslations } from 'next-intl';
import type { DataSourceAccessGrant } from '@/api/dataSources';
import { countBypassGrants } from './RowAccessSelect';

/**
 * A single unrestricted query grant disables RLS across the whole data source
 * for any user holding it, so the warning has to live above the table rather
 * than on the offending row.
 */
export const BypassBanner: React.FC<{ grants: DataSourceAccessGrant[]; onOpenAccess?: () => void }> = ({ grants, onOpenAccess }) => {
  const t = useTranslations('data_source_detail');
  const count = countBypassGrants(grants);
  if (count === 0) return null;

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message={t(onOpenAccess ? 'bypass_banner' : 'bypass_banner_here', { count })}
      action={onOpenAccess ? <Button size="small" onClick={onOpenAccess}>{t('tab_access')}</Button> : undefined}
    />
  );
};

export default BypassBanner;
