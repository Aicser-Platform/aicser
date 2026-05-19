'use client';

import React from 'react';
import { Table, Typography, Empty } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { formatTableValue } from '../utils/numberFormatter';
import './TableWidget.css';
import { useTranslations } from 'next-intl';

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
  };
  query?: {
    x?: string;
    yMetric?: string;
    yMetrics?: { field: string; aggregation: string }[];
  };
}

/**
 * Renders data in a tabular format with premium aesthetics, including a summary Total row
 */
export const TableWidget: React.FC<TableWidgetProps> = ({ data, config, query }) => {
  const t = useTranslations('table_widget');
  const { showPagination = true, pageSize = 10, bordered = false, size = 'small', title } = config;

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

  // First column is usually 'x' (the grouping field)
  columns.push({
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
    render: (val, record) => (
       <Text strong={record.key === 'total'} style={{ color: 'var(--ant-color-text)' }}>
         {val}
       </Text>
    )
  });

  // Data mapping & Totals calculation
  const dataSource: any[] = [];
  const rowCount = data.x?.length || 0;
  const totals: any = { key: 'total', x: t('total') };
  let hasNumericalY = false;

  if (data.series && data.series.length > 0) {
    // Multi-metric case
    data.series.forEach((s) => {
      columns.push({
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
        render: (val, record) => (
          <Text style={{ 
            color: record.key === 'total' ? 'var(--ant-color-text)' : 'var(--ant-color-primary)', 
            fontWeight: record.key === 'total' ? 700 : 500 
          }}>
            {formatTableValue(val, 'number')}
          </Text>
        ),
      });

      // Calculate total for this series
      const sum = (s.data || []).reduce((acc, curr) => acc + (typeof curr === 'number' ? curr : 0), 0);
      totals[s.name] = sum;
      hasNumericalY = true;
    });

    for (let i = 0; i < rowCount; i++) {
      const row: any = { key: i, x: data.x?.[i] };
      data.series.forEach((s) => {
        row[s.name] = s.data?.[i];
      });
      dataSource.push(row);
    }
  } else if (data.y) {
    // Single metric case
    columns.push({
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
      render: (val, record) => (
        <Text style={{ 
          fontWeight: record.key === 'total' ? 700 : 500 
        }}>
          {formatTableValue(val, 'number')}
        </Text>
      ),
    });

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
        rowClassName={(record) => record.key === 'total' ? 'table-row-total' : ''}
      />
    </div>
  );
};
