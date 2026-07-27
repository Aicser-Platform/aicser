'use client';

import React from 'react';
import { Table, Typography, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslations } from 'next-intl';
import { columnHeaderFromKey } from '@/utils/columnLabels';
import { formatTableCellValue } from '@/utils/userFriendlyMessages';
import './TableWidget.css';
import type { ConditionalFormattingRule } from '../Properties/ConditionalFormattingEditor';
import { getCellStyle, getRowStyle } from './utils/conditionalFormatting';

const { Text } = Typography;

export interface RawRowsTableWidgetProps {
  /** Plain rows (e.g. a chat query_result) — not the {x,y,series} shape TableWidget expects. */
  rows: Record<string, unknown>[];
  config?: Record<string, unknown> | null;
  /** Column key (from the flat row shape) that acts as the dashboard cross-filter dimension. */
  crossFilterField?: string;
  activeCrossFilterValues?: string[];
  onCrossFilter?: (value: unknown) => void;
}

/** True when every non-empty value seen for `key` across `rows` is a finite number. */
function isNumericColumn(rows: Record<string, unknown>[], key: string): boolean {
  let sawNumber = false;
  for (const row of rows) {
    const v = row[key];
    if (v === null || v === undefined || v === '') continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    sawNumber = true;
  }
  return sawNumber;
}

/**
 * Renders a raw row array (columns inferred from object keys) as a table.
 *
 * TableWidget renders the dashboard's native {x,y,series} aggregation shape,
 * which a chat-originated "table" chart type never has — it's already a flat
 * result set with its own arbitrary columns, not a dimension/metric pivot. This
 * is the dashboard-widget equivalent of the inline table view in ChartMessage.tsx
 * (chat), reusing the same column-labeling/value-formatting helpers so a chart
 * pinned from chat or opened in Chart Designer looks the same as it did in chat.
 *
 * Brought to capability parity with TableWidget: a summary totals row (numeric
 * columns summed), cross-filter click handling, and conditional formatting —
 * translated to the flat-row shape (rules key by literal column name here
 * instead of 'x'/'y'/series name).
 */
export const RawRowsTableWidget: React.FC<RawRowsTableWidgetProps> = ({
  rows,
  config,
  crossFilterField,
  activeCrossFilterValues = [],
  onCrossFilter,
}) => {
  const t = useTranslations('table_widget');
  const {
    bordered = false,
    size = 'small',
    pageSize = 20,
    showPagination = true,
    conditionalFormatting: cfRules = [],
  } = (config || {}) as {
    bordered?: boolean;
    size?: 'small' | 'middle' | 'large';
    pageSize?: number;
    showPagination?: boolean;
    conditionalFormatting?: ConditionalFormattingRule[];
  };

  if (!Array.isArray(rows) || rows.length === 0) {
    return (
      <div className="table-widget-container" style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('no_records')} />
      </div>
    );
  }

  const keys = Object.keys(rows[0]);
  const labelKey = keys[0];
  // Reserve the first column as the "label" column (mirrors TableWidget's x/category
  // column) — never summed, even if numeric, so the totals row has somewhere to put its label.
  const numericKeys = keys.filter((k) => k !== labelKey && isNumericColumn(rows, k));

  const activeSet = new Set(activeCrossFilterValues.map(String));
  const canCrossFilter = !!crossFilterField && !!onCrossFilter && keys.includes(crossFilterField);

  const columns: ColumnsType<any> = keys.map((key) => {
    const isLabelCol = key === labelKey;
    const isNumericCol = numericKeys.includes(key);
    const isCrossFilterCol = canCrossFilter && key === crossFilterField;

    return {
      key,
      title: columnHeaderFromKey(key),
      dataIndex: key,
      ellipsis: true,
      align: isNumericCol ? ('right' as const) : undefined,
      className: isNumericCol ? 'table-cell-number' : undefined,
      sorter: (a: any, b: any) => {
        if (a.key === 'total') return 1;
        if (b.key === 'total') return -1;
        const av = a[key];
        const bv = b[key];
        if (typeof av === 'number' && typeof bv === 'number') return av - bv;
        return String(av ?? '').localeCompare(String(bv ?? ''));
      },
      render: (value: unknown, record: any) => {
        const isTotalRow = record.key === 'total';

        if (isTotalRow && isLabelCol) {
          return <Text strong style={{ color: 'var(--ant-color-text)' }}>{t('total')}</Text>;
        }

        const cfStyle = !isTotalRow && cfRules.length
          ? getCellStyle(cfRules, key, value, record as Record<string, unknown>)
          : {};
        const display = formatTableCellValue(value);

        if (isNumericCol) {
          return (
            <Text
              style={{
                color: cfStyle.color ?? (isTotalRow ? 'var(--ant-color-text)' : 'var(--ant-color-primary)'),
                fontWeight: cfStyle.fontWeight ?? (isTotalRow ? 700 : 500),
                backgroundColor: cfStyle.backgroundColor,
                padding: cfStyle.backgroundColor ? '2px 6px' : undefined,
                borderRadius: cfStyle.backgroundColor ? 4 : undefined,
                display: 'inline-block',
              }}
            >
              {display}
            </Text>
          );
        }

        const clickable = isCrossFilterCol && !isTotalRow;
        return (
          <Text
            strong={isTotalRow}
            style={{
              color: cfStyle.color ?? 'var(--ant-color-text)',
              cursor: clickable ? 'pointer' : undefined,
              fontWeight: cfStyle.fontWeight ?? (isTotalRow ? 700 : (clickable && activeSet.has(String(value)) ? 700 : 500)),
              backgroundColor: cfStyle.backgroundColor,
              padding: cfStyle.backgroundColor ? '2px 6px' : undefined,
              borderRadius: cfStyle.backgroundColor ? 4 : undefined,
            }}
            onClick={
              clickable
                ? (e) => {
                    e.stopPropagation();
                    onCrossFilter!(value);
                  }
                : undefined
            }
          >
            {display}
          </Text>
        );
      },
    };
  });

  const dataSource: any[] = rows.map((row, i) => ({ ...row, key: i }));

  // Totals row — sum numeric columns, matching TableWidget's totals-row behavior.
  if (numericKeys.length > 0) {
    const totals: Record<string, unknown> & { key: string } = { key: 'total' };
    numericKeys.forEach((k) => {
      totals[k] = rows.reduce((acc, r) => acc + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0);
    });
    dataSource.push(totals);
  }

  return (
    <div className="table-widget-container">
      <Table
        dataSource={dataSource}
        columns={columns}
        pagination={
          showPagination
            ? {
                pageSize,
                size: 'small',
                showSizeChanger: false,
                position: ['bottomRight'],
                hideOnSinglePage: false,
                showTotal: (total, range) => (
                  <span style={{ fontSize: '12px', color: 'var(--ant-color-text-description)', marginRight: 'auto', fontWeight: 500 }}>
                    {total > 0 ? t('showing_range', { start: range[0], end: range[1], total }) : t('no_records')}
                  </span>
                ),
              }
            : false
        }
        size={size}
        bordered={bordered}
        sticky
        scroll={{ x: 'max-content' }}
        rowClassName={(record: any) => {
          if (record.key === 'total') return 'table-row-total';
          if (canCrossFilter && activeSet.has(String(record[crossFilterField!]))) return 'table-row-cross-filter-active';
          return '';
        }}
        onRow={(record: any) => {
          const rowCfStyle = record.key !== 'total' && cfRules.length
            ? getRowStyle(cfRules, record as Record<string, unknown>)
            : {};
          const base = canCrossFilter && record.key !== 'total'
            ? { onClick: () => onCrossFilter!(record[crossFilterField!]), style: { cursor: 'pointer', ...rowCfStyle } }
            : { style: rowCfStyle };
          return base;
        }}
      />
    </div>
  );
};
