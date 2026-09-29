'use client';

import React, { useEffect, useMemo } from 'react';
import { Form, Select, Space, Typography } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useDataSources, useDataSourceSchema } from '@/hooks/useDataSources';
import { guessCoordinateColumns, type PointSetSpec } from '@/services/spatialService';

const { Text } = Typography;

export type PointSetDraft = Partial<PointSetSpec>;

/**
 * Pick where a set of places comes from: a data source, one of its tables, and the columns with
 * each place's position (guessed from their names), name and value.
 */
export function PointSetPicker({
  value,
  onChange,
  valueLabel,
}: {
  value: PointSetDraft;
  onChange: (next: PointSetDraft) => void;
  /** e.g. "Value to add up (optional)", or null to hide the value column. */
  valueLabel?: string | null;
}) {
  const t = useTranslations('spatial');
  const { dataSources, isLoading } = useDataSources();
  const { schema, isLoading: schemaLoading } = useDataSourceSchema(value.data_source_id || null);

  const tables = useMemo(
    () => (schema?.tables ?? []).map((tb) => ({ ...tb, full: tb.schema ? `${tb.schema}.${tb.name}` : tb.name })),
    [schema],
  );
  const table = tables.find((tb) => tb.full === value.table);
  const columns = table?.columns ?? [];
  const numericColumns = columns.filter((c) => /int|float|double|decimal|numeric|real|number|bigint/i.test(c.type || ''));

  // Pick the only table, then guess the coordinate columns, so most people just confirm.
  useEffect(() => {
    if (value.data_source_id && !value.table && tables.length === 1) {
      onChange({ ...value, table: tables[0].full });
    }
  }, [value, tables, onChange]);
  useEffect(() => {
    if (table && (!value.lat || !value.lon)) {
      const guess = guessCoordinateColumns(columns);
      // A readable name for each place (store, branch, customer…) when one is obvious.
      const label = value.label ?? columns.find((c) => /(^|_)(name|store|site|branch|shop|outlet|customer|title|label)s?$/i.test(c.name))?.name;
      if (guess.lat || guess.lon) onChange({ ...value, lat: value.lat || guess.lat, lon: value.lon || guess.lon, label: label ?? null });
    }
  }, [table, columns, value, onChange]);

  const columnOptions = columns.map((c) => ({ value: c.name, label: c.name }));
  const found = Boolean(value.lat && value.lon);

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Form.Item label={t('source')} style={{ marginBottom: 0 }}>
        <Select
          showSearch
          loading={isLoading}
          placeholder={t('source_placeholder')}
          value={value.data_source_id || undefined}
          optionFilterProp="label"
          options={dataSources.map((d) => ({ value: String(d.id), label: d.name }))}
          onChange={(id) => onChange({ data_source_id: id })}
        />
      </Form.Item>
      {value.data_source_id && tables.length > 1 ? (
        <Form.Item label={t('table')} style={{ marginBottom: 0 }}>
          <Select
            showSearch
            loading={schemaLoading}
            value={value.table || undefined}
            options={tables.map((tb) => ({ value: tb.full, label: tb.full }))}
            onChange={(tb) => onChange({ data_source_id: value.data_source_id, table: tb })}
          />
        </Form.Item>
      ) : null}
      {table ? (
        <>
          <Space.Compact block>
            <Select
              style={{ width: '50%' }}
              aria-label={t('latitude')}
              placeholder={t('latitude')}
              value={value.lat || undefined}
              options={columnOptions}
              showSearch
              onChange={(lat) => onChange({ ...value, lat })}
            />
            <Select
              style={{ width: '50%' }}
              aria-label={t('longitude')}
              placeholder={t('longitude')}
              value={value.lon || undefined}
              options={columnOptions}
              showSearch
              onChange={(lon) => onChange({ ...value, lon })}
            />
          </Space.Compact>
          <Text type={found ? 'success' : 'secondary'} style={{ fontSize: 12 }}>
            {found ? <CheckCircleFilled /> : null} {found ? t('position_found') : t('position_missing')}
          </Text>
          <Form.Item label={t('name_column')} style={{ marginBottom: 0 }}>
            <Select
              allowClear
              showSearch
              placeholder={t('optional')}
              value={value.label || undefined}
              options={columnOptions}
              onChange={(label) => onChange({ ...value, label: label ?? null })}
            />
          </Form.Item>
          {valueLabel ? (
            <Form.Item label={valueLabel} style={{ marginBottom: 0 }}>
              <Select
                allowClear
                showSearch
                placeholder={t('optional')}
                value={value.measure || undefined}
                options={numericColumns.map((c) => ({ value: c.name, label: c.name }))}
                onChange={(measure) => onChange({ ...value, measure: measure ?? null })}
              />
            </Form.Item>
          ) : null}
        </>
      ) : null}
    </Space>
  );
}

export function isComplete(p: PointSetDraft): p is PointSetSpec {
  return Boolean(p.data_source_id && p.table && p.lat && p.lon);
}
