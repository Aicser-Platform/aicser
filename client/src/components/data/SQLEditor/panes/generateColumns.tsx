import React from 'react';
import { message, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { columnHeaderFromKey } from '@/utils/columnLabels';

type TranslateFn = (key: string, values?: Record<string, string | number>) => string;

export function generateColumns(data: Record<string, unknown>[], t: TranslateFn): ColumnsType<Record<string, unknown>> {
  if (!data || data.length === 0) return [];

  const columnKeys = Object.keys(data[0]);

  const copyCell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    void navigator.clipboard.writeText(text).then(() => message.success(t('cell_copied'), 1));
  };

  return columnKeys.map((key) => ({
    title: columnHeaderFromKey(key),
    dataIndex: key,
    key,
    width: 160,
    ellipsis: { showTitle: false },
    onCell: (record: Record<string, unknown>) => ({
      onClick: () => copyCell(record[key]),
      style: { cursor: 'copy' },
      title:
        record[key] == null
          ? 'NULL — click to copy'
          : `${String(record[key])} — click to copy`,
    }),
    render: (value: unknown) => {
      if (value === null || value === undefined) {
        return (
          <span
            style={{
              color: 'var(--ant-color-text-quaternary)',
              fontStyle: 'italic',
              fontSize: 11,
              background: 'var(--ant-color-fill-tertiary)',
              borderRadius: 3,
              padding: '0 4px',
              userSelect: 'none',
            }}
          >
            NULL
          </span>
        );
      }
      if (typeof value === 'object') {
        const str = JSON.stringify(value);
        return (
          <Tooltip
            title={<pre style={{ margin: 0, fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{str}</pre>}
            placement="topLeft"
          >
            <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--ant-color-text-secondary)' }}>
              {'{…}'}
            </span>
          </Tooltip>
        );
      }
      if (typeof value === 'number') {
        return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString()}</span>;
      }
      if (typeof value === 'string' && value.length > 60) {
        return (
          <Tooltip title={value} placement="topLeft">
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{value.slice(0, 60)}…</span>
          </Tooltip>
        );
      }
      return value as React.ReactNode;
    },
    sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aVal = a[key];
      const bVal = b[key];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return -1;
      if (bVal == null) return 1;
      if (typeof aVal === 'number' && typeof bVal === 'number') return aVal - bVal;
      return String(aVal).localeCompare(String(bVal));
    },
  }));
}
