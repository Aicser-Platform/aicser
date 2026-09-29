'use client';

import React from 'react';
import { Card, Descriptions, Tag, Tooltip } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import type { DataSource } from '@/stores/useDataSourceStore';

const formatBytes = (size?: number): string | null => {
  if (!size) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

/** "3 days ago" — the exact timestamp stays in the tooltip. */
function relativeTime(iso: string | undefined, locale: string): { label: string; exact: string } | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  const seconds = Math.round((when.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const exact = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(when);
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return { label: rtf.format(Math.round(seconds / size), unit), exact };
  }
  return { label: rtf.format(0, 'minute'), exact };
}

/** Tables and total rows from the schema already loaded for the source (row counts are the
 * catalogue's, not a live COUNT). */
function schemaTotals(schema: DataSource['schema']): { tables: number; rows: number | null } {
  const tables = Array.isArray((schema as { tables?: unknown[] } | null)?.tables)
    ? ((schema as { tables: Array<{ rowCount?: number; row_count?: number }> }).tables)
    : [];
  let rows: number | null = null;
  for (const tb of tables) {
    const n = tb.rowCount ?? tb.row_count;
    if (typeof n === 'number') rows = (rows ?? 0) + n;
  }
  return { tables: tables.length, rows };
}

const DB_NAMES: Record<string, string> = {
  postgresql: 'PostgreSQL',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  mssql: 'SQL Server',
  sqlserver: 'SQL Server',
  snowflake: 'Snowflake',
  bigquery: 'BigQuery',
  redshift: 'Redshift',
  clickhouse: 'ClickHouse',
  oracle: 'Oracle',
  duckdb: 'DuckDB',
  sqlite: 'SQLite',
};

export const DataSourceOverviewTab: React.FC<{
  dataSource: DataSource | null;
  banner?: React.ReactNode;
}> = ({ dataSource, banner }) => {
  const t = useTranslations('data_source_detail');
  const locale = useLocale();

  // Plain type: engine name for databases, what it is for everything else (never an enum).
  const type = dataSource?.type;
  const dbName = dataSource?.db_type ? DB_NAMES[dataSource.db_type.toLowerCase()] ?? dataSource.db_type : null;
  const typeLabel =
    type === 'database' || type === 'warehouse'
      ? dbName || t(`overview_type_${type}` as never)
      : type
        ? t(`overview_type_${type}` as never)
        : '—';

  // Files, samples and document libraries have no connection to check: they're ready once
  // loaded. Databases report their last connection test; unknown means "not checked yet".
  const connectionless = type === 'file' || type === 'sample_duckdb' || type === 'knowledge_base' || type === 'google_sheets';
  const statusKey = connectionless
    ? 'ready'
    : dataSource?.connection_status === 'connected'
      ? 'connected'
      : dataSource?.connection_status === 'failed'
        ? 'failed'
        : 'unchecked';
  const statusColor = statusKey === 'failed' ? 'red' : statusKey === 'unchecked' ? 'default' : 'green';

  const totals = schemaTotals(dataSource?.schema);
  const rows = dataSource?.row_count ?? totals.rows;
  const size = formatBytes(dataSource?.size);
  const updated = relativeTime(dataSource?.updated_at || dataSource?.created_at, locale);

  return (
    <>
      {banner}
      <Card size="small" title={t('tab_overview')}>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label={t('overview_name')}>{dataSource?.name ?? '—'}</Descriptions.Item>
          <Descriptions.Item label={t('overview_type')}>{typeLabel}</Descriptions.Item>
          <Descriptions.Item label={t('overview_status')}>
            <Tag color={statusColor}>{t(`overview_status_${statusKey}` as never)}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label={t('overview_tables')}>
            {totals.tables > 0 ? totals.tables.toLocaleString(locale) : '—'}
          </Descriptions.Item>
          <Descriptions.Item label={t('overview_rows')}>
            {typeof rows === 'number' ? rows.toLocaleString(locale) : '—'}
          </Descriptions.Item>
          {size ? <Descriptions.Item label={t('overview_size')}>{size}</Descriptions.Item> : null}
          <Descriptions.Item label={t('overview_updated')}>
            {updated ? <Tooltip title={updated.exact}>{updated.label}</Tooltip> : '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </>
  );
};

export default DataSourceOverviewTab;
