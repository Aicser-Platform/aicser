'use client';

import React, { useMemo } from 'react';
import { Table, Typography } from 'antd';
import { useTranslations } from 'next-intl';
import { normalizeToRows } from '../../dashboards/services/exportChartDataService';
import { makeCategoryLabelFormatter } from '../../dashboards/utils/numberFormatter';
import { formatByValueFormat } from '../../dashboards/widgets/WidgetRendererConfig';
import { columnHeaderFromKey } from '@/utils/columnLabels';

/**
 * The numbers behind the chart, as a plain table (Power BI "show as table", Datawrapper's data
 * step): the chart's own rows, dates and numbers written the way the chart writes them.
 */
/** Exact amounts in a table (charts may abbreviate to 1.2K; a table shouldn't). */
function fullValue(v: unknown, o: Record<string, any>): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  const d = typeof o.valueDecimals === 'number' ? o.valueDecimals : undefined;
  const text = Math.abs(n).toLocaleString(
    undefined,
    d === undefined ? { maximumFractionDigits: 2 } : { minimumFractionDigits: d, maximumFractionDigits: d },
  );
  if (o.valueFormat === 'percent') return formatByValueFormat(n, 'percent', o);
  if (o.valueFormat === 'currency') return `${n < 0 ? '-' : ''}${o.currencySymbol || '$'}${text}`;
  return `${n < 0 ? '-' : ''}${text}`;
}

export function ChartDataTable({ widget }: { widget: any }) {
  const t = useTranslations('dashboards');
  const rows = useMemo(() => normalizeToRows(widget?.chartData, widget), [widget]);
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const options = (widget?.chartOptions || {}) as Record<string, any>;

  const columns = keys.map((key, i) => {
    const values = rows.map((r) => r[key]);
    const numeric = values.every((v) => v == null || v === '' || typeof v === 'number');
    const label = numeric ? null : makeCategoryLabelFormatter(values);
    return {
      key,
      dataIndex: key,
      title: columnHeaderFromKey(key),
      align: numeric ? ('right' as const) : ('left' as const),
      fixed: i === 0 ? ('left' as const) : undefined,
      sorter: (a: any, b: any) =>
        numeric ? Number(a[key] ?? 0) - Number(b[key] ?? 0) : String(a[key] ?? '').localeCompare(String(b[key] ?? '')),
      render: (v: unknown) =>
        v == null || v === ''
          ? '–'
          : numeric
            ? fullValue(v, options)
            : label!(v),
    };
  });

  if (!rows.length) {
    return <div className="chart-data-table-empty">{t('view_table_empty')}</div>;
  }

  return (
    <div className="chart-data-table">
      <Typography.Text type="secondary" className="chart-data-table-count">
        {t('data_rows', { count: rows.length })}
      </Typography.Text>
      <Table
        size="small"
        rowKey={(_, i) => String(i)}
        columns={columns}
        dataSource={rows}
        pagination={rows.length > 50 ? { pageSize: 50, showSizeChanger: false } : false}
        scroll={{ x: 'max-content', y: 'calc(100vh - 300px)' }}
        sticky
      />
    </div>
  );
}
