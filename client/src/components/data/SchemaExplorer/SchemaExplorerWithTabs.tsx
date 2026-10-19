'use client';

import React, { useState } from 'react';
import { Tabs } from 'antd';
import type { DataSource as ContextDataSource, SchemaInfo as ContextSchemaInfo } from '@/stores/useDataSourceStore';
import { useTranslations } from 'next-intl';
import SchemaExplorerTree from './SchemaExplorerTree';
import { CalcFieldsPanel } from './CalcFieldsPanel';
import type { CalcField } from '@/api/calcFields';
import { columnOptionsFromSchema } from './calcFieldColumns';

type Props = {
  dataSource: ContextDataSource;
  schema: ContextSchemaInfo;
  filterText?: string;
  compact?: boolean;
  canEditCalcFields?: boolean;
  onTableClick?: (tableName: string, schemaName: string, dataSource: ContextDataSource) => void;
  onColumnClick?: (tableName: string, columnName: string, schemaName: string, dataSource: ContextDataSource) => void;
  onCalcFieldInsert?: (field: CalcField) => void;
};

export function SchemaExplorerWithTabs({
  dataSource,
  schema,
  filterText = '',
  compact = true,
  canEditCalcFields = true,
  onTableClick,
  onColumnClick,
  onCalcFieldInsert,
}: Props) {
  const t = useTranslations('schema_explorer');
  const [tab, setTab] = useState('tables');
  const columnOptions = columnOptionsFromSchema(schema);

  return (
    <Tabs
      className="schema-explorer-tabs"
      size="small"
      activeKey={tab}
      onChange={setTab}
      items={[
        {
          key: 'tables',
          label: t('tab_tables'),
          children: (
            <SchemaExplorerTree
              dataSource={dataSource}
              schema={schema}
              filterText={filterText}
              compact={compact}
              onTableClick={onTableClick}
              onColumnClick={onColumnClick}
            />
          ),
        },
        {
          key: 'calc',
          label: t('tab_calc'),
          children: (
            <CalcFieldsPanel
              dataSourceId={dataSource.id}
              canEdit={canEditCalcFields}
              columnOptions={columnOptions}
              onInsert={onCalcFieldInsert}
            />
          ),
        },
      ]}
    />
  );
}
