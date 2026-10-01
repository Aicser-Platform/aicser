'use client';

import React from 'react';
import { Alert, Button, Space, Table, Tooltip, Typography } from 'antd';
import { BarChartOutlined, BulbOutlined, CopyOutlined, DownloadOutlined, SaveOutlined, TableOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { CellOutput } from '@/services/notebookService';

const { Text } = Typography;

export type OutputAction = 'chart' | 'pivot' | 'save' | 'csv' | 'copy' | 'workbook';

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`;
}

/** A cell's output: a table (first 200 rows), printed text, figures, or an error, with the
 * next steps people take from a result right beside it. */
export function CellOutputView({
  output, images, canChart = false, readOnly = true, onAction, onFix,
}: {
  output?: CellOutput | null;
  images?: string[];
  canChart?: boolean;
  readOnly?: boolean;
  onAction?: (action: OutputAction) => void;
  /** Ask the AI to fix the code behind this error (shown when AI is available). */
  onFix?: () => Promise<void>;
}) {
  const t = useTranslations('notebooks');
  const [fixing, setFixing] = React.useState(false);
  const blocks: React.ReactNode[] = [];
  if (output?.kind === 'error') {
    const fix = onFix
      ? async () => {
          setFixing(true);
          try {
            await onFix();
          } finally {
            setFixing(false);
          }
        }
      : undefined;
    blocks.push(
      <Alert
        key="err"
        type="error"
        showIcon
        message={<pre className="nb-output-error">{output.text}</pre>}
        action={fix ? <Button size="small" icon={<BulbOutlined />} loading={fixing} onClick={() => void fix()}>{t('fix_with_ai')}</Button> : undefined}
      />,
    );
  }
  if ((output?.kind === 'text' || output?.kind === 'table' || output?.kind === 'image') && output.text) {
    blocks.push(<pre key="text" className="nb-output-text">{output.text}</pre>);
  }
  if (output?.kind === 'table' && output.columns) {
    const rows = (output.rows ?? []) as unknown[][];
    blocks.push(
      <div key="table" className="nb-output-table">
        <Table
          size="small"
          rowKey={(_, i) => String(i)}
          dataSource={rows.map((r) => r)}
          columns={output.columns.map((c, i) => ({
            title: c,
            key: `${i}`,
            ellipsis: true,
            render: (_: unknown, row: unknown[]) => cellText(row[i]),
          }))}
          pagination={rows.length > 10 ? { pageSize: 10, size: 'small', showSizeChanger: false } : false}
          scroll={{ x: 'max-content' }}
        />
        <div className="nb-output-footer">
          <Text type="secondary" className="nb-output-meta">
            {t('rows_shown', { shown: rows.length, total: output.row_count ?? rows.length })}
            {output.duration_ms != null ? ` · ${formatMs(output.duration_ms)}` : ''}
          </Text>
          {onAction ? (
            <Space size={2} wrap>
              {canChart && !readOnly ? (
                <Button size="small" type="text" icon={<BarChartOutlined />} onClick={() => onAction('chart')}>{t('chart_this')}</Button>
              ) : null}
              {canChart && !readOnly ? (
                <Button size="small" type="text" icon={<TableOutlined />} onClick={() => onAction('pivot')}>{t('pivot_this')}</Button>
              ) : null}
              <Button size="small" type="text" icon={<SaveOutlined />} onClick={() => onAction('save')}>{t('save_as_dataset')}</Button>
              <Button size="small" type="text" icon={<TableOutlined />} onClick={() => onAction('workbook')}>{t('open_as_sheet')}</Button>
              <Tooltip title={t('download_csv_help')}>
                <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => onAction('csv')}>{t('download_csv')}</Button>
              </Tooltip>
              <Tooltip title={t('copy_rows_help')}>
                <Button size="small" type="text" icon={<CopyOutlined />} aria-label={t('copy_rows')} onClick={() => onAction('copy')} />
              </Tooltip>
            </Space>
          ) : null}
        </div>
      </div>,
    );
  } else if (output && output.kind !== 'error' && output.duration_ms != null) {
    blocks.push(<Text key="took" type="secondary" className="nb-output-meta">{formatMs(output.duration_ms)}</Text>);
  }
  for (const [i, src] of (images ?? (output?.image ? [output.image] : [])).entries()) {
    // eslint-disable-next-line @next/next/no-img-element
    blocks.push(<img key={`img-${i}`} className="nb-output-image" src={src} alt={t('figure_alt', { n: i + 1 })} />);
  }
  if (!blocks.length) return null;
  return <div className="nb-output">{blocks}</div>;
}

/** Rows as CSV (RFC 4180), with a guard against spreadsheet formula injection. */
export function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

export function toTsv(columns: string[], rows: unknown[][]): string {
  const clean = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/[\t\r\n]+/g, ' ');
  return [columns.map(clean).join('\t'), ...rows.map((r) => r.map(clean).join('\t'))].join('\n');
}
