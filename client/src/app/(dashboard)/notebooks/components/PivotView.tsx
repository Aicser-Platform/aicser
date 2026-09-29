'use client';

import React, { useMemo } from 'react';
import { Button, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ChartSpec } from '@/services/notebookService';
import { pivot, type Pivot } from './chartShape';
import { toCsv } from './CellOutputView';

const { Text } = Typography;
const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const fmt = (v: number | null) => (v == null ? '' : num.format(v));

type Row = { key: string; keys: string[]; cells: Array<number | null>; total: number | null };

/** Header and body rows of a pivot as plain values, for CSV and report exports. */
export function pivotGrid(p: Pivot, totalLabel: string): { columns: string[]; rows: unknown[][] } {
  const measureCount = new Set(p.colKeys.map((c) => c.measure)).size;
  const head = p.colKeys.map((c) => [c.col, measureCount > 1 || !c.col ? c.measure : null].filter(Boolean).join(' · '));
  const hasTotal = p.body.some((r) => r.total != null);
  const columns = [...p.rowHeaders, ...head, ...(hasTotal ? [totalLabel] : [])];
  const rows: unknown[][] = p.body.map((r) => [...r.keys, ...r.cells, ...(hasTotal ? [r.total] : [])]);
  rows.push([...(p.rowHeaders.length ? [totalLabel, ...p.rowHeaders.slice(1).map(() => '')] : []), ...p.totals, ...(hasTotal ? [p.grand] : [])]);
  return { columns, rows };
}

export function PivotView({ spec, columns, rows, fileName }: { spec: ChartSpec; columns: string[]; rows: unknown[][]; fileName: string }) {
  const t = useTranslations('notebooks');
  const p = useMemo(() => pivot(columns, rows, { rows: spec.rows, columns: spec.columns, values: spec.values, agg: spec.agg }), [columns, rows, spec]);
  const measureCount = new Set(p.colKeys.map((c) => c.measure)).size;
  const hasTotal = p.body.some((r) => r.total != null);

  const tableColumns: ColumnsType<Row> = [
    ...p.rowHeaders.map((h, i) => ({
      title: h,
      key: `r${i}`,
      fixed: 'left' as const,
      ellipsis: true,
      render: (_: unknown, row: Row) => row.keys[i],
    })),
  ];
  // Group measures under each column value when both are present.
  const byCol = new Map<string, Array<{ idx: number; measure: string }>>();
  p.colKeys.forEach((c, idx) => {
    const k = c.col ?? '';
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k)!.push({ idx, measure: c.measure });
  });
  const cellCol = (idx: number, title: React.ReactNode) => ({
    title,
    key: `c${idx}`,
    align: 'right' as const,
    render: (_: unknown, row: Row) => fmt(row.cells[idx]),
  });
  for (const [col, list] of byCol) {
    if (!col) list.forEach(({ idx, measure }) => tableColumns.push(cellCol(idx, measure)));
    else if (measureCount === 1) tableColumns.push(cellCol(list[0].idx, col));
    else tableColumns.push({ title: col, key: `g${col}`, children: list.map(({ idx, measure }) => cellCol(idx, measure)) });
  }
  if (hasTotal) {
    tableColumns.push({ title: t('pivot_total'), key: 'total', align: 'right', fixed: 'right', render: (_: unknown, row: Row) => <strong>{fmt(row.total)}</strong> });
  }

  const data: Row[] = p.body.map((r, i) => ({ key: String(i), ...r }));

  const downloadCsv = () => {
    const grid = pivotGrid(p, t('pivot_total'));
    const url = URL.createObjectURL(new Blob([`﻿${toCsv(grid.columns, grid.rows)}`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName || 'pivot'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="nb-pivot">
      <Table<Row>
        size="small"
        bordered
        columns={tableColumns}
        dataSource={data}
        pagination={data.length > 50 ? { pageSize: 50, size: 'small', showSizeChanger: false } : false}
        scroll={{ x: 'max-content' }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row className="nb-pivot__totals">
              {p.rowHeaders.length ? (
                <Table.Summary.Cell index={0} colSpan={p.rowHeaders.length}><strong>{t('pivot_total')}</strong></Table.Summary.Cell>
              ) : null}
              {p.totals.map((v, i) => (
                <Table.Summary.Cell key={i} index={p.rowHeaders.length + i} align="right"><strong>{fmt(v)}</strong></Table.Summary.Cell>
              ))}
              {hasTotal ? <Table.Summary.Cell index={p.rowHeaders.length + p.totals.length} align="right"><strong>{fmt(p.grand)}</strong></Table.Summary.Cell> : null}
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
      <div className="nb-output-footer">
        <Text type="secondary" className="nb-output-meta">
          {t('pivot_shape', { rows: p.body.length, cols: p.colKeys.length })}
          {p.truncated ? ` · ${t('pivot_truncated')}` : ''}
        </Text>
        <Button size="small" type="text" icon={<DownloadOutlined />} onClick={downloadCsv}>{t('download_csv')}</Button>
      </div>
    </div>
  );
}
