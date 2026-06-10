'use client';

import React from 'react';
import { Table, Typography, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatTableValue } from '../utils/numberFormatter';
import './TableWidget.css';
import { useTranslations } from 'next-intl';
import type { ConditionalFormattingRule } from '../Properties/ConditionalFormattingEditor';

// ─── Conditional Formatting helpers ──────────────────────────────────────────

function testRule(
  rule: ConditionalFormattingRule,
  value: unknown
): boolean {
  const numVal = typeof value === 'number' ? value : parseFloat(String(value));
  const ruleNum = parseFloat(rule.value);

  switch (rule.operator) {
    case 'gt':       return !isNaN(numVal) && !isNaN(ruleNum) && numVal > ruleNum;
    case 'lt':       return !isNaN(numVal) && !isNaN(ruleNum) && numVal < ruleNum;
    case 'gte':      return !isNaN(numVal) && !isNaN(ruleNum) && numVal >= ruleNum;
    case 'lte':      return !isNaN(numVal) && !isNaN(ruleNum) && numVal <= ruleNum;
    case 'eq':       return String(value) === rule.value || numVal === ruleNum;
    case 'neq':      return String(value) !== rule.value && numVal !== ruleNum;
    case 'contains': return String(value).toLowerCase().includes(rule.value.toLowerCase());
    case 'is_empty': return value === null || value === undefined || String(value).trim() === '';
    case 'not_empty':return value !== null && value !== undefined && String(value).trim() !== '';
    default:         return false;
  }
}

/** Returns merged inline style from all matching rules for a specific cell */
function getCellStyle(
  rules: ConditionalFormattingRule[],
  columnKey: string,
  cellValue: unknown,
  rowData: Record<string, unknown>
): React.CSSProperties {
  const style: React.CSSProperties = {};

  for (const rule of rules) {
    const matchesColumn = rule.column === columnKey || rule.column === '*';
    if (!matchesColumn) continue;

    const testValue = rule.applyTo === 'row'
      ? rowData[columnKey]   // each cell in row checks its own value
      : cellValue;

    const ruleTarget = rule.applyTo === 'row' ? rowData[rule.column] : cellValue;
    if (!testRule(rule, ruleTarget)) continue;

    if (rule.bgColor)   style.backgroundColor = rule.bgColor;
    if (rule.textColor) style.color = rule.textColor;
    if (rule.bold)      style.fontWeight = 'bold';
    break; // first match wins
  }

  return style;
}

/** Returns row-level style from the first matching row rule */
function getRowStyle(
  rules: ConditionalFormattingRule[],
  rowData: Record<string, unknown>
): React.CSSProperties {
  const rowRules = rules.filter((r) => r.applyTo === 'row');
  for (const rule of rowRules) {
    const val = rowData[rule.column] ?? rowData['x'] ?? rowData['y'];
    if (!testRule(rule, val)) continue;
    const style: React.CSSProperties = {};
    if (rule.bgColor)   style.backgroundColor = rule.bgColor;
    if (rule.textColor) style.color = rule.textColor;
    if (rule.bold)      style.fontWeight = 'bold';
    return style;
  }
  return {};
}

const { Text } = Typography;

interface TableWidgetProps {
  data: {
    x?: any[];
    y?: any[];
    series?: { name: string; data: any[] }[];
  };
  config: {
    title?: string;
    showPagination?: boolean;
    pageSize?: number;
    bordered?: boolean;
    size?: 'small' | 'middle' | 'large';
    conditionalFormatting?: ConditionalFormattingRule[];
  };
  query?: {
    x?: string;
    yMetric?: string;
    yMetrics?: { field: string; aggregation: string }[];
  };
  crossFilterField?: string;
  activeCrossFilterValues?: string[];
  onCrossFilter?: (value: unknown) => void;
}

/**
 * Renders data in a tabular format with premium aesthetics, including a summary Total row
 */
export const TableWidget: React.FC<TableWidgetProps> = ({
  data,
  config,
  query,
  crossFilterField,
  activeCrossFilterValues = [],
  onCrossFilter,
}) => {
  const t = useTranslations('table_widget');
  const {
    showPagination = true,
    pageSize = 10,
    bordered = false,
    size = 'small',
    title,
    conditionalFormatting: cfRules = [],
    tableColumnKeys,
  } = config as typeof config & { tableColumnKeys?: string[] };

  const columnOrder = Array.isArray(tableColumnKeys) && tableColumnKeys.length > 0 ? tableColumnKeys : null;
  const isColumnVisible = (fieldName: string) => {
    if (!columnOrder) return true;
    return columnOrder.includes(fieldName);
  };

  if (!data || !data.x || (data.x.length === 0 && (!data.series || data.series.length === 0))) {
    return (
      <div className="table-widget-container" style={{ height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Empty 
          image={Empty.PRESENTED_IMAGE_SIMPLE} 
          description={<Text type="secondary">{t('no_data')}</Text>} 
        />
      </div>
    );
  }

  // Build columns
  const columns: ColumnsType<any> = [];

  const activeSet = new Set(activeCrossFilterValues.map(String));
  const xField = String(query?.x || 'x');

  type ColEntry = { fieldName: string; column: ColumnsType<any>[number] };
  const colEntries: ColEntry[] = [];

  if (isColumnVisible(xField) || isColumnVisible('x')) {
    colEntries.push({
      fieldName: xField,
      column: {
        title: query?.x || t('category'),
        dataIndex: 'x',
        key: 'x',
        className: 'table-cell-category',
        sorter: (a, b) => {
          if (a.key === 'total') return 1;
          if (b.key === 'total') return -1;
          if (typeof a.x === 'number' && typeof b.x === 'number') return a.x - b.x;
          return String(a.x).localeCompare(String(b.x));
        },
        render: (val, record) => {
          const cfStyle = record.key !== 'total' && cfRules.length
            ? getCellStyle(cfRules, 'x', val, record as Record<string, unknown>)
            : {};
          return (
            <Text
              strong={record.key === 'total'}
              style={{
                color: cfStyle.color ?? 'var(--ant-color-text)',
                cursor: onCrossFilter && record.key !== 'total' ? 'pointer' : undefined,
                fontWeight: cfStyle.fontWeight ?? (activeSet.has(String(val)) ? 700 : record.key === 'total' ? 700 : 500),
                backgroundColor: cfStyle.backgroundColor,
                padding: cfStyle.backgroundColor ? '2px 6px' : undefined,
                borderRadius: cfStyle.backgroundColor ? 4 : undefined,
              }}
              onClick={
                onCrossFilter && record.key !== 'total'
                  ? (e) => {
                      e.stopPropagation();
                      onCrossFilter(val);
                    }
                  : undefined
              }
            >
              {val}
            </Text>
          );
        },
      },
    });
  }

  // Data mapping & Totals calculation
  const dataSource: any[] = [];
  const rowCount = data.x?.length || 0;
  const totals: any = { key: 'total', x: t('total') };
  let hasNumericalY = false;

  if (data.series && data.series.length > 0) {
    data.series.forEach((s) => {
      if (!isColumnVisible(s.name)) return;
      colEntries.push({
        fieldName: s.name,
        column: {
          title: s.name,
          dataIndex: s.name,
          key: s.name,
          align: 'right',
          className: 'table-cell-number table-cell-y',
          sorter: (a, b) => {
            if (a.key === 'total') return 1;
            if (b.key === 'total') return -1;
            return a[s.name] - b[s.name];
          },
          render: (val, record) => {
            const cfStyle = record.key !== 'total' && cfRules.length
              ? getCellStyle(cfRules, s.name, val, record as Record<string, unknown>)
              : {};
            return (
              <Text style={{
                color: cfStyle.color ?? (record.key === 'total' ? 'var(--ant-color-text)' : 'var(--ant-color-primary)'),
                fontWeight: cfStyle.fontWeight ?? (record.key === 'total' ? 700 : 500),
                backgroundColor: cfStyle.backgroundColor,
                padding: cfStyle.backgroundColor ? '2px 6px' : undefined,
                borderRadius: cfStyle.backgroundColor ? 4 : undefined,
                display: 'inline-block',
              }}>
                {formatTableValue(val, 'number')}
              </Text>
            );
          },
        },
      });

      const sum = (s.data || []).reduce((acc, curr) => acc + (typeof curr === 'number' ? curr : 0), 0);
      totals[s.name] = sum;
      hasNumericalY = true;
    });

    for (let i = 0; i < rowCount; i++) {
      const row: any = { key: i, x: data.x?.[i] };
      data.series.forEach((s) => {
        if (!isColumnVisible(s.name)) return;
        row[s.name] = s.data?.[i];
      });
      dataSource.push(row);
    }
  } else if (data.y) {
    const yField = String(query?.yMetric || 'y');
    if (isColumnVisible(yField) || isColumnVisible('y')) {
      colEntries.push({
        fieldName: yField,
        column: {
          title: query?.yMetric || t('value'),
          dataIndex: 'y',
          key: 'y',
          align: 'right',
          className: 'table-cell-number table-cell-y',
          sorter: (a, b) => {
            if (a.key === 'total') return 1;
            if (b.key === 'total') return -1;
            return a.y - b.y;
          },
          render: (val, record) => {
            const cfStyle = record.key !== 'total' && cfRules.length
              ? getCellStyle(cfRules, 'y', val, record as Record<string, unknown>)
              : {};
            return (
              <Text style={{
                fontWeight: cfStyle.fontWeight ?? (record.key === 'total' ? 700 : 500),
                color: cfStyle.color,
                backgroundColor: cfStyle.backgroundColor,
                padding: cfStyle.backgroundColor ? '2px 6px' : undefined,
                borderRadius: cfStyle.backgroundColor ? 4 : undefined,
                display: 'inline-block',
              }}>
                {formatTableValue(val, 'number')}
              </Text>
            );
          },
        },
      });
    }

    for (let i = 0; i < rowCount; i++) {
      dataSource.push({
        key: i,
        x: data.x?.[i],
        y: data.y?.[i],
      });
    }

    const sum = (data.y || []).reduce((acc: number, curr: any) => acc + (typeof curr === 'number' ? curr : 0), 0);
    totals.y = sum;
    hasNumericalY = true;
  }

  const orderedEntries = columnOrder
    ? [...colEntries].sort(
        (a, b) =>
          (columnOrder.indexOf(a.fieldName) === -1 ? 999 : columnOrder.indexOf(a.fieldName)) -
          (columnOrder.indexOf(b.fieldName) === -1 ? 999 : columnOrder.indexOf(b.fieldName)),
      )
    : colEntries;
  orderedEntries.forEach((e) => columns.push(e.column));

  // Add the total row at the end if we have numerical data
  if (hasNumericalY && rowCount > 0) {
    dataSource.push(totals);
  }

  return (
    <div className="table-widget-container">
      <Table
        dataSource={dataSource}
        columns={columns}
        pagination={showPagination ? { 
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
        } : (dataSource.length > pageSize ? { pageSize, position: ['none' as any] } : false)}
        size={size}
        bordered={bordered}
        sticky
        rowClassName={(record) => {
          if (record.key === 'total') return 'table-row-total';
          if (activeSet.has(String(record.x))) return 'table-row-cross-filter-active';
          return '';
        }}
        onRow={(record) => {
          const rowCfStyle = record.key !== 'total' && cfRules.length
            ? getRowStyle(cfRules, record as Record<string, unknown>)
            : {};
          const base = onCrossFilter && record.key !== 'total'
            ? { onClick: () => onCrossFilter(record.x), style: { cursor: 'pointer', ...rowCfStyle } }
            : { style: rowCfStyle };
          return base;
        }}
      />
    </div>
  );
};
