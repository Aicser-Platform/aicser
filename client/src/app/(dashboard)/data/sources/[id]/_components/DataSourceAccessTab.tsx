'use client';

import React from 'react';
import { Segmented } from 'antd';
import { useTranslations } from 'next-intl';
import DataSourcePermissionsTab from './DataSourcePermissionsTab';
import RowFiltersTab from './RowFiltersTab';
import ColumnRulesTab from './ColumnRulesTab';
import type { AccessSubTab } from './tabParam';

const ACCESS_SECTIONS: AccessSubTab[] = ['sharing', 'row-filters', 'column-rules'];

export const DataSourceAccessTab: React.FC<{
  dataSourceId: string;
  active: boolean;
  subTab: AccessSubTab;
  onSubTabChange: (sub: AccessSubTab) => void;
}> = ({ dataSourceId, active, subTab, onSubTabChange }) => {
  const t = useTranslations('data_source_detail');

  const section = ACCESS_SECTIONS.includes(subTab) ? subTab : 'sharing';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Segmented<AccessSubTab>
        value={section}
        onChange={onSubTabChange}
        options={[
          { value: 'sharing', label: t('access_sub_sharing') },
          { value: 'row-filters', label: t('tab_row_filters') },
          { value: 'column-rules', label: t('tab_column_rules') },
        ]}
      />
      <div>
        {section === 'sharing' ? (
          <DataSourcePermissionsTab dataSourceId={dataSourceId} active={active && section === 'sharing'} />
        ) : null}
        {section === 'row-filters' ? (
          <RowFiltersTab dataSourceId={dataSourceId} active={active && section === 'row-filters'} />
        ) : null}
        {section === 'column-rules' ? (
          <ColumnRulesTab dataSourceId={dataSourceId} active={active && section === 'column-rules'} />
        ) : null}
      </div>
    </div>
  );
};

export default DataSourceAccessTab;
