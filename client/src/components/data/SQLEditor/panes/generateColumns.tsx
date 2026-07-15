import React from 'react';
import { message, Tooltip, Tag } from 'antd';
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
      if (typeof value === 'boolean') {
        return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{value ? 'TRUE' : 'FALSE'}</span>;
      }
      if (typeof value === 'string') {
        if (value.length > 60) {
          return (
            <Tooltip title={value} placement="topLeft">
              <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{value.slice(0, 60)}…</span>
            </Tooltip>
          );
        }

        const lowerVal = value.toLowerCase().trim();
        const isIdColumn = key.toLowerCase().includes('id');
        
        // Match specific status pills from screenshot
        if (['active', 'success', 'completed', 'online'].includes(lowerVal)) {
          return (
            <span style={{ 
              display: 'inline-block',
              padding: '2px 10px', 
              background: 'rgba(0, 137, 123, 0.12)', // Light teal
              color: 'var(--ant-color-primary, #00897b)', // Dark teal
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 500
            }}>
              {value}
            </span>
          );
        }
        if (['idle', 'pending', 'inactive'].includes(lowerVal)) {
          return (
            <span style={{ 
              display: 'inline-block',
              padding: '2px 10px', 
              background: '#f1f5f9', 
              color: '#475569', 
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 500
            }}>
              {value}
            </span>
          );
        }
        if (['failed', 'error', 'offline'].includes(lowerVal)) {
          return (
            <span style={{ 
              display: 'inline-block',
              padding: '2px 10px', 
              background: '#fee2e2', 
              color: '#b91c1c', 
              borderRadius: '999px',
              fontSize: '12px',
              fontWeight: 500
            }}>
              {value}
            </span>
          );
        }

        // Emphasize IDs (like PHN-01, SR-05)
        if (isIdColumn) {
          return <span style={{ fontWeight: 600, color: 'var(--ant-color-primary, #00897b)', fontFamily: 'monospace' }}>{value}</span>;
        }
      }
      return <span style={{ fontSize: 13, color: 'var(--ant-color-text)' }}>{value as React.ReactNode}</span>;
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
