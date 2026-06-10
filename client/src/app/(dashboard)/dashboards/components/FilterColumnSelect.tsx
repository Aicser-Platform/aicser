'use client';

import React, { useMemo } from 'react';
import { Select, Spin, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { useDataSourceSchema } from '@/hooks/useDataSources';
import { getAllColumnsForDataSource, getColumnsForDataSource } from '../utils/filterSchemaColumns';

type Props = {
  dataSourceId?: string;
  tableName?: string;
  value?: string;
  onChange: (field: string, tableName?: string, columnType?: string) => void;
  style?: React.CSSProperties;
};

export function FilterColumnSelect({ dataSourceId, tableName, value, onChange, style }: Props) {
  const t = useTranslations('dashboards');
  const { schema, isLoading } = useDataSourceSchema(dataSourceId || null);

  const { options, tableByField, typeByField } = useMemo(() => {
    if (!dataSourceId) {
      return { options: [], tableByField: new Map<string, string>(), typeByField: new Map<string, string>() };
    }
    const dsList = schema ? [{ id: dataSourceId, schema: schema as { tables?: unknown[] } }] : [];
    const tableByField = new Map<string, string>();
    const typeByField = new Map<string, string>();

    if (tableName) {
      const cols = getColumnsForDataSource(dsList, dataSourceId, tableName);
      cols.forEach((c) => {
        tableByField.set(c.value, tableName);
        if (c.type) typeByField.set(c.value, c.type);
      });
      return { options: cols, tableByField, typeByField };
    }

    const all = getAllColumnsForDataSource(dsList, dataSourceId);
    all.forEach((c) => {
      if (c.tableName) tableByField.set(c.value, c.tableName);
      if (c.type) typeByField.set(c.value, c.type);
    });
    return { options: all, tableByField, typeByField };
  }, [dataSourceId, tableName, schema]);

  const selectOptions = useMemo(() => {
    const base = options.map((o) => ({ value: o.value, label: o.label }));
    if (value && !base.some((c) => c.value === value)) {
      return [{ label: value, value }, ...base];
    }
    return base;
  }, [options, value]);

  const disabled = !dataSourceId;
  const emptyHint = !dataSourceId
    ? t('filter_pick_source_first')
    : t('filter_columns_empty');

  return (
    <Select
      showSearch
      allowClear
      disabled={disabled}
      loading={isLoading}
      placeholder={t('filter_field_placeholder')}
      style={{ width: 160, ...style }}
      value={value || undefined}
      onChange={(v) => {
        if (!v) {
          onChange('');
          return;
        }
        onChange(v, tableByField.get(v) || tableName, typeByField.get(v));
      }}
      options={selectOptions}
      notFoundContent={
        isLoading ? (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <Spin size="small" />
          </div>
        ) : (
          <Typography.Text type="secondary" style={{ padding: 8, display: 'block', fontSize: 12 }}>
            {emptyHint}
          </Typography.Text>
        )
      }
    />
  );
}
