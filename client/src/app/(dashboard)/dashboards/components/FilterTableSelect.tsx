'use client';

import React, { useEffect, useMemo } from 'react';
import { Select, Spin } from 'antd';
import { useTranslations } from 'next-intl';
import { useDataSourceSchema } from '@/hooks/useDataSources';

type Props = {
  dataSourceId?: string;
  value?: string;
  onChange: (tableName?: string) => void;
  style?: React.CSSProperties;
};

export function FilterTableSelect({ dataSourceId, value, onChange, style }: Props) {
  const t = useTranslations('dashboards');
  const { schema, isLoading } = useDataSourceSchema(dataSourceId || null);

  const tables = useMemo(() => {
    const raw = schema?.tables || [];
    return raw
      .map((tbl) => {
        const name = typeof tbl === 'string' ? tbl : (tbl as { name?: string }).name;
        return name ? { value: name, label: name } : null;
      })
      .filter(Boolean) as { value: string; label: string }[];
  }, [schema]);

  useEffect(() => {
    if (!dataSourceId || value || tables.length !== 1) return;
    onChange(tables[0].value);
  }, [dataSourceId, value, tables, onChange]);

  if (!dataSourceId) return null;
  if (!isLoading && tables.length === 0) return null;

  return (
    <Select
      placeholder={t('table')}
      style={{ width: 130, ...style }}
      allowClear
      loading={isLoading}
      value={value}
      onChange={(v) => onChange(v)}
      options={tables}
      notFoundContent={isLoading ? <Spin size="small" /> : undefined}
    />
  );
}
